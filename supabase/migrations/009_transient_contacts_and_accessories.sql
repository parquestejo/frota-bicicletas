begin;

-- O contacto serve apenas enquanto o aluguer está em aberto.
alter table rentals
  add column if not exists customer_contact text;

alter table rentals
  drop constraint if exists rentals_customer_contact_length;
alter table rentals
  add constraint rentals_customer_contact_length
  check (customer_contact is null or char_length(customer_contact) <= 50);

update rentals
set customer_contact = null
where status = 'Concluído';

create or replace function clear_rental_contact_on_close()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Concluído' then
    new.customer_contact := null;
  end if;
  return new;
end;
$$;

drop trigger if exists rentals_clear_contact_on_close on rentals;
create trigger rentals_clear_contact_on_close
before insert or update on rentals
for each row execute function clear_rental_contact_on_close();

drop function if exists start_rental(text,uuid,uuid[],uuid);

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
  perform pg_advisory_xact_lock(hashtext(x::text)) from unnest(p_bike_ids) x;
  if exists(
    select 1 from bikes
    where id=any(p_bike_ids) and (status<>'Disponível' or not active)
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

revoke all on function start_rental(text,uuid,uuid[],uuid,text) from public;

-- Completa o inventário de cada quiosque até 8 capacetes e 2 cadeados.
do $$
declare
  k record;
  current_count integer;
  next_helmet integer;
  next_lock integer;
  i integer;
  new_code text;
begin
  select coalesce(max((substring(code from '([0-9]+)$'))::integer),0)
  into next_helmet
  from bikes where code ~ '^CAP[0-9]+$';

  select coalesce(max((substring(code from '([0-9]+)$'))::integer),0)
  into next_lock
  from bikes where code ~ '^CAD[0-9]+$';

  for k in
    select id from kiosks
    where active=true and allows_rentals=true
    order by name
  loop
    select count(*) into current_count
    from bikes
    where kiosk_id=k.id and asset_type='helmet' and active=true;

    if current_count < 8 then
      for i in 1..(8-current_count) loop
        loop
          next_helmet := next_helmet + 1;
          new_code := 'CAP'||lpad(next_helmet::text,3,'0');
          exit when not exists(select 1 from bikes where code=new_code);
        end loop;
        insert into bikes(code,model,asset_type,kiosk_id,status,active)
        values(new_code,'Capacete','helmet',k.id,'Disponível',true);
      end loop;
    end if;

    select count(*) into current_count
    from bikes
    where kiosk_id=k.id and asset_type='lock' and active=true;

    if current_count < 2 then
      for i in 1..(2-current_count) loop
        loop
          next_lock := next_lock + 1;
          new_code := 'CAD'||lpad(next_lock::text,3,'0');
          exit when not exists(select 1 from bikes where code=new_code);
        end loop;
        insert into bikes(code,model,asset_type,kiosk_id,status,active)
        values(new_code,'Cadeado','lock',k.id,'Disponível',true);
      end loop;
    end if;
  end loop;
end;
$$;

commit;
