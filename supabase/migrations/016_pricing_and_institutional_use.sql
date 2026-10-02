begin;

alter table rentals add column if not exists rental_kind text not null default 'normal'
  check (rental_kind in ('normal','resident','institutional'));
alter table rentals add column if not exists rental_period text not null default 'hour'
  check (rental_period in ('hour','day'));
alter table rentals add column if not exists expected_amount numeric(10,2) not null default 0 check(expected_amount>=0);
alter table rentals add column if not exists discount_amount numeric(10,2) not null default 0 check(discount_amount>=0);
alter table rentals add column if not exists oeiras_move_confirmed boolean not null default false;
alter table rentals add column if not exists resident_proof_type text
  check (resident_proof_type in ('AT','Dístico de residente','Subscrição 120 minutos'));
alter table rentals add column if not exists institutional_entity text
  check (institutional_entity in ('Parques Tejo','Município de Oeiras'));
alter table rentals add column if not exists institutional_person text;
alter table rentals add column if not exists price_override_reason text;
alter table rental_items add column if not exists deposit_retained numeric(10,2) not null default 0
  check(deposit_retained>=0 and deposit_retained<=50);
alter table rental_items add column if not exists deposit_retention_reason text;

create or replace function start_rental(
  p_customer_ref text,
  p_start_kiosk_id uuid,
  p_bike_ids uuid[],
  p_user_id uuid,
  p_customer_contact text,
  p_charged_amount numeric,
  p_rental_kind text,
  p_rental_period text,
  p_oeiras_move_confirmed boolean,
  p_resident_proof_type text,
  p_institutional_entity text,
  p_institutional_person text,
  p_price_override_reason text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  r rentals; ref text; commercial numeric(10,2); payable numeric(10,2); bike_value numeric(10,2);
begin
  if coalesce(array_length(p_bike_ids,1),0)=0 then raise exception 'no_bikes'; end if;
  if p_rental_kind not in ('normal','resident','institutional') or p_rental_period not in ('hour','day') then raise exception 'invalid_rental_type'; end if;
  if p_rental_kind='resident' and (not coalesce(p_oeiras_move_confirmed,false) or p_resident_proof_type not in ('AT','Dístico de residente','Subscrição 120 minutos')) then raise exception 'invalid_resident_benefit'; end if;
  if p_rental_kind='institutional' and (p_institutional_entity not in ('Parques Tejo','Município de Oeiras') or length(trim(coalesce(p_institutional_person,'')))=0) then raise exception 'invalid_institutional_use'; end if;
  if p_charged_amount is null or p_charged_amount<0 or p_charged_amount>100000 then raise exception 'invalid_charged_amount'; end if;
  if not exists(select 1 from kiosks where id=p_start_kiosk_id and active=true and allows_rentals=true) then raise exception 'invalid_start_kiosk'; end if;

  perform 1 from bikes where id=any(p_bike_ids) order by id for update;
  if exists(select 1 from bikes where id=any(p_bike_ids) and (status<>'Disponível' or not active or kiosk_id<>p_start_kiosk_id))
    or (select count(*) from bikes where id=any(p_bike_ids))<>array_length(p_bike_ids,1) then raise exception 'bike_not_available'; end if;

  select coalesce(sum(case asset_type
    when 'electric' then case when p_rental_period='hour' then 4 else 10 end
    when 'conventional' then case when p_rental_period='hour' then 2 else 6 end
    when 'child' then case when p_rental_period='hour' then 2 else 3 end
    when 'stroller' then case when p_rental_period='hour' then 2 else 3 end
    when 'helmet' then 1 else 0 end),0),
    coalesce(sum(case when asset_type in ('electric','conventional','child') then case asset_type
      when 'electric' then case when p_rental_period='hour' then 4 else 10 end
      when 'conventional' then case when p_rental_period='hour' then 2 else 6 end
      when 'child' then case when p_rental_period='hour' then 2 else 3 end end else 0 end),0)
  into commercial,bike_value from bikes where id=any(p_bike_ids);
  payable:=case when p_rental_kind='institutional' then 0 when p_rental_kind='resident' then commercial-bike_value else commercial end;
  if abs(p_charged_amount-payable)>0.001 and length(trim(coalesce(p_price_override_reason,'')))<5 then raise exception 'price_difference_reason_required'; end if;

  ref:='AL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into rentals(reference,customer_ref,customer_contact,start_kiosk_id,started_by,charged_amount,charged_amount_recorded,
    rental_kind,rental_period,expected_amount,discount_amount,oeiras_move_confirmed,resident_proof_type,institutional_entity,institutional_person,price_override_reason)
  values(ref,left(trim(p_customer_ref),200),nullif(left(trim(coalesce(p_customer_contact,'')),50),''),p_start_kiosk_id,p_user_id,p_charged_amount,true,
    p_rental_kind,p_rental_period,commercial,commercial-payable,case when p_rental_kind='resident' then p_oeiras_move_confirmed else false end,
    case when p_rental_kind='resident' then p_resident_proof_type else null end,case when p_rental_kind='institutional' then p_institutional_entity else null end,
    case when p_rental_kind='institutional' then left(trim(p_institutional_person),200) else null end,nullif(trim(coalesce(p_price_override_reason,'')),'')) returning * into r;
  insert into rental_items(rental_id,bike_id) select r.id,unnest(p_bike_ids);
  update bikes set status='Alugada' where id=any(p_bike_ids);
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) select id,'Alugada',kiosk_id,p_user_id,'Início do aluguer '||ref from bikes where id=any(p_bike_ids);
  insert into audit_log(action,user_id,entity,entity_id,new_value) values('iniciar aluguer',p_user_id,'aluguer',r.id::text,to_jsonb(r)-'customer_contact'-'customer_ref'-'institutional_person');
  return to_jsonb(r);
end; $$;

revoke all on function start_rental(text,uuid,uuid[],uuid,text,numeric,text,text,boolean,text,text,text,text) from public;
grant execute on function start_rental(text,uuid,uuid[],uuid,text,numeric,text,text,boolean,text,text,text,text) to service_role;

create or replace function return_rental_items(p_rental_id uuid,p_return_kiosk_id uuid,p_items jsonb,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; ri rental_items; r rentals; remaining integer; retained numeric; retention_reason text; asset_kind text;
begin
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  if not exists(select 1 from kiosks where id=p_return_kiosk_id and active=true and allows_rentals=true) then raise exception 'invalid_return_kiosk'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'no_return_items'; end if;

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
  if remaining=0 then update rentals set status='Concluído',returned_at=now(),returned_by=p_user_id,customer_contact=null where id=p_rental_id; end if;
  insert into audit_log(action,user_id,entity,entity_id,new_value) values('registar devolução',p_user_id,'aluguer',p_rental_id::text,p_items);
  return jsonb_build_object('remaining',remaining);
end; $$;

revoke all on function return_rental_items(uuid,uuid,jsonb,uuid) from public;
grant execute on function return_rental_items(uuid,uuid,jsonb,uuid) to service_role;

commit;
