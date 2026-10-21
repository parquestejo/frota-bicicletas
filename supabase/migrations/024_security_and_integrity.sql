begin;

-- As tabelas são acedidas exclusivamente pela API com service_role.
alter table customer_profiles enable row level security;
alter table deposit_authorizations enable row level security;
alter table equipment_types enable row level security;
alter table equipment_prices enable row level security;

-- PUBLIC é herdado por todos os papéis; por isso tem também de ser revogado.
-- A aplicação executa RPC exclusivamente através da API com service_role.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Remover assinaturas antigas que já não são utilizadas pela aplicação.
drop function if exists start_rental(text,uuid,uuid[],uuid);
drop function if exists start_rental(text,uuid,uuid[],uuid,text);
drop function if exists start_rental(text,uuid,uuid[],uuid,text,numeric);
drop function if exists start_rental(text,uuid,uuid[],uuid,text,numeric,text,text,boolean,text,text,text,text);
drop function if exists start_rental(text,uuid,uuid[],uuid,text,numeric,text,text,integer,boolean,text,text,text,text);

create or replace function admin_void_open_rental_safe(
  p_rental_id uuid,
  p_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r rentals;
  old_snapshot jsonb;
  result rentals;
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'correction_reason_required'; end if;
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;

  select jsonb_build_object('rental',to_jsonb(r)-'customer_ref'-'customer_contact','items',coalesce(jsonb_agg(to_jsonb(ri) order by ri.id),'[]'::jsonb))
  into old_snapshot from rental_items ri where ri.rental_id=r.id;

  perform 1 from bikes b
  join rental_items ri on ri.bike_id=b.id
  where ri.rental_id=r.id and ri.returned_at is null
  order by b.id for update of b;

  if exists(
    select 1 from rental_items pending
    join rental_items other on other.bike_id=pending.bike_id and other.rental_id<>r.id and other.returned_at is null
    join rentals other_rental on other_rental.id=other.rental_id and other_rental.status='Em aberto'
    where pending.rental_id=r.id and pending.returned_at is null
  ) then raise exception 'bike_has_other_open_rental'; end if;

  update bikes b set
    status=case when exists(select 1 from faults f where f.bike_id=b.id and f.status not in ('Resolvida','Cancelada')) then 'Avariada'::bike_status else 'Disponível'::bike_status end,
    kiosk_id=r.start_kiosk_id
  where exists(select 1 from rental_items ri where ri.rental_id=r.id and ri.returned_at is null and ri.bike_id=b.id);

  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
  select ri.bike_id,b.status,r.start_kiosk_id,p_user_id,'Aluguer anulado pelo administrador'
  from rental_items ri join bikes b on b.id=ri.bike_id
  where ri.rental_id=r.id and ri.returned_at is null;

  update rental_items set returned_at=now(),returned_by=p_user_id,return_kiosk_id=r.start_kiosk_id
  where rental_id=r.id and returned_at is null;

  update rentals set status='Anulado',returned_at=now(),returned_by=p_user_id,customer_contact=null,
    corrected_at=now(),corrected_by=p_user_id,correction_reason=trim(p_reason)
  where id=r.id returning * into result;

  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note)
  values('anular',p_user_id,'aluguer',r.id::text,old_snapshot,to_jsonb(result)-'customer_ref'-'customer_contact',trim(p_reason));
  return to_jsonb(result);
end;
$$;

create or replace function admin_add_missing_rental_item(
  p_rental_id uuid,p_bike_id uuid,p_return_kiosk_id uuid,p_returned_at timestamptz,p_user_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; ri rental_items; bicycle_count integer; distance numeric(10,2); co2 numeric(10,3);
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'correction_reason_required'; end if;
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.status<>'Concluído' then raise exception 'rental_not_completed'; end if;
  if p_returned_at is null or p_returned_at<r.started_at or p_returned_at>now()+interval '5 minutes' then raise exception 'invalid_returned_at'; end if;
  if not exists(select 1 from bikes where id=p_bike_id) then raise exception 'bike_not_found'; end if;
  if not exists(select 1 from kiosks where id=p_return_kiosk_id and active=true and allows_rentals=true) then raise exception 'invalid_return_kiosk'; end if;
  if exists(select 1 from rental_items where rental_id=r.id and bike_id=p_bike_id) then raise exception 'duplicate_rental_item'; end if;
  if exists(
    select 1 from rental_items x join rentals other on other.id=x.rental_id
    where x.bike_id=p_bike_id and other.id<>r.id and other.status<>'Anulado'
      and other.started_at<coalesce(r.returned_at,p_returned_at)
      and coalesce(other.returned_at,now())>r.started_at
  ) then raise exception 'bike_rental_period_overlap'; end if;
  insert into rental_items(rental_id,bike_id,returned_at,return_kiosk_id,returned_by)
  values(r.id,p_bike_id,p_returned_at,p_return_kiosk_id,p_user_id) returning * into ri;
  select count(*) into bicycle_count from rental_items x join bikes b on b.id=x.bike_id join equipment_types et on et.code=b.asset_type where x.rental_id=r.id and et.category='bicycle';
  distance:=round((extract(epoch from (r.returned_at-r.started_at))/3600*8*bicycle_count)::numeric,2);
  co2:=round((distance*0.204)::numeric,3);
  update rentals set estimated_distance_km=greatest(distance,0),estimated_co2_kg=greatest(co2,0),corrected_at=now(),corrected_by=p_user_id,correction_reason=trim(p_reason) where id=r.id;
  insert into audit_log(action,user_id,entity,entity_id,new_value,note) values('adicionar item omitido',p_user_id,'aluguer',r.id::text,to_jsonb(ri),trim(p_reason));
  return to_jsonb(ri);
end; $$;

revoke execute on function admin_void_open_rental_safe(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function admin_add_missing_rental_item(uuid,uuid,uuid,timestamptz,uuid,text) from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

commit;
