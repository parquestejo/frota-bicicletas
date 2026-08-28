begin;

create table rental_discrepancies (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references rentals on delete restrict,
  bike_code text not null,
  description text not null,
  status text not null default 'Pendente' check (status in ('Pendente','Resolvida')),
  created_by uuid not null references users,
  created_at timestamptz not null default now(),
  resolved_by uuid references users,
  resolved_at timestamptz,
  resolution text
);

create index rental_discrepancies_status_idx on rental_discrepancies(status, created_at desc);
create index rental_discrepancies_rental_idx on rental_discrepancies(rental_id, created_at desc);
alter table rental_discrepancies enable row level security;

create or replace function add_bike_to_open_rental(
  p_rental_id uuid,
  p_bike_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r rentals; b bikes; ri rental_items;
begin
  select * into r from rentals where id=p_rental_id for update;
  if not found or r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  select * into b from bikes where id=p_bike_id for update;
  if not found or not b.active or b.status<>'Disponível' then raise exception 'bike_not_available'; end if;
  if b.kiosk_id<>r.start_kiosk_id then raise exception 'bike_wrong_kiosk'; end if;
  insert into rental_items(rental_id,bike_id) values(r.id,b.id) returning * into ri;
  update bikes set status='Alugada' where id=b.id;
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
  values(b.id,'Alugada',b.kiosk_id,p_user_id,'Bicicleta adicionada ao aluguer '||r.reference);
  insert into audit_log(action,user_id,entity,entity_id,new_value,note)
  values('adicionar bicicleta',p_user_id,'aluguer',r.id::text,to_jsonb(ri),'Correção de aluguer em aberto');
  return to_jsonb(ri);
end$$;

create or replace function remove_bike_from_open_rental(
  p_rental_id uuid,
  p_rental_item_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r rentals; ri rental_items; remaining integer;
begin
  select * into r from rentals where id=p_rental_id for update;
  if not found or r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  select * into ri from rental_items where id=p_rental_item_id and rental_id=r.id for update;
  if not found or ri.returned_at is not null then raise exception 'invalid_rental_item'; end if;
  select count(*) into remaining from rental_items where rental_id=r.id and returned_at is null;
  if remaining<=1 then raise exception 'cannot_remove_last_bike'; end if;
  delete from rental_items where id=ri.id;
  update bikes set status='Disponível',kiosk_id=r.start_kiosk_id where id=ri.bike_id;
  insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
  values(ri.bike_id,'Disponível',r.start_kiosk_id,p_user_id,'Bicicleta removida por correção do aluguer '||r.reference);
  insert into audit_log(action,user_id,entity,entity_id,old_value,note)
  values('remover bicicleta',p_user_id,'aluguer',r.id::text,to_jsonb(ri),'Correção de aluguer em aberto');
  return to_jsonb(ri);
end$$;

revoke all on function add_bike_to_open_rental(uuid,uuid,uuid) from public;
revoke all on function remove_bike_from_open_rental(uuid,uuid,uuid) from public;

commit;
