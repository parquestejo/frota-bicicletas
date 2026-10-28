-- Rede de quiosques: percursos entre locais e saldo operacional de bicicletas.
create or replace function rental_network_analytics(p_from date default null,p_to date default null)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with bounds as (
  select coalesce(p_from,date '2000-01-01') from_date,
         coalesce(p_to,(now() at time zone 'Europe/Lisbon')::date) to_date
), completed as (
  select r.id,r.start_kiosk_id
  from rentals r,bounds d
  where r.status='Concluído'
    and (r.started_at at time zone 'Europe/Lisbon')::date between d.from_date and d.to_date
), movements as (
  select c.id rental_id,c.start_kiosk_id origin_id,ri.return_kiosk_id destination_id,
         case when et.category='bicycle' then 1 else 0 end bicycle_count,
         case when et.category='bicycle' then 0 else 1 end accessory_count
  from completed c
  join rental_items ri on ri.rental_id=c.id and ri.returned_at is not null and ri.return_kiosk_id is not null
  join bikes b on b.id=ri.bike_id
  join equipment_types et on et.code=b.asset_type
), cross_rentals as (
  select distinct rental_id from movements
  where bicycle_count=1 and origin_id is distinct from destination_id
), routes as (
  select origin.id origin_id,origin.name origin_name,destination.id destination_id,destination.name destination_name,
         count(distinct m.rental_id)::integer rental_count,
         sum(m.bicycle_count)::integer bicycle_count,
         sum(m.accessory_count)::integer accessory_count,
         count(*)::integer item_count
  from movements m
  join kiosks origin on origin.id=m.origin_id
  join kiosks destination on destination.id=m.destination_id
  where m.origin_id is distinct from m.destination_id
  group by origin.id,origin.name,destination.id,destination.name
), bicycle_flows as (
  select * from movements where bicycle_count=1 and origin_id is distinct from destination_id
), current_stock as (
  select b.kiosk_id,count(*)::integer current_available
  from bikes b join equipment_types et on et.code=b.asset_type
  where b.active and b.status='Disponível' and et.category='bicycle'
  group by b.kiosk_id
), outbound as (
  select origin_id kiosk_id,count(*)::integer network_out from bicycle_flows group by origin_id
), inbound as (
  select destination_id kiosk_id,count(*)::integer network_in from bicycle_flows group by destination_id
), balances as (
  select k.id,k.name,
         coalesce(o.network_out,0)::integer network_out,
         coalesce(i.network_in,0)::integer network_in,
         (coalesce(i.network_in,0)-coalesce(o.network_out,0))::integer net_change,
         coalesce(s.current_available,0)::integer current_available
  from kiosks k
  left join outbound o on o.kiosk_id=k.id
  left join inbound i on i.kiosk_id=k.id
  left join current_stock s on s.kiosk_id=k.id
  where k.active and k.allows_rentals
)
select jsonb_build_object(
  'rental_count',(select count(*) from completed),
  'cross_kiosk_rental_count',(select count(*) from cross_rentals),
  'same_kiosk_rental_count',(select count(*) from completed)-(select count(*) from cross_rentals),
  'cross_kiosk_percentage',case when (select count(*) from completed)=0 then 0 else
    round(100.0*(select count(*) from cross_rentals)/(select count(*) from completed),1) end,
  'routes',coalesce((select jsonb_agg(to_jsonb(routes) order by bicycle_count desc,rental_count desc,origin_name,destination_name) from routes),'[]'::jsonb),
  'balances',coalesce((select jsonb_agg(to_jsonb(balances) order by net_change,name) from balances),'[]'::jsonb)
);
$$;

revoke execute on function rental_network_analytics(date,date) from public,anon,authenticated;
grant execute on function rental_network_analytics(date,date) to service_role;
