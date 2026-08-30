begin;

alter table rentals add column if not exists charged_amount numeric(10,2) not null default 0;
alter table rentals drop constraint if exists rentals_charged_amount_check;
alter table rentals add constraint rentals_charged_amount_check check(charged_amount>=0 and charged_amount<=100000);

-- Nova assinatura. A função anterior mantém-se para compatibilidade, mas a API
-- utiliza esta versão para guardar o valor no mesmo compromisso transacional.
create or replace function start_rental(
  p_customer_ref text,
  p_start_kiosk_id uuid,
  p_bike_ids uuid[],
  p_user_id uuid,
  p_customer_contact text,
  p_charged_amount numeric
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r rentals; ref text;
begin
  if coalesce(array_length(p_bike_ids,1),0)=0 then raise exception 'no_bikes'; end if;
  if p_charged_amount is null or p_charged_amount<0 or p_charged_amount>100000 then
    raise exception 'invalid_charged_amount';
  end if;
  if not exists(select 1 from kiosks where id=p_start_kiosk_id and active=true and allows_rentals=true) then
    raise exception 'invalid_start_kiosk';
  end if;

  perform 1 from bikes where id=any(p_bike_ids) order by id for update;
  if exists(
    select 1 from bikes where id=any(p_bike_ids)
      and (status<>'Disponível' or not active or kiosk_id<>p_start_kiosk_id)
  ) or (select count(*) from bikes where id=any(p_bike_ids))<>array_length(p_bike_ids,1) then
    raise exception 'bike_not_available';
  end if;

  ref:='AL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into rentals(reference,customer_ref,customer_contact,start_kiosk_id,started_by,charged_amount)
  values(
    ref,left(trim(p_customer_ref),200),
    nullif(left(trim(coalesce(p_customer_contact,'')),50),''),
    p_start_kiosk_id,p_user_id,p_charged_amount
  ) returning * into r;

  insert into rental_items(rental_id,bike_id) select r.id,unnest(p_bike_ids);
  update bikes set status='Alugada' where id=any(p_bike_ids);
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
  select id,'Alugada',kiosk_id,p_user_id,'Início do aluguer '||ref from bikes where id=any(p_bike_ids);
  insert into audit_log(action,user_id,entity,entity_id,new_value)
  values('iniciar aluguer',p_user_id,'aluguer',r.id::text,to_jsonb(r)-'customer_contact'-'customer_ref');
  return to_jsonb(r);
end;
$$;

revoke all on function start_rental(text,uuid,uuid[],uuid,text,numeric) from public;
grant execute on function start_rental(text,uuid,uuid[],uuid,text,numeric) to service_role;

create or replace function daily_closure_stats(p_report_date date,p_kiosk_id uuid,p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'rental_count',count(distinct r.id),
    'bike_count',count(ri.id) filter(where b.asset_type in ('electric','conventional','child')),
    'electric_count',count(ri.id) filter(where b.asset_type='electric'),
    'conventional_count',count(ri.id) filter(where b.asset_type='conventional'),
    'child_count',count(ri.id) filter(where b.asset_type='child'),
    'accessory_count',count(ri.id) filter(where b.asset_type in ('helmet','lock','stroller')),
    'charged_total',coalesce((select sum(r2.charged_amount) from rentals r2
      where r2.started_by=p_user_id and r2.start_kiosk_id=p_kiosk_id
        and (r2.started_at at time zone 'Europe/Lisbon')::date=p_report_date),0)
  )
  from rentals r
  left join rental_items ri on ri.rental_id=r.id
  left join bikes b on b.id=ri.bike_id
  where r.started_by=p_user_id and r.start_kiosk_id=p_kiosk_id
    and (r.started_at at time zone 'Europe/Lisbon')::date=p_report_date;
$$;

create table if not exists availability_incidents(
  id uuid primary key default gen_random_uuid(),
  kiosk_id uuid not null references kiosks(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  rented_count integer not null check(rented_count>=0),
  out_of_service_count integer not null check(out_of_service_count>=0),
  cause text not null check(cause in ('Todas alugadas','Capacidade mista'))
);
create unique index if not exists availability_incidents_one_open
  on availability_incidents(kiosk_id) where ended_at is null;
create index if not exists availability_incidents_dates_idx
  on availability_incidents(started_at desc,ended_at);
alter table availability_incidents enable row level security;

create or replace function refresh_kiosk_availability(p_kiosk_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  available_count integer;
  rented_count integer;
  out_count integer;
begin
  if p_kiosk_id is null then return; end if;
  select
    count(*) filter(where status='Disponível'),
    count(*) filter(where status='Alugada'),
    count(*) filter(where status in ('Avariada','Em manutenção','Indisponível'))
  into available_count,rented_count,out_count
  from bikes
  where kiosk_id=p_kiosk_id and active=true
    and asset_type in ('electric','conventional','child');

  if available_count=0 and rented_count>0 then
    insert into availability_incidents(kiosk_id,rented_count,out_of_service_count,cause)
    values(p_kiosk_id,rented_count,out_count,case when out_count=0 then 'Todas alugadas' else 'Capacidade mista' end)
    on conflict(kiosk_id) where ended_at is null do nothing;
  else
    update availability_incidents set ended_at=now()
    where kiosk_id=p_kiosk_id and ended_at is null;
  end if;
end;
$$;

create or replace function bikes_track_availability()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform refresh_kiosk_availability(new.kiosk_id);
  if old.kiosk_id is distinct from new.kiosk_id then
    perform refresh_kiosk_availability(old.kiosk_id);
  end if;
  return new;
end;
$$;
drop trigger if exists bikes_track_availability on bikes;
create trigger bikes_track_availability
after update of status,kiosk_id,active,asset_type on bikes
for each row execute function bikes_track_availability();

create or replace function rental_management_analytics(p_from date default null,p_to date default null)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with bounds as (
    select coalesce(p_from,date '2000-01-01') from_date,
           coalesce(p_to,(now() at time zone 'Europe/Lisbon')::date) to_date
  ), filtered as (
    select r.*,(r.started_at at time zone 'Europe/Lisbon')::date local_date
    from rentals r,bounds b
    where (r.started_at at time zone 'Europe/Lisbon')::date between b.from_date and b.to_date
  ), daily as (
    select local_date,count(*) rental_count,
      coalesce(sum((select count(*) from rental_items ri where ri.rental_id=f.id)),0) item_count,
      coalesce(sum(charged_amount),0) revenue
    from filtered f group by local_date
  ), weekdays as (
    select extract(isodow from local_date)::integer weekday_number,
      case extract(isodow from local_date)::integer
        when 1 then 'Segunda-feira' when 2 then 'Terça-feira' when 3 then 'Quarta-feira'
        when 4 then 'Quinta-feira' when 5 then 'Sexta-feira' when 6 then 'Sábado' else 'Domingo' end weekday,
      count(*) rental_count
    from filtered group by local_date,extract(isodow from local_date)
  ), weekday_totals as (
    select weekday_number,weekday,sum(rental_count) rental_count
    from weekdays group by weekday_number,weekday
  ), kiosk_totals as (
    select k.id,k.name,count(f.id) rental_count,coalesce(sum(f.charged_amount),0) revenue
    from kiosks k left join filtered f on f.start_kiosk_id=k.id
    where k.allows_rentals=true group by k.id,k.name
  ), type_totals as (
    select b.asset_type,count(ri.id) item_count
    from filtered f join rental_items ri on ri.rental_id=f.id join bikes b on b.id=ri.bike_id
    group by b.asset_type
  ), incidents as (
    select ai.*,k.name kiosk_name,
      extract(epoch from (
        least(coalesce(ai.ended_at,now()),((b.to_date+1)::timestamp at time zone 'Europe/Lisbon'))
        - greatest(ai.started_at,(b.from_date::timestamp at time zone 'Europe/Lisbon'))
      ))/60 duration_minutes
    from availability_incidents ai join kiosks k on k.id=ai.kiosk_id,bounds b
    where (ai.started_at at time zone 'Europe/Lisbon')::date<=b.to_date
      and (coalesce(ai.ended_at,now()) at time zone 'Europe/Lisbon')::date>=b.from_date
  ), incident_days as (
    select distinct generated_day::date local_date
    from incidents i,bounds b
    cross join lateral generate_series(
      greatest((i.started_at at time zone 'Europe/Lisbon')::date,b.from_date),
      least((coalesce(i.ended_at,now()) at time zone 'Europe/Lisbon')::date,b.to_date),
      interval '1 day'
    ) generated_day
  )
  select jsonb_build_object(
    'rental_count',(select count(*) from filtered),
    'item_count',(select count(*) from rental_items ri join filtered f on f.id=ri.rental_id),
    'revenue',coalesce((select sum(charged_amount) from filtered),0),
    'average_duration_minutes',coalesce((select round(avg(extract(epoch from (returned_at-started_at))/60)) from filtered where returned_at is not null),0),
    'busiest_weekday',coalesce((select weekday from weekday_totals order by rental_count desc,weekday_number limit 1),'—'),
    'busiest_days',coalesce((select jsonb_agg(to_jsonb(x) order by x.rental_count desc,x.local_date desc) from (select * from daily order by rental_count desc,local_date desc limit 10)x),'[]'::jsonb),
    'weekdays',coalesce((select jsonb_agg(to_jsonb(x) order by x.weekday_number) from weekday_totals x),'[]'::jsonb),
    'kiosks',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from kiosk_totals x),'[]'::jsonb),
    'asset_types',coalesce((select jsonb_agg(to_jsonb(x) order by x.item_count desc) from type_totals x),'[]'::jsonb),
    'stockout_days',(select count(*) from incident_days),
    'stockout_minutes',coalesce((select round(sum(duration_minutes)) from incidents),0),
    'stockouts',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from incidents x),'[]'::jsonb)
  );
$$;

revoke all on function rental_management_analytics(date,date) from public;
grant execute on function rental_management_analytics(date,date) to service_role;
grant execute on function daily_closure_stats(date,uuid,uuid) to service_role;

commit;
