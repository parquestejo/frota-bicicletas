begin;

create index if not exists faults_bike_open_idx
  on faults(bike_id, status)
  where status in ('Aberta','Em análise','Em reparação');

-- A referência do cliente permanece no aluguer enquanto vigorar a política de
-- retenção, mas não é duplicada no registo técnico de auditoria.
create or replace function scrub_rental_audit_pii()
returns trigger
language plpgsql
as $$
begin
  if new.entity='aluguer' then
    new.old_value := coalesce(new.old_value,'{}'::jsonb)-'customer_ref'-'customer_contact';
    new.new_value := coalesce(new.new_value,'{}'::jsonb)-'customer_ref'-'customer_contact';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_log_scrub_rental_pii on audit_log;
create trigger audit_log_scrub_rental_pii
before insert or update on audit_log
for each row execute function scrub_rental_audit_pii();

update audit_log
set old_value=coalesce(old_value,'{}'::jsonb)-'customer_ref'-'customer_contact',
    new_value=coalesce(new_value,'{}'::jsonb)-'customer_ref'-'customer_contact'
where entity='aluguer'
  and (
    coalesce(old_value,'{}'::jsonb) ?| array['customer_ref','customer_contact']
    or coalesce(new_value,'{}'::jsonb) ?| array['customer_ref','customer_contact']
  );

-- Edita o inventário e cria a ocorrência necessária na mesma transação.
-- O estado "Alugada" é sempre controlado pelos fluxos de aluguer/devolução.
create or replace function update_inventory_item(
  p_bike_id uuid,
  p_code text,
  p_asset_type text,
  p_model text,
  p_status text,
  p_kiosk_id uuid,
  p_active boolean,
  p_user_id uuid,
  p_fault_description text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  old_bike bikes;
  updated_bike bikes;
  effective_status bike_status;
  has_open_rental boolean;
  has_open_fault boolean;
  new_fault_status fault_status;
begin
  select * into old_bike from bikes where id=p_bike_id for update;
  if not found then raise exception 'bike_not_found'; end if;

  if not exists(select 1 from kiosks where id=p_kiosk_id and active=true) then
    raise exception 'invalid_kiosk';
  end if;
  if nullif(trim(p_code),'') is null or nullif(trim(p_model),'') is null then
    raise exception 'invalid_inventory_data';
  end if;
  if p_asset_type not in ('electric','conventional','child','helmet','lock','stroller') then
    raise exception 'invalid_asset_type';
  end if;
  if p_status not in ('Disponível','Alugada','Avariada','Em manutenção','Indisponível') then
    raise exception 'invalid_bike_status';
  end if;

  select exists(
    select 1 from rental_items where bike_id=p_bike_id and returned_at is null
  ) into has_open_rental;
  select exists(
    select 1 from faults
    where bike_id=p_bike_id and status in ('Aberta','Em análise','Em reparação')
  ) into has_open_fault;

  effective_status := case when p_active then p_status::bike_status else 'Indisponível'::bike_status end;

  if has_open_rental and (
    effective_status<>'Alugada' or p_kiosk_id<>old_bike.kiosk_id or not p_active
  ) then
    raise exception 'bike_has_open_rental';
  end if;
  if not has_open_rental and effective_status='Alugada' then
    raise exception 'rental_required_for_rented_status';
  end if;
  if has_open_fault and effective_status in ('Disponível','Indisponível') then
    raise exception 'bike_has_open_fault';
  end if;
  if has_open_fault and not p_active then
    raise exception 'bike_has_open_fault';
  end if;

  update bikes set
    code=upper(trim(p_code)),
    asset_type=p_asset_type,
    model=trim(p_model),
    status=effective_status,
    kiosk_id=p_kiosk_id,
    active=p_active
  where id=p_bike_id
  returning * into updated_bike;

  if effective_status in ('Avariada','Em manutenção') and not has_open_fault then
    new_fault_status := case
      when effective_status='Em manutenção' then 'Em reparação'::fault_status
      else 'Aberta'::fault_status
    end;
    insert into faults(
      bike_id,created_by,origin,category,description,severity,usable,status
    ) values(
      p_bike_id,p_user_id,'comunicada diretamente','outra',
      coalesce(nullif(trim(p_fault_description),''),'Item marcado como '||effective_status||' na gestão da frota.'),
      'Média',false,new_fault_status
    );
  end if;

  if old_bike.status<>updated_bike.status or old_bike.kiosk_id<>updated_bike.kiosk_id then
    insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
    values(p_bike_id,updated_bike.status,updated_bike.kiosk_id,p_user_id,'Atualização na gestão da frota');
  end if;

  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value)
  values('alterar',p_user_id,'bicicleta',p_bike_id::text,to_jsonb(old_bike),to_jsonb(updated_bike));
  return to_jsonb(updated_bike);
