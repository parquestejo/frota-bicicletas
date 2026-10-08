begin;

create table if not exists equipment_types(
  code text primary key check(code~'^[a-z][a-z0-9_]{1,29}$'),
  name text not null check(length(trim(name)) between 2 and 80),
  category text not null check(category in ('bicycle','accessory')),
  prefix text not null unique check(prefix~'^[A-Z]{1,6}$'),
  default_model text not null,
  deposit_amount numeric(10,2) not null default 0 check(deposit_amount>=0 and deposit_amount<=10000),
  resident_free boolean not null default false,
  included boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into equipment_types(code,name,category,prefix,default_model,deposit_amount,resident_free,included) values
 ('electric','Bicicleta elétrica','bicycle','E','Bicicleta elétrica',50,true,false),
 ('conventional','Bicicleta convencional','bicycle','C','Bicicleta convencional',50,true,false),
 ('child','Bicicleta de criança','bicycle','I','Bicicleta infantil',50,true,false),
 ('helmet','Capacete','accessory','CAP','Capacete',0,false,false),
 ('lock','Cadeado','accessory','CAD','Cadeado',0,false,true),
 ('stroller','Porta-bebé','accessory','CAR','Porta-bebé',0,false,false)
on conflict(code) do nothing;

alter table bikes drop constraint if exists bikes_asset_type_check;

create table if not exists equipment_prices(
  id uuid primary key default gen_random_uuid(),
  asset_type text not null references equipment_types(code) on delete restrict,
  period text not null check(period in ('hour','day')),
  amount numeric(10,2) not null check(amount>=0 and amount<=100000),
  effective_from timestamptz not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(asset_type,period,effective_from)
);
create index if not exists equipment_prices_current_idx on equipment_prices(asset_type,period,effective_from desc);

insert into equipment_prices(asset_type,period,amount,effective_from)
select v.asset_type,v.period,v.amount,timestamptz '2026-01-01 00:00:00+00'
from (values
 ('electric','hour',4::numeric),('electric','day',10),('conventional','hour',2),('conventional','day',6),
 ('child','hour',2),('child','day',3),('stroller','hour',2),('stroller','day',3),
 ('helmet','hour',1),('helmet','day',1),('lock','hour',0),('lock','day',0)
) v(asset_type,period,amount)
where not exists(select 1 from equipment_prices p where p.asset_type=v.asset_type and p.period=v.period);

create or replace function equipment_price(p_asset_type text,p_period text,p_at timestamptz default now())
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((select amount from equipment_prices
    where asset_type=p_asset_type and period=p_period and effective_from<=p_at
    order by effective_from desc limit 1),0);
$$;

create or replace function start_rental(
  p_customer_ref text,p_start_kiosk_id uuid,p_bike_ids uuid[],p_user_id uuid,p_customer_contact text,
  p_charged_amount numeric,p_rental_kind text,p_rental_period text,p_oeiras_move_confirmed boolean,
  p_resident_proof_type text,p_institutional_entity text,p_institutional_person text,p_price_override_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; ref text; commercial numeric(10,2); payable numeric(10,2); benefit numeric(10,2); deposit numeric(10,2);
begin
  if coalesce(array_length(p_bike_ids,1),0)=0 then raise exception 'no_bikes'; end if;
  if p_rental_kind not in ('normal','resident','institutional') or (p_rental_kind<>'institutional' and p_rental_period not in ('hour','day')) then raise exception 'invalid_rental_type'; end if;
  if p_rental_kind='resident' and (not coalesce(p_oeiras_move_confirmed,false) or p_resident_proof_type not in ('AT','Dístico de residente','Subscrição 120 minutos')) then raise exception 'invalid_resident_benefit'; end if;
  if p_rental_kind='institutional' and (p_institutional_entity not in ('Parques Tejo','Município de Oeiras') or length(trim(coalesce(p_institutional_person,'')))=0) then raise exception 'invalid_institutional_use'; end if;
  if not exists(select 1 from kiosks where id=p_start_kiosk_id and active=true and allows_rentals=true) then raise exception 'invalid_start_kiosk'; end if;
  perform 1 from bikes where id=any(p_bike_ids) order by id for update;
  if exists(select 1 from bikes where id=any(p_bike_ids) and (status<>'Disponível' or not active or kiosk_id<>p_start_kiosk_id)) or (select count(*) from bikes where id=any(p_bike_ids))<>array_length(p_bike_ids,1) then raise exception 'bike_not_available'; end if;
  select coalesce(sum(equipment_price(b.asset_type,coalesce(p_rental_period,'day'),now())),0),
    coalesce(sum(case when et.resident_free then equipment_price(b.asset_type,p_rental_period,now()) else 0 end),0),
    coalesce(sum(et.deposit_amount),0)
  into commercial,benefit,deposit from bikes b join equipment_types et on et.code=b.asset_type where b.id=any(p_bike_ids);
  payable:=case when p_rental_kind='institutional' then 0 when p_rental_kind='resident' then commercial-benefit else commercial end;
  if p_charged_amount is distinct from payable then raise exception 'invalid_charged_amount'; end if;
  ref:='AL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into rentals(reference,customer_ref,customer_contact,start_kiosk_id,started_by,charged_amount,charged_amount_recorded,rental_kind,rental_period,expected_amount,discount_amount,oeiras_move_confirmed,resident_proof_type,institutional_entity,institutional_person,price_override_reason)
  values(ref,left(trim(p_customer_ref),200),nullif(left(trim(coalesce(p_customer_contact,'')),50),''),p_start_kiosk_id,p_user_id,payable,true,p_rental_kind,case when p_rental_kind='institutional' then null else p_rental_period end,commercial,commercial-payable,case when p_rental_kind='resident' then p_oeiras_move_confirmed else false end,case when p_rental_kind='resident' then p_resident_proof_type else null end,case when p_rental_kind='institutional' then p_institutional_entity else null end,case when p_rental_kind='institutional' then left(trim(p_institutional_person),200) else null end,null) returning * into r;
  insert into rental_items(rental_id,bike_id) select r.id,unnest(p_bike_ids);
  update bikes set status='Alugada' where id=any(p_bike_ids);
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) select id,'Alugada',kiosk_id,p_user_id,'Início do aluguer '||ref from bikes where id=any(p_bike_ids);
  insert into audit_log(action,user_id,entity,entity_id,new_value) values('iniciar aluguer',p_user_id,'aluguer',r.id::text,to_jsonb(r)-'customer_contact'-'customer_ref'-'institutional_person');
  return to_jsonb(r)||jsonb_build_object('deposit_amount',case when p_rental_kind='institutional' then 0 else deposit end);
end; $$;

create or replace function extend_open_rental_to_day(p_rental_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; commercial numeric(10,2); benefit numeric(10,2); payable numeric(10,2); additional numeric(10,2);
begin
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  if r.rental_kind='institutional' then raise exception 'institutional_has_no_period'; end if;
  if r.rental_period='day' then raise exception 'rental_already_day'; end if;
  select coalesce(sum(equipment_price(b.asset_type,'day',r.started_at)),0),coalesce(sum(case when et.resident_free then equipment_price(b.asset_type,'day',r.started_at) else 0 end),0)
    into commercial,benefit from rental_items ri join bikes b on b.id=ri.bike_id join equipment_types et on et.code=b.asset_type where ri.rental_id=p_rental_id;
  payable:=case when r.rental_kind='resident' then commercial-benefit else commercial end; additional:=greatest(payable-r.charged_amount,0);
  update rentals set rental_period='day',expected_amount=commercial,discount_amount=commercial-payable,charged_amount=payable,corrected_at=now(),corrected_by=p_user_id,correction_reason='Prolongamento de 1 hora para 1 dia' where id=p_rental_id;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note) values('prolongar aluguer',p_user_id,'aluguer',p_rental_id::text,jsonb_build_object('period','hour','charged_amount',r.charged_amount),jsonb_build_object('period','day','charged_amount',payable),'Prolongamento de 1 hora para 1 dia');
  return jsonb_build_object('additional_amount',additional,'charged_amount',payable,'expected_amount',commercial);
end; $$;

create or replace function admin_correct_rental_period(p_rental_id uuid,p_period text,p_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; commercial numeric(10,2); benefit numeric(10,2); payable numeric(10,2);
begin
  if p_period not in ('hour','day') then raise exception 'invalid_rental_period'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'correction_reason_required'; end if;
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.rental_kind='institutional' then raise exception 'institutional_has_no_period'; end if;
  select coalesce(sum(equipment_price(b.asset_type,p_period,r.started_at)),0),coalesce(sum(case when et.resident_free then equipment_price(b.asset_type,p_period,r.started_at) else 0 end),0)
    into commercial,benefit from rental_items ri join bikes b on b.id=ri.bike_id join equipment_types et on et.code=b.asset_type where ri.rental_id=p_rental_id;
  payable:=case when r.rental_kind='resident' then commercial-benefit else commercial end;
  update rentals set rental_period=p_period,expected_amount=commercial,discount_amount=commercial-payable,corrected_at=now(),corrected_by=p_user_id,correction_reason=trim(p_reason) where id=p_rental_id;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note) values('corrigir período',p_user_id,'aluguer',p_rental_id::text,jsonb_build_object('period',r.rental_period),jsonb_build_object('period',p_period,'commercial_amount',commercial,'tariff_amount',payable),trim(p_reason));
  return jsonb_build_object('rental_period',p_period,'expected_amount',commercial,'charged_amount',r.charged_amount,'tariff_amount',payable);
end; $$;

revoke all on function equipment_price(text,text,timestamptz) from public;
grant execute on function equipment_price(text,text,timestamptz) to service_role;
grant execute on function start_rental(text,uuid,uuid[],uuid,text,numeric,text,text,boolean,text,text,text,text) to service_role;
grant execute on function extend_open_rental_to_day(uuid,uuid) to service_role;
grant execute on function admin_correct_rental_period(uuid,text,uuid,text) to service_role;

create or replace function update_inventory_item(p_bike_id uuid,p_code text,p_asset_type text,p_model text,p_status text,p_kiosk_id uuid,p_active boolean,p_user_id uuid,p_fault_description text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old_bike bikes; updated_bike bikes; effective_status bike_status; has_open_rental boolean; has_open_fault boolean; new_fault_status fault_status; expected_prefix text;
begin
  select * into old_bike from bikes where id=p_bike_id for update; if not found then raise exception 'bike_not_found'; end if;
  if not exists(select 1 from kiosks where id=p_kiosk_id and active=true) then raise exception 'invalid_kiosk'; end if;
  select prefix into expected_prefix from equipment_types where code=p_asset_type;
  if expected_prefix is null or upper(trim(p_code)) !~ ('^'||expected_prefix||'[0-9]{3,6}$') then raise exception 'invalid_asset_type'; end if;
  if nullif(trim(p_model),'') is null then raise exception 'invalid_inventory_data'; end if;
  if p_status not in ('Disponível','Alugada','Avariada','Em manutenção','Indisponível') then raise exception 'invalid_bike_status'; end if;
  select exists(select 1 from rental_items where bike_id=p_bike_id and returned_at is null) into has_open_rental;
  select exists(select 1 from faults where bike_id=p_bike_id and status in ('Aberta','Em análise','Em reparação')) into has_open_fault;
  effective_status:=case when p_active then p_status::bike_status else 'Indisponível'::bike_status end;
  if has_open_rental and (effective_status<>'Alugada' or p_kiosk_id<>old_bike.kiosk_id or not p_active) then raise exception 'bike_has_open_rental'; end if;
  if not has_open_rental and effective_status='Alugada' then raise exception 'rental_required_for_rented_status'; end if;
  if has_open_fault and (effective_status in ('Disponível','Indisponível') or not p_active) then raise exception 'bike_has_open_fault'; end if;
  update bikes set code=upper(trim(p_code)),asset_type=p_asset_type,model=trim(p_model),status=effective_status,kiosk_id=p_kiosk_id,active=p_active where id=p_bike_id returning * into updated_bike;
  if effective_status in ('Avariada','Em manutenção') and not has_open_fault then
    new_fault_status:=case when effective_status='Em manutenção' then 'Em reparação'::fault_status else 'Aberta'::fault_status end;
    insert into faults(bike_id,created_by,origin,category,description,severity,usable,status) values(p_bike_id,p_user_id,'comunicada diretamente','outra',coalesce(nullif(trim(p_fault_description),''),'Item marcado como '||effective_status||' na gestão da frota.'),'Média',false,new_fault_status);
  end if;
  if old_bike.status<>updated_bike.status or old_bike.kiosk_id<>updated_bike.kiosk_id then insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) values(p_bike_id,updated_bike.status,updated_bike.kiosk_id,p_user_id,'Atualização na gestão da frota'); end if;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value) values('alterar',p_user_id,'bicicleta',p_bike_id::text,to_jsonb(old_bike),to_jsonb(updated_bike)); return to_jsonb(updated_bike);
end; $$;
grant execute on function update_inventory_item(uuid,text,text,text,text,uuid,boolean,uuid,text) to service_role;

commit;
