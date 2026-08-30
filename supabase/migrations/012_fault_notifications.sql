begin;

create table if not exists notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  fault_id uuid not null references faults(id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(user_id,fault_id)
);
create index if not exists notifications_user_unread_idx
  on notifications(user_id,created_at desc) where read_at is null;
alter table notifications enable row level security;

create table if not exists fault_alert_email_queue(
  id uuid primary key default gen_random_uuid(),
  fault_id uuid not null unique references faults(id) on delete cascade,
  status text not null default 'pending'
    check(status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check(attempts>=0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists fault_alert_email_pending_idx
  on fault_alert_email_queue(status,available_at,created_at);
alter table fault_alert_email_queue enable row level security;

create or replace function enqueue_fault_notifications()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  bike_code text;
  kiosk_name text;
begin
  select b.code,k.name into bike_code,kiosk_name
  from bikes b join kiosks k on k.id=b.kiosk_id
  where b.id=new.bike_id;

  insert into notifications(user_id,fault_id,title,message)
  select
    u.id,
    new.id,
    'Nova avaria — '||coalesce(bike_code,'Item'),
    coalesce(kiosk_name,'Localização desconhecida')||' · '||new.severity||' · '||left(new.description,500)
  from users u
  where u.active=true and u.role in ('admin','manutencao')
  on conflict(user_id,fault_id) do nothing;

  insert into fault_alert_email_queue(fault_id)
  values(new.id)
  on conflict(fault_id) do nothing;
  return new;
end;
$$;

drop trigger if exists faults_enqueue_notifications on faults;
create trigger faults_enqueue_notifications
after insert on faults
for each row execute function enqueue_fault_notifications();

create or replace function claim_fault_alert_emails(p_limit integer default 10)
returns table(
  queue_id uuid,
  attempts integer,
  fault_id uuid,
  bike_code text,
  kiosk_name text,
  severity text,
  category text,
  description text,
  origin text,
  reported_by text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with candidates as (
    select q.id
    from fault_alert_email_queue q
    where q.attempts<5
      and q.available_at<=now()
      and (
        q.status='pending'
        or (q.status='processing' and q.locked_at<now()-interval '10 minutes')
      )
    order by q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),20))
  ), claimed as (
    update fault_alert_email_queue q
    set status='processing',locked_at=now(),attempts=q.attempts+1
    from candidates c
    where q.id=c.id
    returning q.id,q.attempts,q.fault_id
  )
  select
    c.id,c.attempts,c.fault_id,b.code,k.name,f.severity,f.category,f.description,
    f.origin,u.full_name,f.created_at
  from claimed c
  join faults f on f.id=c.fault_id
  join bikes b on b.id=f.bike_id
  join kiosks k on k.id=b.kiosk_id
  join users u on u.id=f.created_by;
end;
$$;

revoke all on function claim_fault_alert_emails(integer) from public;
grant execute on function claim_fault_alert_emails(integer) to service_role;

commit;
