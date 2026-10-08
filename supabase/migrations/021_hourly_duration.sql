begin;

alter table rentals add column if not exists rental_hours integer;
update rentals set rental_hours=1 where rental_period='hour' and rental_hours is null;
alter table rentals drop constraint if exists rentals_rental_hours_check;
alter table rentals add constraint rentals_rental_hours_check check(rental_hours is null or rental_hours between 1 and 168);

create or replace function equipment_duration_price(p_asset_type text,p_period text,p_hours integer,p_at timestamptz default now())
returns numeric language sql stable security definer set search_path=public as $$
  select case when p_period='day' then equipment_price(p_asset_type,'day',p_at)
    else least(equipment_price(p_asset_type,'hour',p_at)*greatest(coalesce(p_hours,1),1),equipment_price(p_asset_type,'day',p_at)) end;
$$;

create or replace function start_rental(
  p_customer_ref text,p_start_kiosk_id uuid,p_bike_ids uuid[],p_user_id uuid,p_customer_contact text,
  p_charged_amount numeric,p_rental_kind text,p_rental_period text,p_rental_hours integer,
  p_oeiras_move_confirmed boolean,p_resident_proof_type text,p_institutional_entity text,
  p_institutional_person text,p_price_override_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; ref text; commercial numeric(10,2); payable numeric(10,2); benefit numeric(10,2); deposit numeric(10,2); multiplier integer;
begin
  if coalesce(array_length(p_bike_ids,1),0)=0 then raise exception 'no_bikes'; end if;
  if p_rental_kind not in ('normal','resident','institutional') or (p_rental_kind<>'institutional' and p_rental_period not in ('hour','day')) then raise exception 'invalid_rental_type'; end if;
  if p_rental_kind<>'institutional' and p_rental_period='hour' and (p_rental_hours is null or p_rental_hours not between 1 and 168) then raise exception 'invalid_rental_hours'; end if;
  if p_rental_kind='resident' and (not coalesce(p_oeiras_move_confirmed,false) or p_resident_proof_type not in ('AT','Dístico de residente','Subscrição 120 minutos')) then raise exception 'invalid_resident_benefit'; end if;
  if p_rental_kind='institutional' and (p_institutional_entity not in ('Parques Tejo','Município de Oeiras') or length(trim(coalesce(p_institutional_person,'')))=0) then raise exception 'invalid_institutional_use'; end if;
  if not exists(select 1 from kiosks where id=p_start_kiosk_id and active=true and allows_rentals=true) then raise exception 'invalid_start_kiosk'; end if;
  perform 1 from bikes where id=any(p_bike_ids) order by id for update;
  if exists(select 1 from bikes where id=any(p_bike_ids) and (status<>'Disponível' or not active or kiosk_id<>p_start_kiosk_id)) or (select count(*) from bikes where id=any(p_bike_ids))<>array_length(p_bike_ids,1) then raise exception 'bike_not_available'; end if;
  multiplier:=case when p_rental_period='hour' then p_rental_hours else 1 end;
  select coalesce(sum(equipment_duration_price(b.asset_type,coalesce(p_rental_period,'day'),multiplier,now())),0),
    coalesce(sum(case when et.resident_free then equipment_duration_price(b.asset_type,p_rental_period,multiplier,now()) else 0 end),0),coalesce(sum(et.deposit_amount),0)
  into commercial,benefit,deposit from bikes b join equipment_types et on et.code=b.asset_type where b.id=any(p_bike_ids);
  payable:=case when p_rental_kind='institutional' then 0 when p_rental_kind='resident' then commercial-benefit else commercial end;
  if p_charged_amount is distinct from payable then raise exception 'invalid_charged_amount'; end if;
  ref:='AL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into rentals(reference,customer_ref,customer_contact,start_kiosk_id,started_by,charged_amount,charged_amount_recorded,rental_kind,rental_period,rental_hours,expected_amount,discount_amount,oeiras_move_confirmed,resident_proof_type,institutional_entity,institutional_person,price_override_reason)
  values(ref,left(trim(p_customer_ref),200),nullif(left(trim(coalesce(p_customer_contact,'')),50),''),p_start_kiosk_id,p_user_id,payable,true,p_rental_kind,case when p_rental_kind='institutional' then null else p_rental_period end,case when p_rental_kind='institutional' or p_rental_period='day' then null else p_rental_hours end,commercial,commercial-payable,case when p_rental_kind='resident' then p_oeiras_move_confirmed else false end,case when p_rental_kind='resident' then p_resident_proof_type else null end,case when p_rental_kind='institutional' then p_institutional_entity else null end,case when p_rental_kind='institutional' then left(trim(p_institutional_person),200) else null end,null) returning * into r;
  insert into rental_items(rental_id,bike_id) select r.id,unnest(p_bike_ids); update bikes set status='Alugada' where id=any(p_bike_ids);
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) select id,'Alugada',kiosk_id,p_user_id,'Início do aluguer '||ref from bikes where id=any(p_bike_ids);
  insert into audit_log(action,user_id,entity,entity_id,new_value) values('iniciar aluguer',p_user_id,'aluguer',r.id::text,to_jsonb(r)-'customer_contact'-'customer_ref'-'institutional_person');
  return to_jsonb(r)||jsonb_build_object('deposit_amount',case when p_rental_kind='institutional' then 0 else deposit end);
