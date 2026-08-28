begin;

create type daily_closure_status as enum ('Rascunho', 'Submetido');

create table daily_closures (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  kiosk_id uuid not null references kiosks,
  user_id uuid not null references users,
  rental_count integer not null default 0 check (rental_count >= 0),
  bike_count integer not null default 0 check (bike_count >= 0),
  electric_count integer not null default 0 check (electric_count >= 0),
  conventional_count integer not null default 0 check (conventional_count >= 0),
  card_total numeric(10,2) not null default 0 check (card_total >= 0),
  receipt_path text,
  receipt_name text,
  receipt_content_type text,
  observations text,
  status daily_closure_status not null default 'Rascunho',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, kiosk_id, user_id)
);

create index daily_closures_date_idx on daily_closures(report_date desc);
create index daily_closures_kiosk_idx on daily_closures(kiosk_id, report_date desc);
create index daily_closures_user_idx on daily_closures(user_id, report_date desc);

create trigger daily_closures_touch before update on daily_closures
for each row execute function touch_updated_at();

alter table daily_closures enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'daily-closure-receipts',
  'daily-closure-receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function daily_closure_stats(
  p_report_date date,
  p_kiosk_id uuid,
  p_user_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rental_count', count(distinct r.id),
    'bike_count', count(ri.id),
    'electric_count', count(ri.id) filter (where b.code like 'E%'),
    'conventional_count', count(ri.id) filter (where b.code like 'C%')
  )
  from rentals r
  left join rental_items ri on ri.rental_id = r.id
  left join bikes b on b.id = ri.bike_id
  where r.started_by = p_user_id
    and r.start_kiosk_id = p_kiosk_id
    and (r.started_at at time zone 'Europe/Lisbon')::date = p_report_date;
$$;

revoke all on function daily_closure_stats(date, uuid, uuid) from public;

commit;
