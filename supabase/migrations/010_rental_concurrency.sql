begin;

-- Bloqueia as linhas reais dos artigos numa ordem determinística. Isto evita
-- colisões dos advisory locks e reduz o risco de deadlocks entre alugueres
-- simultâneos com conjuntos de artigos parcialmente sobrepostos.
create or replace function start_rental(
  p_customer_ref text,
  p_start_kiosk_id uuid,
  p_bike_ids uuid[],
  p_user_id uuid,
  p_customer_contact text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r rentals; ref text;
begin
  if coalesce(array_length(p_bike_ids,1),0)=0 then
    raise exception 'no_bikes';
  end if;
  if not exists(
    select 1 from kiosks
    where id=p_start_kiosk_id and active=true and allows_rentals=true
  ) then
    raise exception 'invalid_start_kiosk';
  end if;

  perform 1
  from bikes
  where id=any(p_bike_ids)
  order by id
  for update;

  if exists(
    select 1 from bikes
    where id=any(p_bike_ids)
      and (
        status<>'Disponível'
        or not active
        or kiosk_id<>p_start_kiosk_id
      )
  ) or (
    select count(*) from bikes where id=any(p_bike_ids)
  )<>array_length(p_bike_ids,1) then
    raise exception 'bike_not_available';
  end if;

  ref:='AL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into rentals(
    reference,customer_ref,customer_contact,start_kiosk_id,started_by
  ) values(
    ref,
    left(trim(p_customer_ref),200),
    nullif(left(trim(coalesce(p_customer_contact,'')),50),''),
    p_start_kiosk_id,
    p_user_id
  ) returning * into r;

  insert into rental_items(rental_id,bike_id)
  select r.id,unnest(p_bike_ids);
  update bikes set status='Alugada' where id=any(p_bike_ids);
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
  select id,'Alugada',kiosk_id,p_user_id,'Início do aluguer '||ref
  from bikes where id=any(p_bike_ids);
  insert into audit_log(action,user_id,entity,entity_id,new_value)
  values(
    'iniciar aluguer',p_user_id,'aluguer',r.id::text,
    to_jsonb(r)-'customer_contact'
  );
  return to_jsonb(r);
end;
$$;

-- Todas as devoluções do mesmo aluguer são serializadas através do bloqueio
-- da linha de rentals. Assim, a contagem final dos itens não pode ficar
-- desatualizada quando dois pedidos devolvem artigos diferentes em simultâneo.
create or replace function return_rental_items(
  p_rental_id uuid,
  p_return_kiosk_id uuid,
  p_items jsonb,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  item jsonb;
  ri rental_items;
  r rentals;
  remaining integer;
begin
  select * into r
  from rentals
  where id=p_rental_id
  for update;

  if not found then raise exception 'rental_not_found'; end if;
  if r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then
    raise exception 'no_return_items';
  end if;

  for item in
    select value
    from jsonb_array_elements(p_items) as supplied(value)
    order by value->>'rental_item_id'
  loop
    select * into ri
    from rental_items
    where id=(item->>'rental_item_id')::uuid
      and rental_id=p_rental_id
    for update;

    if not found or ri.returned_at is not null then
      raise exception 'invalid_return_item';
    end if;

    update rental_items
    set returned_at=now(),
        returned_by=p_user_id,
        return_kiosk_id=p_return_kiosk_id,
        anomaly=coalesce((item->>'anomaly')::boolean,false),
        anomaly_description=nullif(item->>'anomaly_description','')
    where id=ri.id;

    if coalesce((item->>'anomaly')::boolean,false) then
      update bikes
      set status='Avariada',kiosk_id=p_return_kiosk_id
      where id=ri.bike_id;
      insert into faults(
        bike_id,created_by,origin,category,description,severity,usable,status
      ) values(
        ri.bike_id,p_user_id,'identificada numa devolução','outra',
        coalesce(nullif(item->>'anomaly_description',''),'Anomalia indicada na devolução'),
        'Média',false,'Aberta'
      );
      insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
      values(
        ri.bike_id,'Avariada',p_return_kiosk_id,p_user_id,
        'Anomalia na devolução'
      );
    else
      update bikes
      set status='Disponível',kiosk_id=p_return_kiosk_id
      where id=ri.bike_id;
      insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
      values(
        ri.bike_id,'Disponível',p_return_kiosk_id,p_user_id,
        'Devolução sem anomalias'
      );
    end if;
  end loop;

  select count(*) into remaining
  from rental_items
  where rental_id=p_rental_id and returned_at is null;

  if remaining=0 then
    update rentals
    set status='Concluído',returned_at=now(),returned_by=p_user_id
    where id=p_rental_id;
  end if;

  insert into audit_log(action,user_id,entity,entity_id,new_value)
  values(
    'registar devolução',p_user_id,'aluguer',p_rental_id::text,p_items
  );
  return jsonb_build_object('remaining',remaining);
end;
$$;

revoke all on function start_rental(text,uuid,uuid[],uuid,text) from public;
revoke all on function return_rental_items(uuid,uuid,jsonb,uuid) from public;

commit;
