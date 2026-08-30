begin;

-- Distingue valores realmente registados de alugueres históricos que receberam
-- o valor zero por omissão quando a coluna financeira foi criada.
alter table rentals add column if not exists charged_amount_recorded boolean not null default false;
update rentals set charged_amount_recorded=true where charged_amount>0;
alter table rentals alter column charged_amount_recorded set default true;

create or replace function rental_payment_analytics(p_from date default null,p_to date default null)
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
    select r.*
    from rentals r,bounds b
    where (r.started_at at time zone 'Europe/Lisbon')::date between b.from_date and b.to_date
  )
  select jsonb_build_object(
    'paid_rental_count',count(*) filter(where charged_amount_recorded and charged_amount>0),
    'free_rental_count',count(*) filter(where charged_amount_recorded and charged_amount=0),
    'unclassified_rental_count',count(*) filter(where not charged_amount_recorded),
    'revenue',coalesce(sum(charged_amount) filter(where charged_amount_recorded),0)
  )
  from filtered;
$$;

revoke all on function rental_payment_analytics(date,date) from public;
grant execute on function rental_payment_analytics(date,date) to service_role;

commit;
