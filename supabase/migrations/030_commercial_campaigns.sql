begin;

create table if not exists commercial_campaigns(
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 2 and 120),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  benefit_type text not null check(benefit_type in ('free_hours','percentage','fixed_discount','free_rental')),
  benefit_value numeric(10,2) not null default 1 check(benefit_value>=0),
  applies_to_category text not null default 'bicycle' check(applies_to_category in ('bicycle','accessory','all')),
  max_items integer not null default 1 check(max_items between 1 and 100),
  confirmation_label text not null check(length(trim(confirmation_label)) between 3 and 200),
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at>starts_at),
  check(benefit_type<>'percentage' or benefit_value between 0 and 100),
  check(benefit_type<>'free_hours' or (benefit_value between 1 and 168 and benefit_value=trunc(benefit_value)))
);
create index if not exists commercial_campaigns_active_idx on commercial_campaigns(active,starts_at,ends_at);
alter table commercial_campaigns enable row level security;

alter table rentals add column if not exists commercial_campaign_id uuid references commercial_campaigns(id) on delete restrict;
alter table rentals add column if not exists commercial_campaign_discount numeric(10,2) not null default 0 check(commercial_campaign_discount>=0);
alter table rentals add column if not exists commercial_campaign_confirmed boolean not null default false;
create index if not exists rentals_commercial_campaign_idx on rentals(commercial_campaign_id,started_at desc) where commercial_campaign_id is not null;

insert into commercial_campaigns(name,description,starts_at,ends_at,benefit_type,benefit_value,applies_to_category,max_items,confirmation_label)
select 'Halloween — 1 hora gratuita','Uma bicicleta com a primeira hora gratuita para clientes mascarados.',
  '2026-10-31 00:00:00 Europe/Lisbon'::timestamptz,'2026-11-02 00:00:00 Europe/Lisbon'::timestamptz,
  'free_hours',1,'bicycle',1,'Confirmo que o cliente se apresentou mascarado'
where not exists(select 1 from commercial_campaigns where name='Halloween — 1 hora gratuita' and starts_at='2026-10-31 00:00:00 Europe/Lisbon'::timestamptz);

create or replace function commercial_campaign_discount_for_items(
  p_campaign_id uuid,p_bike_ids uuid[],p_period text,p_hours integer,p_at timestamptz,p_payable numeric
) returns numeric language plpgsql stable security definer set search_path=public as $$
declare c commercial_campaigns; calculated numeric(10,2):=0; multiplier integer;
begin
  if p_campaign_id is null or coalesce(p_payable,0)<=0 then return 0; end if;
  select * into c from commercial_campaigns where id=p_campaign_id;
  if not found then return 0; end if;
  multiplier:=case when p_period='hour' then greatest(coalesce(p_hours,1),1) else 1 end;
  if c.benefit_type='free_hours' then
    select coalesce(sum(free_value),0) into calculated from (
      select equipment_duration_price(b.asset_type,p_period,multiplier,p_at)-case
        when p_period='hour' and greatest(multiplier-c.benefit_value::integer,0)=0 then 0
        when p_period='hour' then equipment_duration_price(b.asset_type,p_period,greatest(multiplier-c.benefit_value::integer,0),p_at)
        else greatest(equipment_duration_price(b.asset_type,p_period,multiplier,p_at)-equipment_price(b.asset_type,'hour',p_at)*c.benefit_value,0)
      end free_value
      from bikes b join equipment_types et on et.code=b.asset_type
      where b.id=any(p_bike_ids) and (c.applies_to_category='all' or et.category=c.applies_to_category)
      order by equipment_price(b.asset_type,'hour',p_at) desc,b.id
      limit c.max_items
    ) selected_items;
  elsif c.benefit_type='percentage' then calculated:=p_payable*c.benefit_value/100;
  elsif c.benefit_type='fixed_discount' then calculated:=c.benefit_value;
  elsif c.benefit_type='free_rental' then calculated:=p_payable;
  end if;
  return round(least(p_payable,greatest(calculated,0)),2);
