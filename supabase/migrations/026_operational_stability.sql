begin;

-- Apenas as utilizações institucionais admitem a devolução de parte dos itens.
create or replace function return_rental_items(p_rental_id uuid,p_return_kiosk_id uuid,p_items jsonb,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; ri rental_items; r rentals; remaining integer; pending integer; selected integer; retained numeric; retention_reason text; asset_kind text;
begin
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  if not exists(select 1 from kiosks where id=p_return_kiosk_id and active=true and allows_rentals=true) then raise exception 'invalid_return_kiosk'; end if;
  selected:=jsonb_array_length(coalesce(p_items,'[]'::jsonb));
  if selected=0 then raise exception 'no_return_items'; end if;
  select count(*) into pending from rental_items where rental_id=p_rental_id and returned_at is null;
  if r.rental_kind<>'institutional' and selected<>pending then raise exception 'partial_return_not_allowed'; end if;

  for item in select value from jsonb_array_elements(p_items) supplied(value) order by value->>'rental_item_id' loop
    select * into ri from rental_items where id=(item->>'rental_item_id')::uuid and rental_id=p_rental_id for update;
    if not found or ri.returned_at is not null then raise exception 'invalid_return_item'; end if;
    select asset_type into asset_kind from bikes where id=ri.bike_id;
    retained:=coalesce(nullif(item->>'deposit_retained','')::numeric,0);
    retention_reason:=nullif(trim(coalesce(item->>'deposit_retention_reason','')),'');
    if r.rental_kind='institutional' and retained<>0 then raise exception 'institutional_deposit_not_allowed'; end if;
    if retained<0 or retained>50 or (retained>0 and asset_kind not in ('electric','conventional','child')) then raise exception 'invalid_retained_deposit'; end if;
    if retained>0 and length(coalesce(retention_reason,''))<5 then raise exception 'deposit_reason_required'; end if;

    update rental_items set returned_at=now(),returned_by=p_user_id,return_kiosk_id=p_return_kiosk_id,
      anomaly=coalesce((item->>'anomaly')::boolean,false),anomaly_description=nullif(item->>'anomaly_description',''),
      deposit_retained=retained,deposit_retention_reason=retention_reason where id=ri.id;
    if coalesce((item->>'anomaly')::boolean,false) then
      update bikes set status='Avariada',kiosk_id=p_return_kiosk_id where id=ri.bike_id;
      insert into faults(bike_id,created_by,origin,category,description,severity,usable,status)
      values(ri.bike_id,p_user_id,'identificada numa devolução','outra',coalesce(nullif(item->>'anomaly_description',''),'Anomalia indicada na devolução'),'Média',false,'Aberta');
      insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) values(ri.bike_id,'Avariada',p_return_kiosk_id,p_user_id,'Anomalia na devolução');
    else
      update bikes set status='Disponível',kiosk_id=p_return_kiosk_id where id=ri.bike_id;
      insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) values(ri.bike_id,'Disponível',p_return_kiosk_id,p_user_id,'Devolução sem anomalias');
    end if;
  end loop;
  select count(*) into remaining from rental_items where rental_id=p_rental_id and returned_at is null;
  if remaining=0 then
    if r.rental_kind='institutional' then
      select coalesce(sum(equipment_duration_price(b.asset_type,'hour',greatest(1,ceil(extract(epoch from (now()-r.started_at))/3600)::integer),r.started_at)),0) into retained
      from rental_items all_items join bikes b on b.id=all_items.bike_id where all_items.rental_id=p_rental_id;
      update rentals set status='Concluído',returned_at=now(),returned_by=p_user_id,customer_contact=null,expected_amount=retained,discount_amount=retained where id=p_rental_id;
    else
      update rentals set status='Concluído',returned_at=now(),returned_by=p_user_id,customer_contact=null where id=p_rental_id;
    end if;
  end if;
  insert into audit_log(action,user_id,entity,entity_id,new_value) values('registar devolução',p_user_id,'aluguer',p_rental_id::text,p_items);
  return jsonb_build_object('remaining',remaining);
end; $$;

revoke execute on function return_rental_items(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function return_rental_items(uuid,uuid,jsonb,uuid) to service_role;

-- Índices para paginação e filtros cronológicos.
create index if not exists audit_log_created_at_idx on audit_log(created_at desc);
create index if not exists rentals_closed_history_idx on rentals(status,started_at desc) where status in ('Concluído','Anulado');
create index if not exists faults_created_at_idx on faults(created_at desc);

commit;
