begin;

create or replace function admin_add_missing_rental_item(
  p_rental_id uuid,
  p_bike_id uuid,
  p_return_kiosk_id uuid,
  p_returned_at timestamptz,
  p_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r rentals;
  ri rental_items;
  bicycle_count integer;
  distance numeric(10,2);
  co2 numeric(10,3);
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'correction_reason_required'; end if;
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.status<>'Concluído' then raise exception 'rental_not_completed'; end if;
  if p_returned_at is null or p_returned_at<r.started_at or p_returned_at>now()+interval '5 minutes' then raise exception 'invalid_returned_at'; end if;
  if not exists(select 1 from bikes where id=p_bike_id) then raise exception 'bike_not_found'; end if;
  if not exists(select 1 from kiosks where id=p_return_kiosk_id and active=true and allows_rentals=true) then raise exception 'invalid_return_kiosk'; end if;
  if exists(select 1 from rental_items where rental_id=r.id and bike_id=p_bike_id) then raise exception 'duplicate_rental_item'; end if;

  insert into rental_items(rental_id,bike_id,returned_at,return_kiosk_id,returned_by)
  values(r.id,p_bike_id,p_returned_at,p_return_kiosk_id,p_user_id)
  returning * into ri;

  select count(*) into bicycle_count
  from rental_items x join bikes b on b.id=x.bike_id join equipment_types et on et.code=b.asset_type
  where x.rental_id=r.id and et.category='bicycle';
  distance:=round((extract(epoch from (r.returned_at-r.started_at))/3600*8*bicycle_count)::numeric,2);
  co2:=round((distance*0.204)::numeric,3);
  update rentals set estimated_distance_km=greatest(distance,0),estimated_co2_kg=greatest(co2,0),corrected_at=now(),corrected_by=p_user_id,correction_reason=trim(p_reason) where id=r.id;

  insert into audit_log(action,user_id,entity,entity_id,new_value,note)
  values('adicionar item omitido',p_user_id,'aluguer',r.id::text,to_jsonb(ri),trim(p_reason));
  return to_jsonb(ri);
end;
$$;

revoke all on function admin_add_missing_rental_item(uuid,uuid,uuid,timestamptz,uuid,text) from public;
grant execute on function admin_add_missing_rental_item(uuid,uuid,uuid,timestamptz,uuid,text) to service_role;

commit;