end; $$;

create or replace function start_rental(
  p_customer_ref text,p_start_kiosk_id uuid,p_bike_ids uuid[],p_user_id uuid,p_customer_contact text,
  p_charged_amount numeric,p_rental_kind text,p_rental_period text,p_rental_hours integer,
  p_oeiras_move_confirmed boolean,p_resident_proof_type text,p_institutional_entity text,
  p_institutional_person text,p_price_override_reason text,p_customer_profile_id uuid,p_deposit_authorization_id uuid,p_authorization_code text,
  p_commercial_campaign_id uuid,p_commercial_campaign_confirmed boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; ref text; commercial numeric(10,2); payable numeric(10,2); benefit numeric(10,2); deposit numeric(10,2); campaign_discount numeric(10,2):=0; multiplier integer; bicycle_count integer; helmet_count integer; other_count integer; campaign commercial_campaigns;
begin
  if coalesce(array_length(p_bike_ids,1),0)=0 then raise exception 'no_bikes'; end if;
  if p_rental_kind not in ('normal','resident','institutional','frequent','school') or (p_rental_kind<>'institutional' and p_rental_period not in ('hour','day')) then raise exception 'invalid_rental_type'; end if;
  if p_rental_kind<>'institutional' and p_rental_period='hour' and (p_rental_hours is null or p_rental_hours not between 1 and 168) then raise exception 'invalid_rental_hours'; end if;
  if p_rental_kind='resident' and (not coalesce(p_oeiras_move_confirmed,false) or p_resident_proof_type not in ('AT','Dístico de residente','Subscrição 120 minutos')) then raise exception 'invalid_resident_benefit'; end if;
  if p_rental_kind='institutional' and (p_institutional_entity not in ('Parques Tejo','Município de Oeiras') or length(trim(coalesce(p_institutional_person,'')))=0) then raise exception 'invalid_institutional_use'; end if;
  if p_rental_kind<>'institutional' and length(trim(coalesce(p_authorization_code,'')))=0 then raise exception 'authorization_code_required'; end if;
  if p_rental_kind in ('frequent','school') and not exists(select 1 from customer_profiles where id=p_customer_profile_id and kind=p_rental_kind and active) then raise exception 'invalid_customer_profile'; end if;
  if p_rental_kind='frequent' and not exists(select 1 from deposit_authorizations where id=p_deposit_authorization_id and customer_profile_id=p_customer_profile_id and status='active' and expires_at>now() and authorization_code=trim(p_authorization_code)) then raise exception 'invalid_deposit_authorization'; end if;
  if p_commercial_campaign_id is not null then
    select * into campaign from commercial_campaigns where id=p_commercial_campaign_id and active and starts_at<=now() and ends_at>now();
    if not found or p_rental_kind in ('institutional','school') then raise exception 'invalid_commercial_campaign'; end if;
    if not coalesce(p_commercial_campaign_confirmed,false) then raise exception 'commercial_campaign_confirmation_required'; end if;
  end if;
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
  campaign_discount:=commercial_campaign_discount_for_items(p_commercial_campaign_id,p_bike_ids,p_rental_period,p_rental_hours,now(),payable);
  payable:=greatest(payable-campaign_discount,0);
  if p_charged_amount is distinct from payable then raise exception 'invalid_charged_amount'; end if;
  ref:='AL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into rentals(reference,customer_ref,customer_contact,start_kiosk_id,started_by,charged_amount,charged_amount_recorded,rental_kind,rental_period,rental_hours,expected_amount,discount_amount,oeiras_move_confirmed,resident_proof_type,institutional_entity,institutional_person,price_override_reason,customer_profile_id,deposit_authorization_id,authorization_code,commercial_campaign_id,commercial_campaign_discount,commercial_campaign_confirmed)
  values(ref,left(trim(p_customer_ref),200),nullif(left(trim(coalesce(p_customer_contact,'')),50),''),p_start_kiosk_id,p_user_id,payable,true,p_rental_kind,case when p_rental_kind='institutional' then null else p_rental_period end,case when p_rental_kind='institutional' or p_rental_period='day' then null else p_rental_hours end,commercial,commercial-payable,case when p_rental_kind='resident' then p_oeiras_move_confirmed else false end,case when p_rental_kind='resident' then p_resident_proof_type else null end,case when p_rental_kind='institutional' then p_institutional_entity else null end,case when p_rental_kind='institutional' then left(trim(p_institutional_person),200) else null end,null,p_customer_profile_id,p_deposit_authorization_id,nullif(trim(p_authorization_code),''),p_commercial_campaign_id,campaign_discount,p_commercial_campaign_id is not null and coalesce(p_commercial_campaign_confirmed,false)) returning * into r;
  insert into rental_items(rental_id,bike_id) select r.id,unnest(p_bike_ids); update bikes set status='Alugada' where id=any(p_bike_ids);
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) select id,'Alugada',kiosk_id,p_user_id,'Início do aluguer '||ref from bikes where id=any(p_bike_ids);
  insert into audit_log(action,user_id,entity,entity_id,new_value) values('iniciar aluguer',p_user_id,'aluguer',r.id::text,to_jsonb(r)-'customer_contact'-'customer_ref');
  return to_jsonb(r)||jsonb_build_object('deposit_amount',case when p_rental_kind in ('institutional','school','frequent') then 0 else deposit end);
