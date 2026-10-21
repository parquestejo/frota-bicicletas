begin;

create table if not exists customer_profiles(
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('frequent','school')),
  name text not null check(length(trim(name)) between 2 and 200),
  nif text not null unique check(nif~'^[0-9]{9}$'),
  school text,
  phone text,
  email text,
  verified_by uuid references users(id) on delete set null,
  verified_at timestamptz,
  adult_present_confirmed boolean not null default false,
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((kind='school' and school is not null and adult_present_confirmed) or (kind='frequent' and phone is not null and email is not null))
);
alter table customer_profiles add column if not exists phone text;
alter table customer_profiles add column if not exists email text;
alter table customer_profiles add column if not exists verified_by uuid references users(id) on delete set null;
alter table customer_profiles add column if not exists verified_at timestamptz;

create table if not exists deposit_authorizations(
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null references customer_profiles(id) on delete restrict,
  authorization_code text not null check(length(trim(authorization_code)) between 1 and 80),
  amount numeric(10,2) not null default 50 check(amount>0),
  authorized_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check(status in ('active','cancelled','captured','expired')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(expires_at>authorized_at)
);
create index if not exists deposit_authorizations_active_idx on deposit_authorizations(customer_profile_id,status,expires_at desc);

alter table rentals drop constraint if exists rentals_rental_kind_check;
alter table rentals add constraint rentals_rental_kind_check check(rental_kind in ('normal','resident','institutional','frequent','school'));
alter table rentals add column if not exists customer_profile_id uuid references customer_profiles(id) on delete restrict;
alter table rentals add column if not exists deposit_authorization_id uuid references deposit_authorizations(id) on delete restrict;
alter table rentals add column if not exists authorization_code text check(authorization_code is null or length(trim(authorization_code)) between 1 and 80);
alter table rentals add column if not exists estimated_distance_km numeric(10,2) check(estimated_distance_km is null or estimated_distance_km>=0);
alter table rentals add column if not exists estimated_co2_kg numeric(10,3) check(estimated_co2_kg is null or estimated_co2_kg>=0);

create or replace function start_rental(
  p_customer_ref text,p_start_kiosk_id uuid,p_bike_ids uuid[],p_user_id uuid,p_customer_contact text,
  p_charged_amount numeric,p_rental_kind text,p_rental_period text,p_rental_hours integer,
  p_oeiras_move_confirmed boolean,p_resident_proof_type text,p_institutional_entity text,
  p_institutional_person text,p_price_override_reason text,p_customer_profile_id uuid,p_deposit_authorization_id uuid,p_authorization_code text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; ref text; commercial numeric(10,2); payable numeric(10,2); benefit numeric(10,2); deposit numeric(10,2); multiplier integer; bicycle_count integer; helmet_count integer; other_count integer;
begin
  if coalesce(array_length(p_bike_ids,1),0)=0 then raise exception 'no_bikes'; end if;
  if p_rental_kind not in ('normal','resident','institutional','frequent','school') or (p_rental_kind<>'institutional' and p_rental_period not in ('hour','day')) then raise exception 'invalid_rental_type'; end if;
  if p_rental_kind<>'institutional' and p_rental_period='hour' and (p_rental_hours is null or p_rental_hours not between 1 and 168) then raise exception 'invalid_rental_hours'; end if;
  if p_rental_kind='resident' and (not coalesce(p_oeiras_move_confirmed,false) or p_resident_proof_type not in ('AT','Dístico de residente','Subscrição 120 minutos')) then raise exception 'invalid_resident_benefit'; end if;
  if p_rental_kind='institutional' and (p_institutional_entity not in ('Parques Tejo','Município de Oeiras') or length(trim(coalesce(p_institutional_person,'')))=0) then raise exception 'invalid_institutional_use'; end if;
  if p_rental_kind<>'institutional' and length(trim(coalesce(p_authorization_code,'')))=0 then raise exception 'authorization_code_required'; end if;
  if p_rental_kind in ('frequent','school') and not exists(select 1 from customer_profiles where id=p_customer_profile_id and kind=p_rental_kind and active) then raise exception 'invalid_customer_profile'; end if;
  if p_rental_kind='frequent' and not exists(select 1 from deposit_authorizations where id=p_deposit_authorization_id and customer_profile_id=p_customer_profile_id and status='active' and expires_at>now() and authorization_code=trim(p_authorization_code)) then raise exception 'invalid_deposit_authorization'; end if;
  if not exists(select 1 from kiosks where id=p_start_kiosk_id and active=true and allows_rentals=true) then raise exception 'invalid_start_kiosk'; end if;
  perform 1 from bikes where id=any(p_bike_ids) order by id for update;
  if exists(select 1 from bikes where id=any(p_bike_ids) and (status<>'Disponível' or not active or kiosk_id<>p_start_kiosk_id)) or (select count(*) from bikes where id=any(p_bike_ids))<>array_length(p_bike_ids,1) then raise exception 'bike_not_available'; end if;
  select count(*) filter(where et.category='bicycle'),count(*) filter(where b.asset_type='helmet'),count(*) filter(where et.category<>'bicycle' and b.asset_type<>'helmet') into bicycle_count,helmet_count,other_count from bikes b join equipment_types et on et.code=b.asset_type where b.id=any(p_bike_ids);
  if p_rental_kind='school' and (bicycle_count<>1 or helmet_count>1 or other_count>0) then raise exception 'invalid_school_items'; end if;
  multiplier:=case when p_rental_period='hour' then p_rental_hours else 1 end;
  select coalesce(sum(equipment_duration_price(b.asset_type,coalesce(p_rental_period,'day'),multiplier,now())),0),
    coalesce(sum(case when (p_rental_kind='resident' and et.resident_free) or (p_rental_kind='frequent' and b.asset_type='helmet') or p_rental_kind='school' then equipment_duration_price(b.asset_type,p_rental_period,multiplier,now()) else 0 end),0),coalesce(sum(et.deposit_amount),0)
  into commercial,benefit,deposit from bikes b join equipment_types et on et.code=b.asset_type where b.id=any(p_bike_ids);
  payable:=case when p_rental_kind='institutional' then 0 else commercial-benefit end;
  if p_charged_amount is distinct from payable then raise exception 'invalid_charged_amount'; end if;
  ref:='AL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into rentals(reference,customer_ref,customer_contact,start_kiosk_id,started_by,charged_amount,charged_amount_recorded,rental_kind,rental_period,rental_hours,expected_amount,discount_amount,oeiras_move_confirmed,resident_proof_type,institutional_entity,institutional_person,price_override_reason,customer_profile_id,deposit_authorization_id,authorization_code)
  values(ref,left(trim(p_customer_ref),200),nullif(left(trim(coalesce(p_customer_contact,'')),50),''),p_start_kiosk_id,p_user_id,payable,true,p_rental_kind,case when p_rental_kind='institutional' then null else p_rental_period end,case when p_rental_kind='institutional' or p_rental_period='day' then null else p_rental_hours end,commercial,commercial-payable,case when p_rental_kind='resident' then p_oeiras_move_confirmed else false end,case when p_rental_kind='resident' then p_resident_proof_type else null end,case when p_rental_kind='institutional' then p_institutional_entity else null end,case when p_rental_kind='institutional' then left(trim(p_institutional_person),200) else null end,null,p_customer_profile_id,p_deposit_authorization_id,nullif(trim(p_authorization_code),'')) returning * into r;
  insert into rental_items(rental_id,bike_id) select r.id,unnest(p_bike_ids); update bikes set status='Alugada' where id=any(p_bike_ids);
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) select id,'Alugada',kiosk_id,p_user_id,'Início do aluguer '||ref from bikes where id=any(p_bike_ids);
  insert into audit_log(action,user_id,entity,entity_id,new_value) values('iniciar aluguer',p_user_id,'aluguer',r.id::text,to_jsonb(r)-'customer_contact'-'customer_ref');
  return to_jsonb(r)||jsonb_build_object('deposit_amount',case when p_rental_kind in ('institutional','school','frequent') then 0 else deposit end);
end; $$;

grant execute on function start_rental(text,uuid,uuid[],uuid,text,numeric,text,text,integer,boolean,text,text,text,text,uuid,uuid,text) to service_role;

commit;
