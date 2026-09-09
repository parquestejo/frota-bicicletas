-- A introdução do novo valor do enum tem de ser confirmada antes de poder ser
-- utilizada pelas funções criadas abaixo.
begin;
alter type rental_status add value if not exists 'Anulado';
commit;

begin;

alter table rentals add column if not exists corrected_at timestamptz;
alter table rentals add column if not exists corrected_by uuid references users;
alter table rentals add column if not exists correction_reason text;

alter table daily_closures add column if not exists corrected_at timestamptz;
alter table daily_closures add column if not exists corrected_by uuid references users;
alter table daily_closures add column if not exists correction_reason text;

alter table faults add column if not exists resolved_at timestamptz;

alter table kiosks add column if not exists closure_due_time time;
alter table kiosks add column if not exists closure_grace_minutes integer not null default 30;
alter table kiosks add column if not exists operating_days smallint[] not null default array[1,2,3,4,5,6,7]::smallint[];
alter table kiosks drop constraint if exists kiosks_closure_grace_check;
alter table kiosks add constraint kiosks_closure_grace_check check(closure_grace_minutes between 0 and 240);

create table if not exists daily_closure_revisions(
  id uuid primary key default gen_random_uuid(),
  closure_id uuid not null references daily_closures(id) on delete restrict,
  corrected_by uuid not null references users,
  reason text not null,
  old_value jsonb not null,
  new_value jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists daily_closure_revisions_closure_idx on daily_closure_revisions(closure_id,created_at desc);
alter table daily_closure_revisions enable row level security;

create table if not exists email_settings(
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  admin_recipients text[] not null default '{}'::text[],
  maintenance_recipients text[] not null default '{}'::text[],
  weekly_day smallint not null default 1 check(weekly_day between 1 and 7),
  weekly_time time not null default '08:00',
  updated_at timestamptz not null default now()
);
insert into email_settings(id) values(true) on conflict(id) do nothing;
alter table email_settings enable row level security;

create table if not exists email_outbox(
  id uuid primary key default gen_random_uuid(),
  event_type text not null check(event_type in ('fault_created','fault_resolved','closure_submitted','closure_missing','weekly_summary','test_email')),
  dedupe_key text not null unique,
  entity_id text,
  recipient_group text not null check(recipient_group in ('admin','maintenance_and_admin')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check(attempts>=0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_pending_idx on email_outbox(status,available_at,created_at);
alter table email_outbox enable row level security;

-- A chave única passa a ser verificável apenas no commit, permitindo corrigir
-- trocas de duas bicicletas no mesmo aluguer concluído numa só transação.
alter table rental_items drop constraint if exists rental_items_rental_id_bike_id_key;
alter table rental_items add constraint rental_items_rental_id_bike_id_key
  unique(rental_id,bike_id) deferrable initially deferred;

create or replace function admin_correct_rental(
  p_rental_id uuid,
  p_customer_ref text,
  p_customer_contact text,
  p_charged_amount numeric,
  p_start_kiosk_id uuid,
  p_started_at timestamptz,
  p_returned_at timestamptz,
  p_items jsonb,
  p_void boolean,
  p_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  old_rental rentals;
  updated_rental rentals;
  old_snapshot jsonb;
  new_snapshot jsonb;
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'correction_reason_required'; end if;
  select * into old_rental from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if nullif(trim(p_customer_ref),'') is null or char_length(trim(p_customer_ref))>200 then raise exception 'invalid_customer_ref'; end if;
  if p_charged_amount is null or p_charged_amount<0 or p_charged_amount>100000 then raise exception 'invalid_charged_amount'; end if;
  if p_started_at is null or p_started_at>now()+interval '5 minutes' then raise exception 'invalid_started_at'; end if;
  if not exists(select 1 from kiosks where id=p_start_kiosk_id and allows_rentals=true) then raise exception 'invalid_start_kiosk'; end if;
  if old_rental.status='Concluído' and not p_void and (p_returned_at is null or p_returned_at<p_started_at) then raise exception 'invalid_returned_at'; end if;

  select jsonb_build_object(
    'rental',to_jsonb(old_rental)-'customer_ref'-'customer_contact',
    'customer_ref_changed',false,
    'items',coalesce(jsonb_agg(to_jsonb(ri) order by ri.id),'[]'::jsonb)
  ) into old_snapshot
  from rental_items ri where ri.rental_id=old_rental.id;

  if p_void and old_rental.status='Em aberto' then
    update rental_items set returned_at=now(),returned_by=p_user_id,return_kiosk_id=old_rental.start_kiosk_id
    where rental_id=old_rental.id and returned_at is null;
    update bikes b set status='Disponível',kiosk_id=old_rental.start_kiosk_id
    where exists(select 1 from rental_items ri where ri.rental_id=old_rental.id and ri.bike_id=b.id);
    insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
    select ri.bike_id,'Disponível',old_rental.start_kiosk_id,p_user_id,'Aluguer anulado pelo administrador'
    from rental_items ri where ri.rental_id=old_rental.id;
  elsif old_rental.status='Concluído' and p_items is not null then
    if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'rental_items_required'; end if;
    if jsonb_array_length(p_items)<>(select count(*) from rental_items where rental_id=old_rental.id) then raise exception 'rental_item_count_mismatch'; end if;
    if exists(
      select 1 from jsonb_array_elements(p_items) x
      left join rental_items ri on ri.id=(x->>'id')::uuid and ri.rental_id=old_rental.id
      left join bikes b on b.id=(x->>'bike_id')::uuid
      left join kiosks k on k.id=(x->>'return_kiosk_id')::uuid
      where ri.id is null or b.id is null or k.id is null or (x->>'returned_at')::timestamptz<p_started_at
    ) then raise exception 'invalid_rental_items'; end if;
    if (select count(distinct x->>'bike_id') from jsonb_array_elements(p_items)x)<>jsonb_array_length(p_items) then raise exception 'duplicate_rental_items'; end if;
    update rental_items ri set
      bike_id=(x.value->>'bike_id')::uuid,
      return_kiosk_id=(x.value->>'return_kiosk_id')::uuid,
      returned_at=(x.value->>'returned_at')::timestamptz
    from jsonb_array_elements(p_items) x
    where ri.id=(x.value->>'id')::uuid and ri.rental_id=old_rental.id;
  end if;

  if old_rental.status='Em aberto' and not p_void and old_rental.start_kiosk_id is distinct from p_start_kiosk_id then
    update bikes b set kiosk_id=p_start_kiosk_id
    where exists(select 1 from rental_items ri where ri.rental_id=old_rental.id and ri.bike_id=b.id and ri.returned_at is null);
    insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
    select ri.bike_id,'Alugada',p_start_kiosk_id,p_user_id,'Quiosque de saída corrigido no aluguer '||old_rental.reference
    from rental_items ri where ri.rental_id=old_rental.id and ri.returned_at is null;
  end if;

  update rentals set
    customer_ref=trim(p_customer_ref),
    customer_contact=case when old_rental.status='Em aberto' and not p_void then nullif(trim(coalesce(p_customer_contact,'')),'') else null end,
    charged_amount=p_charged_amount,
    charged_amount_recorded=true,
    start_kiosk_id=p_start_kiosk_id,
    started_at=p_started_at,
    returned_at=case when p_void and old_rental.status='Em aberto' then now() when old_rental.status='Concluído' then p_returned_at else null end,
    returned_by=case when p_void and old_rental.status='Em aberto' then p_user_id else returned_by end,
    status=case when p_void then 'Anulado'::rental_status else status end,
    corrected_at=now(),corrected_by=p_user_id,correction_reason=trim(p_reason)
  where id=old_rental.id returning * into updated_rental;

  select jsonb_build_object(
    'rental',to_jsonb(updated_rental)-'customer_ref'-'customer_contact',
    'customer_ref_changed',old_rental.customer_ref<>updated_rental.customer_ref,
    'items',coalesce(jsonb_agg(to_jsonb(ri) order by ri.id),'[]'::jsonb)
  ) into new_snapshot
  from rental_items ri where ri.rental_id=old_rental.id;
  old_snapshot=jsonb_set(old_snapshot,'{customer_ref_changed}',to_jsonb(old_rental.customer_ref<>updated_rental.customer_ref));
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note)
  values(case when p_void then 'anular' else 'corrigir' end,p_user_id,'aluguer',old_rental.id::text,old_snapshot,new_snapshot,trim(p_reason));
  return to_jsonb(updated_rental);
end;
$$;

create or replace function claim_email_outbox(p_limit integer default 10)
returns table(job_id uuid,event_type text,dedupe_key text,entity_id text,recipient_group text,payload jsonb,attempts integer)
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with candidates as (
    select e.id from email_outbox e
    where e.attempts<5 and e.available_at<=now()
      and (e.status='pending' or (e.status='processing' and e.locked_at<now()-interval '10 minutes'))
    order by e.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,10),20))
  ), claimed as (
    update email_outbox e set status='processing',locked_at=now(),attempts=e.attempts+1
    from candidates c where e.id=c.id
    returning e.id,e.event_type,e.dedupe_key,e.entity_id,e.recipient_group,e.payload,e.attempts
  ) select c.* from claimed c;
end;
$$;

create or replace function enqueue_fault_notifications()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare bike_code text;kiosk_name text;
begin
  select b.code,k.name into bike_code,kiosk_name from bikes b join kiosks k on k.id=b.kiosk_id where b.id=new.bike_id;
  insert into notifications(user_id,fault_id,title,message)
  select u.id,new.id,'Nova avaria — '||coalesce(bike_code,'Item'),coalesce(kiosk_name,'Localização desconhecida')||' · '||new.severity||' · '||left(new.description,500)
  from users u where u.active=true and u.role in('admin','manutencao') on conflict(user_id,fault_id) do nothing;
  insert into email_outbox(event_type,dedupe_key,entity_id,recipient_group,payload)
  values('fault_created','fault-created:'||new.id,new.id::text,'maintenance_and_admin','{}') on conflict(dedupe_key) do nothing;
  return new;
end;
$$;

create or replace function enqueue_fault_resolution_email()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='Resolvida' and old.status is distinct from new.status then
    new.resolved_at=coalesce(new.resolved_at,now());
    insert into email_outbox(event_type,dedupe_key,entity_id,recipient_group,payload)
    values('fault_resolved','fault-resolved:'||new.id,new.id::text,'maintenance_and_admin','{}') on conflict(dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists faults_enqueue_resolution_email on faults;
create trigger faults_enqueue_resolution_email before update of status on faults for each row execute function enqueue_fault_resolution_email();

create or replace function enqueue_closure_email()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and new.status='Submetido' then
    insert into email_outbox(event_type,dedupe_key,entity_id,recipient_group,payload)
    values('closure_submitted','closure-submitted:'||new.id||':'||extract(epoch from new.updated_at)::bigint,new.id::text,'admin','{}')
    on conflict(dedupe_key) do nothing;
  elsif tg_op='UPDATE' and new.status='Submetido' and (
    old.status is distinct from new.status or old.updated_at is distinct from new.updated_at
  ) then
    insert into email_outbox(event_type,dedupe_key,entity_id,recipient_group,payload)
    values('closure_submitted','closure-submitted:'||new.id||':'||extract(epoch from new.updated_at)::bigint,new.id::text,'admin','{}')
    on conflict(dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists daily_closures_enqueue_email on daily_closures;
create trigger daily_closures_enqueue_email after insert or update on daily_closures for each row execute function enqueue_closure_email();

-- Os alugueres anulados permanecem auditáveis, mas deixam de contar nos fechos
-- e nos indicadores de gestão.
create or replace function daily_closure_stats(p_report_date date,p_kiosk_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'rental_count',count(distinct r.id),
    'bike_count',count(ri.id) filter(where b.asset_type in ('electric','conventional','child')),
    'electric_count',count(ri.id) filter(where b.asset_type='electric'),
    'conventional_count',count(ri.id) filter(where b.asset_type='conventional'),
    'child_count',count(ri.id) filter(where b.asset_type='child'),
    'accessory_count',count(ri.id) filter(where b.asset_type in ('helmet','lock','stroller')),
    'charged_total',coalesce((select sum(r2.charged_amount) from rentals r2 where r2.started_by=p_user_id and r2.start_kiosk_id=p_kiosk_id and r2.status<>'Anulado' and (r2.started_at at time zone 'Europe/Lisbon')::date=p_report_date),0)
  ) from rentals r left join rental_items ri on ri.rental_id=r.id left join bikes b on b.id=ri.bike_id
  where r.started_by=p_user_id and r.start_kiosk_id=p_kiosk_id and r.status<>'Anulado' and (r.started_at at time zone 'Europe/Lisbon')::date=p_report_date;
$$;

create or replace function rental_payment_analytics(p_from date default null,p_to date default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with bounds as (select coalesce(p_from,date '2000-01-01') from_date,coalesce(p_to,(now() at time zone 'Europe/Lisbon')::date) to_date),
  filtered as (select r.* from rentals r,bounds b where r.status<>'Anulado' and (r.started_at at time zone 'Europe/Lisbon')::date between b.from_date and b.to_date)
  select jsonb_build_object('paid_rental_count',count(*) filter(where charged_amount_recorded and charged_amount>0),'free_rental_count',count(*) filter(where charged_amount_recorded and charged_amount=0),'unclassified_rental_count',count(*) filter(where not charged_amount_recorded),'revenue',coalesce(sum(charged_amount) filter(where charged_amount_recorded),0)) from filtered;
$$;

create or replace function rental_management_analytics(p_from date default null,p_to date default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with bounds as (
    select coalesce(p_from,date '2000-01-01') from_date,coalesce(p_to,(now() at time zone 'Europe/Lisbon')::date) to_date
  ), filtered as (
    select r.*,(r.started_at at time zone 'Europe/Lisbon')::date local_date from rentals r,bounds b
    where r.status<>'Anulado' and (r.started_at at time zone 'Europe/Lisbon')::date between b.from_date and b.to_date
  ), daily as (
    select local_date,count(*) rental_count,coalesce(sum((select count(*) from rental_items ri where ri.rental_id=f.id)),0) item_count,coalesce(sum(charged_amount),0) revenue from filtered f group by local_date
  ), weekdays as (
    select extract(isodow from local_date)::integer weekday_number,case extract(isodow from local_date)::integer when 1 then 'Segunda-feira' when 2 then 'Terça-feira' when 3 then 'Quarta-feira' when 4 then 'Quinta-feira' when 5 then 'Sexta-feira' when 6 then 'Sábado' else 'Domingo' end weekday,count(*) rental_count from filtered group by local_date,extract(isodow from local_date)
  ), weekday_totals as (
    select weekday_number,weekday,sum(rental_count) rental_count from weekdays group by weekday_number,weekday
  ), kiosk_totals as (
    select k.id,k.name,count(f.id) rental_count,coalesce(sum(f.charged_amount),0) revenue from kiosks k left join filtered f on f.start_kiosk_id=k.id where k.allows_rentals=true group by k.id,k.name
  ), type_totals as (
    select b.asset_type,count(ri.id) item_count from filtered f join rental_items ri on ri.rental_id=f.id join bikes b on b.id=ri.bike_id group by b.asset_type
  ), incidents as (
    select ai.*,k.name kiosk_name,extract(epoch from (least(coalesce(ai.ended_at,now()),((b.to_date+1)::timestamp at time zone 'Europe/Lisbon'))-greatest(ai.started_at,(b.from_date::timestamp at time zone 'Europe/Lisbon'))))/60 duration_minutes
    from availability_incidents ai join kiosks k on k.id=ai.kiosk_id,bounds b where (ai.started_at at time zone 'Europe/Lisbon')::date<=b.to_date and (coalesce(ai.ended_at,now()) at time zone 'Europe/Lisbon')::date>=b.from_date
  ), incident_days as (
    select distinct generated_day::date local_date from incidents i,bounds b cross join lateral generate_series(greatest((i.started_at at time zone 'Europe/Lisbon')::date,b.from_date),least((coalesce(i.ended_at,now()) at time zone 'Europe/Lisbon')::date,b.to_date),interval '1 day') generated_day
  ) select jsonb_build_object(
    'rental_count',(select count(*) from filtered),'item_count',(select count(*) from rental_items ri join filtered f on f.id=ri.rental_id),'revenue',coalesce((select sum(charged_amount) from filtered),0),
    'average_duration_minutes',coalesce((select round(avg(extract(epoch from (returned_at-started_at))/60)) from filtered where returned_at is not null),0),
    'busiest_weekday',coalesce((select weekday from weekday_totals order by rental_count desc,weekday_number limit 1),'—'),
    'busiest_days',coalesce((select jsonb_agg(to_jsonb(x) order by x.rental_count desc,x.local_date desc) from (select * from daily order by rental_count desc,local_date desc limit 10)x),'[]'::jsonb),
    'weekdays',coalesce((select jsonb_agg(to_jsonb(x) order by x.weekday_number) from weekday_totals x),'[]'::jsonb),
    'kiosks',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from kiosk_totals x),'[]'::jsonb),
    'asset_types',coalesce((select jsonb_agg(to_jsonb(x) order by x.item_count desc) from type_totals x),'[]'::jsonb),
    'stockout_days',(select count(*) from incident_days),'stockout_minutes',coalesce((select round(sum(duration_minutes)) from incidents),0),'stockouts',coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from incidents x),'[]'::jsonb)
  );
$$;

revoke all on function admin_correct_rental(uuid,text,text,numeric,uuid,timestamptz,timestamptz,jsonb,boolean,uuid,text) from public;
revoke all on function claim_email_outbox(integer) from public;
grant execute on function admin_correct_rental(uuid,text,text,numeric,uuid,timestamptz,timestamptz,jsonb,boolean,uuid,text) to service_role;
grant execute on function claim_email_outbox(integer) to service_role;
grant execute on function daily_closure_stats(date,uuid,uuid) to service_role;
grant execute on function rental_payment_analytics(date,date) to service_role;
grant execute on function rental_management_analytics(date,date) to service_role;

commit;
