begin;

-- Os registos anteriores à versão 2.0 receberam zero neste campo quando a
-- coluna foi criada. Nesses casos, o valor então registado era o valor
-- comercial conhecido e deve continuar a sê-lo nos relatórios.
update rentals
set expected_amount=charged_amount,
    discount_amount=0
where expected_amount=0
  and charged_amount>0;

create or replace function extend_open_rental_to_day(p_rental_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; commercial numeric(10,2); bike_value numeric(10,2); payable numeric(10,2); additional numeric(10,2);
begin
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.status<>'Em aberto' then raise exception 'rental_not_open'; end if;
  if r.rental_kind='institutional' then raise exception 'institutional_has_no_period'; end if;
  if r.rental_period='day' then raise exception 'rental_already_day'; end if;
  if r.rental_period is distinct from 'hour' then raise exception 'invalid_rental_period'; end if;
  select coalesce(sum(case b.asset_type when 'electric' then 10 when 'conventional' then 6 when 'child' then 3 when 'stroller' then 3 when 'helmet' then 1 else 0 end),0),
    coalesce(sum(case when b.asset_type in ('electric','conventional','child') then case b.asset_type when 'electric' then 10 when 'conventional' then 6 when 'child' then 3 end else 0 end),0)
  into commercial,bike_value from rental_items ri join bikes b on b.id=ri.bike_id where ri.rental_id=p_rental_id;
  payable:=case when r.rental_kind='resident' then commercial-bike_value else commercial end;
  additional:=greatest(payable-r.charged_amount,0);
  update rentals set rental_period='day',expected_amount=commercial,discount_amount=commercial-payable,
    charged_amount=payable,charged_amount_recorded=true,corrected_at=now(),corrected_by=p_user_id,
    correction_reason='Prolongamento de 1 hora para 1 dia' where id=p_rental_id;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note)
  values('prolongar aluguer',p_user_id,'aluguer',p_rental_id::text,
    jsonb_build_object('period','hour','commercial_amount',r.expected_amount,'charged_amount',r.charged_amount),
    jsonb_build_object('period','day','commercial_amount',commercial,'charged_amount',payable),'Prolongamento de 1 hora para 1 dia');
  return jsonb_build_object('additional_amount',additional,'charged_amount',payable,'expected_amount',commercial);
end; $$;

create or replace function admin_correct_rental_period(p_rental_id uuid,p_period text,p_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; commercial numeric(10,2); bike_value numeric(10,2); payable numeric(10,2);
begin
  if p_period not in ('hour','day') then raise exception 'invalid_rental_period'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'correction_reason_required'; end if;
  select * into r from rentals where id=p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if r.status='Anulado' then raise exception 'rental_void'; end if;
  if r.rental_kind='institutional' then raise exception 'institutional_has_no_period'; end if;
  select coalesce(sum(case b.asset_type
    when 'electric' then case when p_period='hour' then 4 else 10 end
    when 'conventional' then case when p_period='hour' then 2 else 6 end
    when 'child' then case when p_period='hour' then 2 else 3 end
    when 'stroller' then case when p_period='hour' then 2 else 3 end
    when 'helmet' then 1 else 0 end),0),
    coalesce(sum(case when b.asset_type in ('electric','conventional','child') then case b.asset_type
      when 'electric' then case when p_period='hour' then 4 else 10 end
      when 'conventional' then case when p_period='hour' then 2 else 6 end
      when 'child' then case when p_period='hour' then 2 else 3 end end else 0 end),0)
  into commercial,bike_value from rental_items ri join bikes b on b.id=ri.bike_id where ri.rental_id=p_rental_id;
  payable:=case when r.rental_kind='resident' then commercial-bike_value else commercial end;
  update rentals set rental_period=p_period,expected_amount=commercial,discount_amount=commercial-payable,
    corrected_at=now(),corrected_by=p_user_id,correction_reason=trim(p_reason) where id=p_rental_id;
  insert into audit_log(action,user_id,entity,entity_id,old_value,new_value,note)
  values('corrigir período',p_user_id,'aluguer',p_rental_id::text,
    jsonb_build_object('period',r.rental_period,'commercial_amount',r.expected_amount,'charged_amount',r.charged_amount),
    jsonb_build_object('period',p_period,'commercial_amount',commercial,'charged_amount',r.charged_amount,'tariff_amount',payable),trim(p_reason));
  return jsonb_build_object('rental_period',p_period,'expected_amount',commercial,'charged_amount',r.charged_amount,'tariff_amount',payable);
end; $$;

create or replace function rental_payment_analytics(p_from date default null,p_to date default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with bounds as (select coalesce(p_from,date '2000-01-01') from_date,coalesce(p_to,(now() at time zone 'Europe/Lisbon')::date) to_date),
  filtered as (select r.* from rentals r,bounds b where r.status<>'Anulado' and (r.started_at at time zone 'Europe/Lisbon')::date between b.from_date and b.to_date)
  select jsonb_build_object('paid_rental_count',count(*) filter(where charged_amount_recorded and charged_amount>0),
    'free_rental_count',count(*) filter(where charged_amount_recorded and charged_amount=0),
    'unclassified_rental_count',count(*) filter(where not charged_amount_recorded),
    'revenue',coalesce(sum(charged_amount) filter(where charged_amount_recorded),0),
    'commercial_value',coalesce(sum(expected_amount),0)) from filtered;
$$;

revoke all on function extend_open_rental_to_day(uuid,uuid) from public;
revoke all on function admin_correct_rental_period(uuid,text,uuid,text) from public;
grant execute on function extend_open_rental_to_day(uuid,uuid) to service_role;
grant execute on function admin_correct_rental_period(uuid,text,uuid,text) to service_role;
grant execute on function rental_payment_analytics(date,date) to service_role;

commit;