end; $$;

create or replace function change_open_rental_duration(p_rental_id uuid,p_period text,p_hours integer,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; commercial numeric(10,2); benefit numeric(10,2); payable numeric(10,2); campaign_discount numeric(10,2); additional numeric(10,2); multiplier integer; item_ids uuid[];
begin
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if; if r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  if r.rental_kind='institutional' then raise exception 'institutional_has_no_period'; end if;
  if p_period not in ('hour','day') or (p_period='hour' and (p_hours is null or p_hours not between 1 and 168)) then raise exception 'invalid_rental_period'; end if;
  if p_period='hour' and r.rental_period='hour' and p_hours<=coalesce(r.rental_hours,1) then raise exception 'duration_must_increase'; end if;
  if r.rental_period='day' then raise exception 'rental_already_day'; end if;
  multiplier:=case when p_period='hour' then p_hours else 1 end;
  select array_agg(b.id),coalesce(sum(equipment_duration_price(b.asset_type,p_period,multiplier,r.started_at)),0),
    coalesce(sum(case when (r.rental_kind='resident' and et.resident_free) or (r.rental_kind='frequent' and b.asset_type='helmet') or r.rental_kind='school' then equipment_duration_price(b.asset_type,p_period,multiplier,r.started_at) else 0 end),0)
  into item_ids,commercial,benefit from rental_items ri join bikes b on b.id=ri.bike_id join equipment_types et on et.code=b.asset_type where ri.rental_id=p_rental_id;
  payable:=commercial-benefit;
  campaign_discount:=commercial_campaign_discount_for_items(r.commercial_campaign_id,item_ids,p_period,p_hours,r.started_at,payable);
  payable:=greatest(payable-campaign_discount,0); additional:=greatest(payable-r.charged_amount,0);
  update rentals set rental_period=p_period,rental_hours=case when p_period='hour' then p_hours else null end,expected_amount=commercial,discount_amount=commercial-payable,commercial_campaign_discount=campaign_discount,charged_amount=payable,corrected_at=now(),corrected_by=p_user_id,correction_reason='Prolongamento do período' where id=p_rental_id;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note) values('prolongar aluguer',p_user_id,'aluguer',p_rental_id::text,jsonb_build_object('period',r.rental_period,'hours',r.rental_hours,'charged_amount',r.charged_amount),jsonb_build_object('period',p_period,'hours',p_hours,'charged_amount',payable),'Prolongamento do período');
  return jsonb_build_object('additional_amount',additional,'charged_amount',payable,'expected_amount',commercial,'rental_period',p_period,'rental_hours',case when p_period='hour' then p_hours else null end);
