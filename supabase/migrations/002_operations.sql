create or replace function start_rental(p_customer_ref text,p_start_kiosk_id uuid,p_bike_ids uuid[],p_user_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r rentals; b bikes; ref text;
begin
 if coalesce(array_length(p_bike_ids,1),0)=0 then raise exception 'no_bikes'; end if;
 perform pg_advisory_xact_lock(hashtext(x::text)) from unnest(p_bike_ids) x;
 if exists(select 1 from bikes where id=any(p_bike_ids) and (status<>'Disponível' or not active)) or (select count(*) from bikes where id=any(p_bike_ids))<>array_length(p_bike_ids,1) then raise exception 'bike_not_available'; end if;
 ref:='AL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into rentals(reference,customer_ref,start_kiosk_id,started_by) values(ref,left(trim(p_customer_ref),200),p_start_kiosk_id,p_user_id) returning * into r;
 insert into rental_items(rental_id,bike_id) select r.id,unnest(p_bike_ids);
 update bikes set status='Alugada' where id=any(p_bike_ids);
 insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) select id,'Alugada',kiosk_id,p_user_id,'Início do aluguer '||ref from bikes where id=any(p_bike_ids);
 insert into audit_log(action,user_id,entity,entity_id,new_value) values('iniciar aluguer',p_user_id,'aluguer',r.id::text,to_jsonb(r));return to_jsonb(r);
end$$;
create or replace function return_rental_items(p_rental_id uuid,p_return_kiosk_id uuid,p_items jsonb,p_user_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; ri rental_items; fault_id uuid; remaining int;
begin
 for item in select * from jsonb_array_elements(p_items) loop
  select * into ri from rental_items where id=(item->>'rental_item_id')::uuid and rental_id=p_rental_id for update;
  if not found or ri.returned_at is not null then raise exception 'invalid_return_item'; end if;
  update rental_items set returned_at=now(),returned_by=p_user_id,return_kiosk_id=p_return_kiosk_id,anomaly=coalesce((item->>'anomaly')::boolean,false),anomaly_description=nullif(item->>'anomaly_description','') where id=ri.id;
  if coalesce((item->>'anomaly')::boolean,false) then
   update bikes set status='Avariada',kiosk_id=p_return_kiosk_id where id=ri.bike_id;
   insert into faults(bike_id,created_by,origin,category,description,severity,usable,status) values(ri.bike_id,p_user_id,'identificada numa devolução','outra',coalesce(nullif(item->>'anomaly_description',''),'Anomalia indicada na devolução'),'Média',false,'Aberta') returning id into fault_id;
   insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) values(ri.bike_id,'Avariada',p_return_kiosk_id,p_user_id,'Anomalia na devolução');
  else update bikes set status='Disponível',kiosk_id=p_return_kiosk_id where id=ri.bike_id;insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) values(ri.bike_id,'Disponível',p_return_kiosk_id,p_user_id,'Devolução sem anomalias'); end if;
 end loop;
 select count(*) into remaining from rental_items where rental_id=p_rental_id and returned_at is null;
 if remaining=0 then update rentals set status='Concluído',returned_at=now(),returned_by=p_user_id where id=p_rental_id;end if;
 insert into audit_log(action,user_id,entity,entity_id,new_value) values('registar devolução',p_user_id,'aluguer',p_rental_id::text,p_items);return jsonb_build_object('remaining',remaining);
end$$;
create or replace function create_fault(p_bike_id uuid,p_origin text,p_category text,p_description text,p_severity text,p_usable boolean,p_user_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare f faults;begin
 insert into faults(bike_id,created_by,origin,category,description,severity,usable) values(p_bike_id,p_user_id,p_origin,p_category,p_description,p_severity,p_usable) returning * into f;
 if not p_usable or p_severity='Impeditiva' then update bikes set status='Avariada' where id=p_bike_id;insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) select id,'Avariada',kiosk_id,p_user_id,'Avaria registada' from bikes where id=p_bike_id;end if;
 insert into audit_log(action,user_id,entity,entity_id,new_value) values('registar avaria',p_user_id,'avaria',f.id::text,to_jsonb(f));return to_jsonb(f);end$$;
create or replace function update_fault(p_fault_id uuid,p_status text,p_final_bike_status text,p_user_id uuid,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$declare f faults;begin
 update faults set status=p_status::fault_status,notes=coalesce(p_note,notes) where id=p_fault_id returning * into f;if not found then raise exception 'fault_not_found';end if;
 if p_status='Em reparação' then update bikes set status='Em manutenção' where id=f.bike_id;elsif p_status='Resolvida' then if p_final_bike_status not in('Disponível','Indisponível','Em manutenção') then raise exception 'final_status_required';end if;update bikes set status=p_final_bike_status::bike_status where id=f.bike_id;end if;
 if p_status in('Em reparação','Resolvida') then insert into bike_status_history(bike_id,status,kiosk_id,changed_by,note) select id,status,kiosk_id,p_user_id,coalesce(p_note,'Atualização da avaria') from bikes where id=f.bike_id;end if;
 insert into audit_log(action,user_id,entity,entity_id,new_value,note) values('atualizar avaria',p_user_id,'avaria',f.id::text,to_jsonb(f),p_note);return to_jsonb(f);end$$;
revoke all on function start_rental(text,uuid,uuid[],uuid) from public;revoke all on function return_rental_items(uuid,uuid,jsonb,uuid) from public;revoke all on function create_fault(uuid,text,text,text,text,boolean,uuid) from public;revoke all on function update_fault(uuid,text,text,uuid,text) from public;
