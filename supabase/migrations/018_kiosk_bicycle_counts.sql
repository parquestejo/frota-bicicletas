begin;

create or replace function rental_kiosk_bicycle_counts(p_from date default null,p_to date default null)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with bounds as (
    select coalesce(p_from,date '2000-01-01') from_date,
           coalesce(p_to,(now() at time zone 'Europe/Lisbon')::date) to_date
  ), bicycle_totals as (
    select r.start_kiosk_id kiosk_id,count(ri.id)::integer bicycle_count
    from rentals r
    join rental_items ri on ri.rental_id=r.id
    join bikes b on b.id=ri.bike_id
    cross join bounds period
    where (r.started_at at time zone 'Europe/Lisbon')::date between period.from_date and period.to_date
      and b.asset_type in ('electric','conventional','child')
    group by r.start_kiosk_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id',k.id,
      'bicycle_count',coalesce(bt.bicycle_count,0)
    ) order by k.name),
    '[]'::jsonb
  )
  from kiosks k
  left join bicycle_totals bt on bt.kiosk_id=k.id
  where k.allows_rentals=true;
$$;

revoke all on function rental_kiosk_bicycle_counts(date,date) from public;
grant execute on function rental_kiosk_bicycle_counts(date,date) to service_role;

commit;
