begin;

-- Identificação permanente e participação automática no programa de pontos.
alter table customer_profiles add column if not exists membership_code text;
alter table customer_profiles add column if not exists gamification_opt_in boolean not null default true;
alter table customer_profiles add column if not exists public_ranking_opt_in boolean not null default false;
alter table customer_profiles add column if not exists gamification_consent_at timestamptz;
alter table customer_profiles add column if not exists gamification_consent_by uuid references users(id) on delete set null;
alter table customer_profiles alter column gamification_opt_in set default true;

-- Todos os registos especiais participam automaticamente. Não existe ranking público nominal.
update customer_profiles
set gamification_opt_in=true,
    public_ranking_opt_in=false,
    gamification_consent_at=null,
    gamification_consent_by=null
where gamification_opt_in is distinct from true
   or public_ranking_opt_in is distinct from false
   or gamification_consent_at is not null
   or gamification_consent_by is not null;

update customer_profiles
set membership_code='MOVE-'||upper(substr(replace(id::text,'-',''),1,8))
where membership_code is null;
alter table customer_profiles alter column membership_code set not null;
alter table customer_profiles alter column membership_code set default ('MOVE-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
create unique index if not exists customer_profiles_membership_code_key on customer_profiles(membership_code);

create table if not exists gamification_campaigns(
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 3 and 120),
  description text not null default '',
  audience text not null default 'all' check(audience in ('all','frequent','school')),
  starts_on date not null,
  ends_on date not null,
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(ends_on>=starts_on)
);
alter table gamification_campaigns enable row level security;