end;
$$;

-- Comunicar uma avaria durante um aluguer não altera prematuramente o estado
-- "Alugada". O bloqueio operacional será aplicado na devolução.
create or replace function create_fault(
  p_bike_id uuid,
  p_origin text,
  p_category text,
  p_description text,
  p_severity text,
  p_usable boolean,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  f faults;
  current_bike bikes;
  has_open_rental boolean;
begin
  select * into current_bike from bikes where id=p_bike_id for update;
  if not found then raise exception 'bike_not_found'; end if;
  select exists(
    select 1 from rental_items where bike_id=p_bike_id and returned_at is null
  ) into has_open_rental;

  insert into faults(bike_id,created_by,origin,category,description,severity,usable)
  values(p_bike_id,p_user_id,p_origin,p_category,trim(p_description),p_severity,p_usable)
  returning * into f;

  if (not p_usable or p_severity='Impeditiva') and not has_open_rental then
    update bikes set status='Avariada' where id=p_bike_id;
    insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
    values(p_bike_id,'Avariada',current_bike.kiosk_id,p_user_id,'Avaria registada');
  end if;

  insert into audit_log(action,user_id,entity,entity_id,new_value)
  values('registar avaria',p_user_id,'avaria',f.id::text,to_jsonb(f));
  return to_jsonb(f);
end;
$$;

-- A ocorrência, a intervenção e o estado final do item são atualizados juntos.
create or replace function update_fault(
  p_fault_id uuid,
  p_status text,
  p_final_bike_status text,
  p_user_id uuid,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  old_fault faults;
  updated_fault faults;
  current_bike bikes;
  other_open_faults boolean;
  other_in_repair boolean;
  has_open_rental boolean;
begin
  select * into old_fault from faults where id=p_fault_id for update;
  if not found then raise exception 'fault_not_found'; end if;
  select * into current_bike from bikes where id=old_fault.bike_id for update;
  select exists(
    select 1 from rental_items where bike_id=old_fault.bike_id and returned_at is null
  ) into has_open_rental;

  if p_status not in ('Aberta','Em análise','Em reparação','Resolvida','Cancelada') then
    raise exception 'invalid_fault_status';
  end if;
  if p_status='Resolvida' and p_final_bike_status not in ('Disponível','Indisponível','Em manutenção') then
    raise exception 'final_status_required';
  end if;
  if has_open_rental and p_status in ('Em reparação','Resolvida') then
    raise exception 'bike_has_open_rental';
  end if;

  update faults
  set status=p_status::fault_status,
      notes=coalesce(nullif(trim(p_note),''),notes)
  where id=p_fault_id
  returning * into updated_fault;

  select exists(
    select 1 from faults
    where bike_id=old_fault.bike_id
      and id<>p_fault_id
      and status in ('Aberta','Em análise','Em reparação')
  ), exists(
    select 1 from faults
    where bike_id=old_fault.bike_id
      and id<>p_fault_id
      and status='Em reparação'
  ) into other_open_faults, other_in_repair;

  if p_status='Em reparação' then
    update bikes set status='Em manutenção' where id=old_fault.bike_id;
  elsif p_status='Resolvida' then
    if other_open_faults and p_final_bike_status='Disponível' then
      raise exception 'other_open_faults';
    end if;
    update bikes
    set status=(case
      when other_in_repair then 'Em manutenção'::bike_status
      when other_open_faults then 'Avariada'::bike_status
      else p_final_bike_status::bike_status
    end)
    where id=old_fault.bike_id;
  elsif p_status='Cancelada' and not has_open_rental then
    if not other_open_faults and current_bike.status in ('Avariada','Em manutenção') then
      update bikes set status='Disponível' where id=old_fault.bike_id;
    elsif other_in_repair then
      update bikes set status='Em manutenção' where id=old_fault.bike_id;
    elsif other_open_faults then
      update bikes set status='Avariada' where id=old_fault.bike_id;
    end if;
  elsif not updated_fault.usable or updated_fault.severity='Impeditiva' then
    update bikes set status='Avariada' where id=old_fault.bike_id and status<>'Alugada';
  end if;

  if nullif(trim(p_note),'') is not null then
    insert into maintenance_interventions(fault_id,description,created_by)
    values(p_fault_id,trim(p_note),p_user_id);
  end if;

  if p_status in ('Em reparação','Resolvida','Cancelada') then
    insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
    select id,status,kiosk_id,p_user_id,coalesce(nullif(trim(p_note),''),'Atualização da avaria')
    from bikes where id=old_fault.bike_id;
  end if;

  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note)
  values('atualizar avaria',p_user_id,'avaria',p_fault_id::text,to_jsonb(old_fault),to_jsonb(updated_fault),nullif(trim(p_note),''));
  return to_jsonb(updated_fault);
end;
$$;

-- Totais exatos, sem depender do limite de linhas apresentado no ecrã.
create or replace function rental_period_summary(p_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with completed as (
    select (returned_at at time zone 'Europe/Lisbon') as returned_local
    from rentals
    where status='Concluído'
      and returned_at is not null
      and (p_user_id is null or started_by=p_user_id)
  ), reference_dates as (
    select
      now() at time zone 'Europe/Lisbon' as local_now,
      date_trunc('week',now() at time zone 'Europe/Lisbon') as week_start,
      date_trunc('month',now() at time zone 'Europe/Lisbon') as month_start
  )
  select jsonb_build_object(
    'completed_today',count(*) filter(where completed.returned_local::date=reference_dates.local_now::date),
    'completed_week',count(*) filter(where completed.returned_local>=reference_dates.week_start),
    'completed_month',count(*) filter(where completed.returned_local>=reference_dates.month_start),
    'completed_all',count(*)
  )
  from completed cross join reference_dates;
$$;

revoke all on function update_inventory_item(uuid,text,text,text,text,uuid,boolean,uuid,text) from public;
revoke all on function create_fault(uuid,text,text,text,text,boolean,uuid) from public;
revoke all on function update_fault(uuid,text,text,uuid,text) from public;
revoke all on function rental_period_summary(uuid) from public;

grant execute on function update_inventory_item(uuid,text,text,text,text,uuid,boolean,uuid,text) to service_role;
grant execute on function create_fault(uuid,text,text,text,text,boolean,uuid) to service_role;
grant execute on function update_fault(uuid,text,text,uuid,text) to service_role;
grant execute on function rental_period_summary(uuid) to service_role;
grant execute on function start_rental(text,uuid,uuid[],uuid,text) to service_role;
grant execute on function return_rental_items(uuid,uuid,jsonb,uuid) to service_role;
grant execute on function add_bike_to_open_rental(uuid,uuid,uuid) to service_role;
grant execute on function remove_bike_from_open_rental(uuid,uuid,uuid) to service_role;
grant execute on function daily_closure_stats(date,uuid,uuid) to service_role;

commit;