end; $$;

create or replace function change_open_rental_duration(p_rental_id uuid,p_period text,p_hours integer,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; commercial numeric(10,2); benefit numeric(10,2); payable numeric(10,2); additional numeric(10,2); multiplier integer;
begin
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if; if r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  if r.rental_kind='institutional' then raise exception 'institutional_has_no_period'; end if;
  if p_period not in ('hour','day') or (p_period='hour' and (p_hours is null or p_hours not between 1 and 168)) then raise exception 'invalid_rental_period'; end if;
  if p_period='hour' and r.rental_period='hour' and p_hours<=coalesce(r.rental_hours,1) then raise exception 'duration_must_increase'; end if;
  if r.rental_period='day' then raise exception 'rental_already_day'; end if;
  multiplier:=case when p_period='hour' then p_hours else 1 end;
  select coalesce(sum(equipment_duration_price(b.asset_type,p_period,multiplier,r.started_at)),0),coalesce(sum(case when et.resident_free then equipment_duration_price(b.asset_type,p_period,multiplier,r.started_at) else 0 end),0)
    into commercial,benefit from rental_items ri join bikes b on b.id=ri.bike_id join equipment_types et on et.code=b.asset_type where ri.rental_id=p_rental_id;
  payable:=case when r.rental_kind='resident' then commercial-benefit else commercial end; additional:=greatest(payable-r.charged_amount,0);
  update rentals set rental_period=p_period,rental_hours=case when p_period='hour' then p_hours else null end,expected_amount=commercial,discount_amount=commercial-payable,charged_amount=payable,corrected_at=now(),corrected_by=p_user_id,correction_reason='Prolongamento do período' where id=p_rental_id;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note) values('prolongar aluguer',p_user_id,'aluguer',p_rental_id::text,jsonb_build_object('period',r.rental_period,'hours',r.rental_hours,'charged_amount',r.charged_amount),jsonb_build_object('period',p_period,'hours',p_hours,'charged_amount',payable),'Prolongamento do período');
  return jsonb_build_object('additional_amount',additional,'charged_amount',payable,'expected_amount',commercial,'rental_period',p_period,'rental_hours',case when p_period='hour' then p_hours else null end);
end; $$;

create or replace function admin_correct_rental_duration(p_rental_id uuid,p_period text,p_hours integer,p_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; commercial numeric(10,2); benefit numeric(10,2); payable numeric(10,2); multiplier integer;
begin
  if p_period not in ('hour','day') or (p_period='hour' and (p_hours is null or p_hours not between 1 and 168)) then raise exception 'invalid_rental_period'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'correction_reason_required'; end if;
  select * into r from rentals where id=p_rental_id for update; if not found then raise exception 'rental_not_found'; end if; if r.rental_kind='institutional' then raise exception 'institutional_has_no_period'; end if;
  multiplier:=case when p_period='hour' then p_hours else 1 end;
  select coalesce(sum(equipment_duration_price(b.asset_type,p_period,multiplier,r.started_at)),0),coalesce(sum(case when et.resident_free then equipment_duration_price(b.asset_type,p_period,multiplier,r.started_at) else 0 end),0)
    into commercial,benefit from rental_items ri join bikes b on b.id=ri.bike_id join equipment_types et on et.code=b.asset_type where ri.rental_id=p_rental_id;
  payable:=case when r.rental_kind='resident' then commercial-benefit else commercial end;
  update rentals set rental_period=p_period,rental_hours=case when p_period='hour' then p_hours else null end,expected_amount=commercial,discount_amount=commercial-payable,corrected_at=now(),corrected_by=p_user_id,correction_reason=trim(p_reason) where id=p_rental_id;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note) values('corrigir período',p_user_id,'aluguer',p_rental_id::text,jsonb_build_object('period',r.rental_period,'hours',r.rental_hours),jsonb_build_object('period',p_period,'hours',p_hours,'commercial_amount',commercial,'tariff_amount',payable),trim(p_reason));
  return jsonb_build_object('rental_period',p_period,'rental_hours',case when p_period='hour' then p_hours else null end,'expected_amount',commercial,'charged_amount',r.charged_amount,'tariff_amount',payable);
end; $$;

grant execute on function start_rental(text,uuid,uuid[],uuid,text,numeric,text,text,integer,boolean,text,text,text,text) to service_role;
grant execute on function equipment_duration_price(text,text,integer,timestamptz) to service_role;
grant execute on function change_open_rental_duration(uuid,text,integer,uuid) to service_role;
grant execute on function admin_correct_rental_duration(uuid,text,integer,uuid,text) to service_role;

commit;