create table if not exists gamification_rewards(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references gamification_campaigns(id) on delete cascade,
  name text not null check(length(trim(name)) between 2 and 120),
  points_cost integer not null check(points_cost>=0),
  stock integer check(stock is null or stock>=0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table gamification_rewards enable row level security;

create table if not exists gamification_redemptions(
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null references customer_profiles(id) on delete restrict,
  reward_id uuid not null references gamification_rewards(id) on delete restrict,
  points_spent integer not null check(points_spent>=0),
  awarded_by uuid references users(id) on delete set null,
  note text,
  awarded_at timestamptz not null default now()
);
create index if not exists gamification_redemptions_customer_idx on gamification_redemptions(customer_profile_id,awarded_at desc);
alter table gamification_redemptions enable row level security;

-- Histórico técnico. Não guarda parâmetros, clientes ou conteúdos dos pedidos.
create table if not exists api_performance_logs(
  id bigint generated always as identity primary key,
  route text not null,
  method text not null,
  status_code integer not null,
  duration_ms integer not null check(duration_ms>=0),
  db_duration_ms integer not null check(db_duration_ms>=0),
  db_calls integer not null check(db_calls>=0),
  created_at timestamptz not null default now()
);
create index if not exists api_performance_logs_created_idx on api_performance_logs(created_at desc);
create index if not exists api_performance_logs_route_idx on api_performance_logs(route,created_at desc);
alter table api_performance_logs enable row level security;

create table if not exists automated_job_runs(
  id bigint generated always as identity primary key,
  job_name text not null,
  status text not null check(status in ('success','failed')),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now()
);
create index if not exists automated_job_runs_created_idx on automated_job_runs(finished_at desc);
alter table automated_job_runs enable row level security;

create or replace function operational_diagnostics()
returns jsonb language sql security definer set search_path=public as $$
with local_day as (
  select (now() at time zone 'Europe/Lisbon')::date as today
), issues as (
  select 'long_open_rental'::text issue_type,'high'::text severity,r.id::text entity_id,
    'Aluguer aberto há mais de 24 horas'::text title,
    r.reference||' · iniciado em '||to_char(r.started_at at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI') detail
  from rentals r where r.status='Em aberto' and r.started_at<now()-interval '24 hours'
  union all
  select 'rented_without_rental','critical',b.id::text,'Item marcado como alugado sem aluguer aberto',b.code
  from bikes b where b.active and b.status='Alugada' and not exists(
    select 1 from rental_items ri join rentals r on r.id=ri.rental_id
    where ri.bike_id=b.id and ri.returned_at is null and r.status='Em aberto'
  )
  union all
  select 'open_item_wrong_status','critical',b.id::text,'Item de aluguer aberto com estado incorreto',b.code||' · '||b.status::text
  from bikes b where exists(
    select 1 from rental_items ri join rentals r on r.id=ri.rental_id
    where ri.bike_id=b.id and ri.returned_at is null and r.status='Em aberto'
  ) and b.status<>'Alugada'
  union all
  select 'closure_without_rentals','high',c.id::text,'Fecho com recebimentos sem alugueres',
    c.report_date::text||' · '||k.name||' · '||to_char(c.card_total,'FM999999990.00')||' €'
  from daily_closures c join kiosks k on k.id=c.kiosk_id
  where c.status='Submetido' and c.card_total>0 and c.rental_count=0 and c.report_date>=current_date-30
  union all
  select 'missing_closure','high',k.id::text,'Fecho diário em falta',
    (d.today-1)::text||' · '||k.name
  from kiosks k cross join local_day d
  where k.active and k.allows_rentals and extract(isodow from d.today-1)::integer=any(k.operating_days)
    and not exists(select 1 from daily_closures c where c.kiosk_id=k.id and c.report_date=d.today-1 and c.status='Submetido')
  union all
  select 'deposit_expiring','medium',a.id::text,'Caução terminada ou a terminar',
    p.name||' · '||to_char(a.expires_at at time zone 'Europe/Lisbon','DD/MM/YYYY')
  from deposit_authorizations a join customer_profiles p on p.id=a.customer_profile_id
  where a.status='active' and a.expires_at<=now()+interval '3 days'
  union all
  select 'kiosk_without_bicycles','high',k.id::text,'Quiosque sem bicicletas disponíveis',k.name
  from kiosks k where k.active and k.allows_rentals and not exists(
    select 1 from bikes b join equipment_types et on et.code=b.asset_type
    where b.kiosk_id=k.id and b.active and b.status='Disponível' and et.category='bicycle'
  )
)
select jsonb_build_object('generated_at',now(),'issues',coalesce(jsonb_agg(to_jsonb(issues) order by
  case severity when 'critical' then 1 when 'high' then 2 else 3 end,title),'[]'::jsonb)) from issues;
$$;

create or replace function gamification_dashboard()
returns jsonb language sql security definer set search_path=public as $$
with rental_days as (
  select r.customer_profile_id,(r.returned_at at time zone 'Europe/Lisbon')::date rental_day,
    count(*) rental_count,coalesce(sum(r.estimated_distance_km),0) km,coalesce(sum(r.estimated_co2_kg),0) co2
  from rentals r where r.status='Concluído' and r.customer_profile_id is not null
  group by r.customer_profile_id,(r.returned_at at time zone 'Europe/Lisbon')::date
), stats as (
  select p.id,p.kind,p.name,p.school,p.membership_code,p.public_ranking_opt_in,
    coalesce(sum(d.rental_count),0)::integer rental_count,round(coalesce(sum(d.km),0),2) km,round(coalesce(sum(d.co2),0),3) co2,
    coalesce(sum(10+least(30,floor(d.km)::integer)),0)::integer earned_points
  from customer_profiles p left join rental_days d on d.customer_profile_id=p.id
  where p.active
  group by p.id
), spent as (
  select customer_profile_id,coalesce(sum(points_spent),0)::integer points_spent from gamification_redemptions group by customer_profile_id
), ranked as (
  select s.*,greatest(0,s.earned_points-coalesce(sp.points_spent,0)) available_points,
    case when s.earned_points>=750 then 'Embaixador' when s.earned_points>=300 then 'Explorador' when s.earned_points>=100 then 'Pedalante' else 'Iniciante' end level
  from stats s left join spent sp on sp.customer_profile_id=s.id
), schools as (
  select school,count(*) participants,sum(rental_count)::integer rental_count,round(sum(km),2) km,round(sum(co2),3) co2,sum(earned_points)::integer points
  from ranked where kind='school' group by school
)
select jsonb_build_object(
  'customers',coalesce((select jsonb_agg(to_jsonb(ranked) order by earned_points desc,name) from ranked),'[]'::jsonb),
  'schools',coalesce((select jsonb_agg(to_jsonb(schools) order by points desc,school) from schools),'[]'::jsonb)
);
$$;

revoke execute on function operational_diagnostics() from public,anon,authenticated;
revoke execute on function gamification_dashboard() from public,anon,authenticated;
grant execute on function operational_diagnostics() to service_role;
grant execute on function gamification_dashboard() to service_role;

commit;