end; $$;

create or replace function admin_correct_rental_duration(p_rental_id uuid,p_period text,p_hours integer,p_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; commercial numeric(10,2); benefit numeric(10,2); payable numeric(10,2); campaign_discount numeric(10,2); multiplier integer; item_ids uuid[];
begin
  if p_period not in ('hour','day') or (p_period='hour' and (p_hours is null or p_hours not between 1 and 168)) then raise exception 'invalid_rental_period'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'correction_reason_required'; end if;
  select * into r from rentals where id=p_rental_id for update; if not found then raise exception 'rental_not_found'; end if; if r.rental_kind='institutional' then raise exception 'institutional_has_no_period'; end if;
  multiplier:=case when p_period='hour' then p_hours else 1 end;
  select array_agg(b.id),coalesce(sum(equipment_duration_price(b.asset_type,p_period,multiplier,r.started_at)),0),
    coalesce(sum(case when (r.rental_kind='resident' and et.resident_free) or (r.rental_kind='frequent' and b.asset_type='helmet') or r.rental_kind='school' then equipment_duration_price(b.asset_type,p_period,multiplier,r.started_at) else 0 end),0)
  into item_ids,commercial,benefit from rental_items ri join bikes b on b.id=ri.bike_id join equipment_types et on et.code=b.asset_type where ri.rental_id=p_rental_id;
  payable:=commercial-benefit;
  campaign_discount:=commercial_campaign_discount_for_items(r.commercial_campaign_id,item_ids,p_period,p_hours,r.started_at,payable);
  payable:=greatest(payable-campaign_discount,0);
  update rentals set rental_period=p_period,rental_hours=case when p_period='hour' then p_hours else null end,expected_amount=commercial,discount_amount=commercial-payable,commercial_campaign_discount=campaign_discount,corrected_at=now(),corrected_by=p_user_id,correction_reason=trim(p_reason) where id=p_rental_id;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note) values('corrigir período',p_user_id,'aluguer',p_rental_id::text,jsonb_build_object('period',r.rental_period,'hours',r.rental_hours),jsonb_build_object('period',p_period,'hours',p_hours,'commercial_amount',commercial,'tariff_amount',payable),trim(p_reason));
  return jsonb_build_object('rental_period',p_period,'rental_hours',case when p_period='hour' then p_hours else null end,'expected_amount',commercial,'charged_amount',r.charged_amount,'tariff_amount',payable);
end; $$;

create or replace function commercial_campaign_analytics(p_from date default null,p_to date default null)
returns jsonb language sql stable security definer set search_path=public as $$
with bounds as (select coalesce(p_from,date '2000-01-01') from_date,coalesce(p_to,(now() at time zone 'Europe/Lisbon')::date) to_date), totals as (
  select c.id,c.name,count(r.id)::integer rental_count,coalesce(sum(r.expected_amount),0) commercial_value,
    coalesce(sum(r.commercial_campaign_discount),0) discount_value,coalesce(sum(r.charged_amount),0) revenue
  from commercial_campaigns c join rentals r on r.commercial_campaign_id=c.id,bounds b
  where r.status<>'Anulado' and (r.started_at at time zone 'Europe/Lisbon')::date between b.from_date and b.to_date
  group by c.id,c.name
)
select coalesce(jsonb_agg(to_jsonb(totals) order by rental_count desc,name),'[]'::jsonb) from totals;
$$;

grant execute on function commercial_campaign_discount_for_items(uuid,uuid[],text,integer,timestamptz,numeric) to service_role;
grant execute on function start_rental(text,uuid,uuid[],uuid,text,numeric,text,text,integer,boolean,text,text,text,text,uuid,uuid,text,uuid,boolean) to service_role;
grant execute on function change_open_rental_duration(uuid,text,integer,uuid) to service_role;
grant execute on function admin_correct_rental_duration(uuid,text,integer,uuid,text) to service_role;
grant execute on function commercial_campaign_analytics(date,date) to service_role;

commit;
