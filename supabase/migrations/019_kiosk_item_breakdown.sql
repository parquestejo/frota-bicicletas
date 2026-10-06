begin;

create or replace function rental_kiosk_item_breakdown(p_from date default null,p_to date default null)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with bounds as (
    select coalesce(p_from,date '2000-01-01') from_date,
           coalesce(p_to,(now() at time zone 'Europe/Lisbon')::date) to_date
  ), item_totals as (
    select r.start_kiosk_id kiosk_id,
      count(ri.id) filter(where b.asset_type in ('electric','conventional','child'))::integer bicycle_count,
      count(ri.id) filter(where b.asset_type in ('helmet','lock','stroller'))::integer accessory_count,
      count(ri.id)::integer item_count
    from rentals r
    join rental_items ri on ri.rental_id=r.id
    join bikes b on b.id=ri.bike_id
    cross join bounds period
    where (r.started_at at time zone 'Europe/Lisbon')::date between period.from_date and period.to_date
    group by r.start_kiosk_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id',k.id,
      'bicycle_count',coalesce(t.bicycle_count,0),
      'accessory_count',coalesce(t.accessory_count,0),
      'item_count',coalesce(t.item_count,0)
    ) order by k.name),
    '[]'::jsonb
  )
  from kiosks k
  left join item_totals t on t.kiosk_id=k.id
  where k.allows_rentals=true;
$$;

revoke all on function rental_kiosk_item_breakdown(date,date) from public;
grant execute on function rental_kiosk_item_breakdown(date,date) to service_role;

commit;
