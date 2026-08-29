begin;

alter table bikes add column asset_type text;

update bikes set asset_type=case
  when code like 'E%' then 'electric'
  when code like 'C%' then 'conventional'
  else 'conventional'
end;

alter table bikes alter column asset_type set not null;
alter table bikes drop constraint if exists bikes_code_check;
alter table bikes add constraint bikes_code_check
  check (code ~ '^(E|C|I)[0-9]+$' or code ~ '^(CAP|CAD|CAR)[0-9]+$');
alter table bikes add constraint bikes_asset_type_check
  check (asset_type in ('electric','conventional','child','helmet','lock','stroller'));

create index bikes_asset_type_idx on bikes(asset_type,status,kiosk_id);

alter table daily_closures add column child_count integer not null default 0 check (child_count>=0);
alter table daily_closures add column accessory_count integer not null default 0 check (accessory_count>=0);

create or replace function daily_closure_stats(
  p_report_date date,
  p_kiosk_id uuid,
  p_user_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rental_count', count(distinct r.id),
    'bike_count', count(ri.id) filter (where b.asset_type in ('electric','conventional','child')),
    'electric_count', count(ri.id) filter (where b.asset_type='electric'),
    'conventional_count', count(ri.id) filter (where b.asset_type='conventional'),
    'child_count', count(ri.id) filter (where b.asset_type='child'),
    'accessory_count', count(ri.id) filter (where b.asset_type in ('helmet','lock','stroller'))
  )
  from rentals r
  left join rental_items ri on ri.rental_id = r.id
  left join bikes b on b.id = ri.bike_id
  where r.started_by = p_user_id
    and r.start_kiosk_id = p_kiosk_id
    and (r.started_at at time zone 'Europe/Lisbon')::date = p_report_date;
$$;

commit;
