begin;

-- Ao corrigir o quiosque de devolução de um aluguer concluído, sincroniza
-- também a localização atual do item, desde que não exista movimento posterior.
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

    perform 1 from bikes b
    where b.id in (select (x->>'bike_id')::uuid from jsonb_array_elements(p_items) x)
    order by b.id for update;

    update rental_items ri set
      bike_id=(x.value->>'bike_id')::uuid,
      return_kiosk_id=(x.value->>'return_kiosk_id')::uuid,
      returned_at=(x.value->>'returned_at')::timestamptz
    from jsonb_array_elements(p_items) x
    where ri.id=(x.value->>'id')::uuid and ri.rental_id=old_rental.id;

    with corrected_items as (
      select ri.bike_id,ri.return_kiosk_id,ri.returned_at,
             (old_item->>'return_kiosk_id')::uuid old_return_kiosk_id
      from rental_items ri
      join lateral jsonb_array_elements(coalesce(old_snapshot->'items','[]'::jsonb)) old_item
        on old_item->>'id'=ri.id::text
      where ri.rental_id=old_rental.id
        and ri.returned_at is not null
        and ri.return_kiosk_id is not null
        and old_item->>'return_kiosk_id' is not null
        and old_item->>'return_kiosk_id' is distinct from ri.return_kiosk_id::text
    ), movable as (
      select ci.* from corrected_items ci
      where not exists(
        select 1 from rental_items later_item
        join rentals later_rental on later_rental.id=later_item.rental_id
        where later_item.bike_id=ci.bike_id
          and later_rental.id<>old_rental.id
          and later_rental.status<>'Anulado'
          and later_rental.started_at>ci.returned_at
      )
    ), moved as (
      update bikes b set kiosk_id=m.return_kiosk_id
      from movable m
      where b.id=m.bike_id
        and b.kiosk_id=m.old_return_kiosk_id
        and b.kiosk_id is distinct from m.return_kiosk_id
      returning b.id,b.status,b.kiosk_id
    )
    insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note)
    select id,status,kiosk_id,p_user_id,'Localização sincronizada após correção do aluguer '||old_rental.reference
    from moved;
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

-- Repara apenas correções anteriores em que o histórico de auditoria comprova
-- que o quiosque de devolução mudou, o item continua no local antigo e não há
-- qualquer aluguer ou alteração de estado posterior.
with corrected_returns as (
  select distinct on ((new_item->>'bike_id')::uuid)
    (new_item->>'bike_id')::uuid bike_id,
    (old_item->>'return_kiosk_id')::uuid old_kiosk_id,
    (new_item->>'return_kiosk_id')::uuid new_kiosk_id,
    (new_item->>'returned_at')::timestamptz returned_at,
    a.created_at corrected_at,
    r.reference
  from audit_log a
  join rentals r on r.id::text=a.entity_id and r.status='Concluído'
  cross join lateral jsonb_array_elements(coalesce(a.old_value->'items','[]'::jsonb)) old_item
  cross join lateral jsonb_array_elements(coalesce(a.new_value->'items','[]'::jsonb)) new_item
  where a.entity='aluguer' and a.action='corrigir'
    and old_item->>'id'=new_item->>'id'
    and old_item->>'return_kiosk_id' is not null
    and new_item->>'return_kiosk_id' is not null
    and old_item->>'return_kiosk_id' is distinct from new_item->>'return_kiosk_id'
  order by (new_item->>'bike_id')::uuid,a.created_at desc
), repairable as (
  select c.* from corrected_returns c
  join bikes b on b.id=c.bike_id and b.kiosk_id=c.old_kiosk_id
  where not exists(
    select 1 from rental_items later_item
    join rentals later_rental on later_rental.id=later_item.rental_id
    where later_item.bike_id=c.bike_id
      and later_rental.status<>'Anulado'
      and later_rental.started_at>c.returned_at
  ) and not exists(
    select 1 from bike_status_history h
    where h.bike_id=c.bike_id and h.created_at>c.corrected_at
  )
), moved as (
  update bikes b set kiosk_id=r.new_kiosk_id
  from repairable r
  where b.id=r.bike_id
  returning b.id,b.status,b.kiosk_id
)
insert into bike_status_history(bike_id,status,kiosk_id,note)
select id,status,kiosk_id,'Localização reparada após correção administrativa de devolução'
from moved;

revoke execute on function admin_correct_rental(uuid,text,text,numeric,uuid,timestamptz,timestamptz,jsonb,boolean,uuid,text) from public,anon,authenticated;
grant execute on function admin_correct_rental(uuid,text,text,numeric,uuid,timestamptz,timestamptz,jsonb,boolean,uuid,text) to service_role;

commit;
