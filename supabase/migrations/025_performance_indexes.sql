begin;

-- Consultas introduzidas pelos perfis de cliente e pelas cauções.
create index if not exists customer_profiles_name_idx
  on customer_profiles (name);

create index if not exists deposit_authorizations_expiry_idx
  on deposit_authorizations (expires_at)
  where status = 'active';

create index if not exists rentals_customer_profile_history_idx
  on rentals (customer_profile_id, started_at desc)
  where customer_profile_id is not null;

create index if not exists rentals_started_by_history_idx
  on rentals (started_by, status, started_at desc);

create index if not exists rental_items_return_history_idx
  on rental_items (returned_at desc)
  where returned_at is not null;

-- Resolver os avisos remanescentes do Security Advisor.
alter function public.touch_updated_at() set search_path = '';
alter function public.clear_rental_contact_on_close() set search_path = '';
alter function public.scrub_rental_audit_pii() set search_path = '';

commit;
