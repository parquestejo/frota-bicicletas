begin;

-- Distingue os quiosques de atendimento das localizações internas da frota.
alter table kiosks
  add column if not exists allows_rentals boolean not null default true;

insert into kiosks(name,active,allows_rentals)
values
  ('Armazém',true,false),
  ('Evento',true,false)
on conflict(name) do update
set active=true,allows_rentals=false;

commit;
