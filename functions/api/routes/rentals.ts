import {
  type Ctx, json, err, db, dbAll, dbCount, body, audit, allow, q,
  passwordHash, uploadReceipt, readReceipt,
} from "../_shared";
import { SCHOOLS } from "../schools";

export async function handleRentalRoutes(ctx: Ctx, request: Request, route: string, parts: string[]) {
    if (route === "/admin/customers" && request.method === "GET") {
      if (!allow(ctx, "admin")) return err("Acesso reservado a administradores.", 403);
      const profiles=await db(ctx,"customer_profiles?select=*&order=name.asc&limit=1000");
      if(!profiles.length)return json({customers:[]});
      const ids=profiles.map((p:any)=>p.id).join(",");
      const [auths,rentals]=await Promise.all([
        db(ctx,`deposit_authorizations?customer_profile_id=in.(${ids})&select=*&order=authorized_at.desc`),
        db(ctx,`rentals?customer_profile_id=in.(${ids})&status=eq.Concluído&select=id,customer_profile_id,estimated_distance_km,estimated_co2_kg&limit=5000`),
      ]);
      const customers=profiles.map((profile:any)=>{
        const profileRentals=rentals.filter((r:any)=>r.customer_profile_id===profile.id);
        const latest=auths.find((a:any)=>a.customer_profile_id===profile.id)||null;
        const activeAuthorization=latest&&latest.status==="active"&&new Date(latest.expires_at).getTime()>Date.now()?latest:null;
        return {...profile,nif:`*** *** ${String(profile.nif).slice(-3)}`,active_authorization:activeAuthorization,last_authorization:latest,activity:{rental_count:profileRentals.length,estimated_distance_km:profileRentals.reduce((s:number,r:any)=>s+Number(r.estimated_distance_km||0),0),estimated_co2_kg:profileRentals.reduce((s:number,r:any)=>s+Number(r.estimated_co2_kg||0),0)}};
      });
      return json({customers});
    }
    if (parts[0] === "admin" && parts[1] === "customers" && parts[2] && request.method === "GET") {
      if (!allow(ctx, "admin")) return err("Acesso reservado a administradores.", 403);
      const profiles=await db(ctx,`customer_profiles?id=eq.${q(parts[2])}&select=*&limit=1`);
      if(!profiles[0])return err("Cliente não encontrado.",404);
      const [auths,rentals]=await Promise.all([
        db(ctx,`deposit_authorizations?customer_profile_id=eq.${q(parts[2])}&select=*&order=authorized_at.desc`),
        db(ctx,`rentals?customer_profile_id=eq.${q(parts[2])}&status=neq.Anulado&select=id,reference,status,started_at,returned_at,estimated_distance_km,estimated_co2_kg,start_kiosk:kiosks(name),items:rental_items(id,bike:bikes(code,asset_type))&order=started_at.desc&limit=200`),
      ]);
      const completed=rentals.filter((r:any)=>r.status==="Concluído"),latest=auths[0]||null;
      return json({customer:{...profiles[0],active_authorization:latest&&latest.status==="active"&&new Date(latest.expires_at).getTime()>Date.now()?latest:null,last_authorization:latest,authorizations:auths,rentals,history_loaded:true,activity:{rental_count:completed.length,estimated_distance_km:completed.reduce((s:number,r:any)=>s+Number(r.estimated_distance_km||0),0),estimated_co2_kg:completed.reduce((s:number,r:any)=>s+Number(r.estimated_co2_kg||0),0)}}});
    }
    if (parts[0] === "admin" && parts[1] === "customers" && parts[2] && request.method === "PATCH") {
      if (!allow(ctx, "admin")) return err("Acesso reservado a administradores.", 403);
      const b=await body(request),name=String(b.name||"").trim(),phone=String(b.phone||"").trim(),email=String(b.email||"").trim().toLowerCase(),school=String(b.school||"").trim();
      const current=(await db(ctx,`customer_profiles?id=eq.${q(parts[2])}&select=*&limit=1`))[0];
      if(!current)return err("Cliente não encontrado.",404);
      if(name.length<2)return err("Indique o nome do cliente.");
      if(current.kind==="frequent"&&(!phone||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return err("Indique um contacto e um email válidos.");
      if(current.kind==="school"&&!SCHOOLS.has(school))return err("Selecione uma escola da lista.");
      const rows=await db(ctx,`customer_profiles?id=eq.${q(parts[2])}`,{method:"PATCH",body:JSON.stringify({name,phone:current.kind==="frequent"?phone:null,email:current.kind==="frequent"?email:null,school:current.kind==="school"?school:null,active:b.active===true,updated_at:new Date().toISOString()})});
      await audit(ctx,"editar perfil de cliente","cliente",parts[2],current,rows[0]);
      return json({customer:rows[0]});
    }
    if (route === "/customer-profiles" && request.method === "GET") {
      const searchParams=new URL(request.url).searchParams;
      const nif=(searchParams.get("nif")||"").replace(/\D/g,"");
      const includeHistory=searchParams.get("history")==="1";
      if(nif.length!==9) return err("Indique um NIF válido.");
      const profiles=await db(ctx,`customer_profiles?nif=eq.${q(nif)}&active=eq.true&select=*&limit=1`);
      if(!profiles[0]) return json({profile:null});
      const auths=profiles[0].kind==="frequent"?await db(ctx,`deposit_authorizations?customer_profile_id=eq.${q(profiles[0].id)}&select=*&order=authorized_at.desc&limit=1`):[];
      const latest=auths[0]||null,active=latest&&latest.status==="active"&&new Date(latest.expires_at).getTime()>Date.now()?latest:null;
      const activityRows=await db(ctx,`rentals?customer_profile_id=eq.${q(profiles[0].id)}&status=eq.Concluído&select=id,estimated_distance_km,estimated_co2_kg&limit=1000`);
      const completed=activityRows;
      const activity={rental_count:completed.length,estimated_distance_km:completed.reduce((sum:number,r:any)=>sum+Number(r.estimated_distance_km||0),0),estimated_co2_kg:completed.reduce((sum:number,r:any)=>sum+Number(r.estimated_co2_kg||0),0)};
      const rentals=includeHistory?await db(ctx,`rentals?customer_profile_id=eq.${q(profiles[0].id)}&status=neq.Anulado&select=id,reference,status,started_at,returned_at,estimated_distance_km,estimated_co2_kg,start_kiosk:kiosks(name),items:rental_items(id,bike:bikes(code,asset_type))&order=started_at.desc&limit=100`):undefined;
      return json({profile:{...profiles[0],masked_nif:`*** *** ${nif.slice(-3)}`,nif:undefined,active_authorization:active,last_authorization:latest,activity,rentals,history_loaded:includeHistory}});
    }
    if (route === "/customer-profiles" && request.method === "POST") {
      const b=await body(request),kind=String(b.kind||""),name=String(b.name||"").trim(),nif=String(b.nif||"").replace(/\D/g,""),school=String(b.school||"").trim(),phone=String(b.phone||"").trim(),email=String(b.email||"").trim().toLowerCase();
      if(!["frequent","school"].includes(kind)||name.length<2||nif.length!==9) return err("Preencha corretamente o nome, NIF e tipo de registo.");
      if(kind==="school"&&(!SCHOOLS.has(school)||b.adult_present_confirmed!==true)) return err("Selecione uma escola da lista e confirme a presença de um adulto.");
      const existing=(await db(ctx,`customer_profiles?nif=eq.${q(nif)}&select=*&limit=1`))[0];
      const renewal=kind==="frequent"&&b.renew_only===true&&existing?.kind==="frequent";
      if(kind==="frequent"&&(!String(b.authorization_code||"").trim()||(!renewal&&(!phone||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9+().\s-]{3,50}$/.test(phone)||b.verified!==true)))) return err("Indique e valide presencialmente o contacto, email e código de autorização.");
      const verifiedFields=kind==="frequent"?{verified_by:ctx.user.id,verified_at:new Date().toISOString()}:{verified_by:null,verified_at:null};
      const rows=renewal?[existing]:existing?await db(ctx,`customer_profiles?id=eq.${q(existing.id)}`,{method:"PATCH",body:JSON.stringify({kind,name,school:kind==="school"?school:null,phone:kind==="frequent"?phone:null,email:kind==="frequent"?email:null,...verifiedFields,adult_present_confirmed:kind==="school",active:true,updated_at:new Date().toISOString()})}):await db(ctx,"customer_profiles",{method:"POST",body:JSON.stringify({kind,name,nif,school:kind==="school"?school:null,phone:kind==="frequent"?phone:null,email:kind==="frequent"?email:null,...verifiedFields,adult_present_confirmed:kind==="school",created_by:ctx.user.id})});
      const profile=rows[0]; let activeAuthorization=null;
      if(kind==="frequent") {
        await db(ctx,`deposit_authorizations?customer_profile_id=eq.${q(profile.id)}&status=eq.active`,{method:"PATCH",body:JSON.stringify({status:"expired"})});
        const authRows=await db(ctx,"deposit_authorizations",{method:"POST",body:JSON.stringify({customer_profile_id:profile.id,authorization_code:String(b.authorization_code).trim(),amount:50,authorized_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString(),created_by:ctx.user.id})}); activeAuthorization=authRows[0];
      }
      await audit(ctx,"criar/atualizar perfil de cliente","cliente",profile.id,null,{kind:profile.kind,school:profile.school});
      return json({profile:{...profile,masked_nif:`*** *** ${nif.slice(-3)}`,nif:undefined,active_authorization:activeAuthorization}},201);
    }
    if (parts[0] === "rentals" && ctx.user.role === "manutencao")
      return err("O perfil de manutenção não tem acesso aos alugueres.", 403);
    if (route === "/rentals" && request.method === "GET") {
      const owner =
        ctx.user.role === "admin" ? "" : `&started_by=eq.${q(ctx.user.id)}`;
      const discrepancyOwner =
        ctx.user.role === "admin" ? "" : `&created_by=eq.${q(ctx.user.id)}`;
      const rentalSelect = "select=*,start_kiosk:kiosks(*),customer_profile:customer_profiles(id,kind,name,school),deposit_authorization:deposit_authorizations(id,authorization_code,amount,authorized_at,expires_at,status),started_by_user:users!rentals_started_by_fkey(full_name),returned_by_user:users!rentals_returned_by_fkey(full_name),items:rental_items(*,bike:bikes(*),return_kiosk:kiosks(*),returned_by_user:users!rental_items_returned_by_fkey(full_name))";
      const [openRentals, completedRentals, annulledRentals, bikes, correctionBikes, kiosks, discrepancies, summary, equipmentTypes, prices] = await Promise.all([
        db(
          ctx,
          `rentals?${rentalSelect}&status=eq.Em%20aberto&order=started_at.desc`,
        ),
        db(
          ctx,
          `rentals?${rentalSelect}&status=eq.Concluído${owner}&order=started_at.desc&limit=500`,
        ),
        ctx.user.role === "admin" ? db(ctx, `rentals?${rentalSelect}&status=eq.Anulado&order=started_at.desc&limit=500`) : Promise.resolve([]),
        db(
          ctx,
          "bikes?active=eq.true&status=eq.Disponível&select=*,kiosk:kiosks!inner(*)&kiosk.allows_rentals=eq.true&order=code",
        ),
        ctx.user.role === "admin" ? db(ctx, "bikes?select=*,kiosk:kiosks(*)&order=code") : Promise.resolve([]),
        db(
          ctx,
          "kiosks?active=eq.true&allows_rentals=eq.true&select=*&order=name",
        ),
        db(
          ctx,
          `rental_discrepancies?select=*,rental:rentals(reference,customer_ref),created_by_user:users!rental_discrepancies_created_by_fkey(full_name),resolved_by_user:users!rental_discrepancies_resolved_by_fkey(full_name)${discrepancyOwner}&order=created_at.desc&limit=500`,
        ),
        db(ctx, "rpc/rental_period_summary", {
          method: "POST",
          body: JSON.stringify({ p_user_id: ctx.user.role === "admin" ? null : ctx.user.id }),
        }),
        db(ctx, "equipment_types?active=eq.true&select=*&order=name"),
        db(ctx, "equipment_prices?effective_from=lte.now()&select=*&order=effective_from.desc"),
      ]);
      const currentPrices = prices.filter((price:any,index:number,list:any[]) => list.findIndex((x:any)=>x.asset_type===price.asset_type&&x.period===price.period)===index);
      const rentals=[...openRentals,...completedRentals,...annulledRentals].sort((a:any,b:any)=>String(b.started_at).localeCompare(String(a.started_at)));
      return json({ rentals, available_bikes: bikes, correction_bikes: correctionBikes, kiosks, discrepancies, summary, equipment_types: equipmentTypes, prices: currentPrices });
    }
    if (parts[0] === "rentals" && parts[1] && parts[2] === "correct" && request.method === "PATCH") {
      if (!allow(ctx, "admin")) return err("Acesso reservado a administradores.", 403);
      const b = await body(request), reason = String(b.reason || "").trim(), amount = Number(b.charged_amount);
      if (reason.length < 5) return err("Indique o motivo da correção (pelo menos 5 caracteres).");
      if (!String(b.customer_ref || "").trim()) return err("Indique a referência do cliente.");
      if (!Number.isFinite(amount) || amount < 0) return err("Indique um valor cobrado válido.");
      const current = (await db(ctx, `rentals?id=eq.${q(parts[1])}&select=id,status`))[0];
      if (!current) return err("Aluguer não encontrado.", 404);
      if (current.status === "Anulado") return err("Este aluguer já está anulado.", 409);
      const result = await db(ctx, "rpc/admin_correct_rental", { method: "POST", body: JSON.stringify({
        p_rental_id: parts[1], p_customer_ref: String(b.customer_ref).trim(),
        p_customer_contact: String(b.customer_contact || "").trim() || null,
        p_charged_amount: amount, p_start_kiosk_id: b.start_kiosk_id,
        p_started_at: b.started_at, p_returned_at: b.returned_at || null,
        p_items: Array.isArray(b.items) ? b.items : null, p_void: !!b.void,
        p_user_id: ctx.user.id, p_reason: reason,
      }) });
      return json(result);
    }
    if (parts[0] === "rentals" && parts[1] && parts[2] === "add-missing-item" && request.method === "POST") {
      if (!allow(ctx, "admin")) return err("Acesso reservado a administradores.", 403);
      const b=await body(request),reason=String(b.reason||"").trim();
      if(!b.bike_id)return err("Selecione o item que ficou por registar.");
      if(reason.length<5)return err("Indique o motivo da correção (pelo menos 5 caracteres).");
      const rental=(await db(ctx,`rentals?id=eq.${q(parts[1])}&select=id,status&limit=1`))[0];
      if(!rental)return err("Aluguer não encontrado.",404);
      const result=rental.status==="Em aberto"
        ? await db(ctx,"rpc/add_bike_to_open_rental",{method:"POST",body:JSON.stringify({p_rental_id:parts[1],p_bike_id:b.bike_id,p_user_id:ctx.user.id})})
        : rental.status==="Concluído"
          ? await db(ctx,"rpc/admin_add_missing_rental_item",{method:"POST",body:JSON.stringify({p_rental_id:parts[1],p_bike_id:b.bike_id,p_return_kiosk_id:b.return_kiosk_id,p_returned_at:b.returned_at,p_user_id:ctx.user.id,p_reason:reason})})
          : null;
      if(!result)return err("Não é possível acrescentar itens a um aluguer anulado.",409);
      await audit(ctx,"adicionar item omitido","aluguer",parts[1],null,{bike_id:b.bike_id,reason});
      return json(result,201);
    }
    if (parts[0] === "rentals" && parts[1] && parts[2] === "change-duration" && request.method === "POST") {
      const rental = (await db(ctx, `rentals?id=eq.${q(parts[1])}&select=id,started_by,status,rental_kind,rental_period,rental_hours`))[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (rental.status !== "Em aberto") return err("Só é possível prolongar um aluguer em aberto.", 409);
      if (rental.rental_kind === "institutional") return err("As utilizações institucionais não têm período de aluguer.", 409);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode alterar alugueres de outro utilizador.", 403);
      const b=await body(request),period=String(b.rental_period||""),hours=period==="hour"?Number(b.rental_hours):null;
      if(!["hour","day"].includes(period)||(period==="hour"&&(!Number.isSafeInteger(hours)||Number(hours)<1||Number(hours)>168))) return err("Selecione uma duração válida.");
      const result = await db(ctx, "rpc/change_open_rental_duration", { method: "POST", body: JSON.stringify({
        p_rental_id: parts[1],p_period:period,p_hours:hours,p_user_id: ctx.user.id,
      }) });
      return json(result);
    }
    if (parts[0] === "rentals" && parts[1] && parts[2] === "correct-duration" && request.method === "PATCH") {
      if (!allow(ctx, "admin")) return err("Acesso reservado a administradores.", 403);
      const b = await body(request), period = String(b.rental_period || ""), hours=period==="hour"?Number(b.rental_hours):null, reason = String(b.reason || "").trim();
      if (!["hour", "day"].includes(period)) return err("Selecione um período válido.");
      if(period==="hour"&&(!Number.isSafeInteger(hours)||Number(hours)<1||Number(hours)>168)) return err("Indique um número de horas válido.");
      if (reason.length < 5) return err("Indique o motivo da correção (pelo menos 5 caracteres).");
      const result = await db(ctx, "rpc/admin_correct_rental_duration", { method: "POST", body: JSON.stringify({
        p_rental_id: parts[1], p_period: period,p_hours:hours, p_user_id: ctx.user.id, p_reason: reason,
      }) });
      return json(result);
    }
    if (route === "/rentals" && request.method === "POST") {
      const b = await body(request),
        customerContact = String(b.customer_contact || "").trim(),
        chargedAmount = Number(b.charged_amount);
      const rentalKind = String(b.rental_kind || "normal"), rentalPeriod = String(b.rental_period || "hour"), rentalHours=Number(b.rental_hours || 1);
      if (
        !b.customer_ref?.trim() ||
        !Array.isArray(b.bike_ids) ||
        !b.bike_ids.length
      )
        return err("Indique o cliente e pelo menos uma bicicleta.");
      if (customerContact.length > 50)
        return err("O número de contacto não pode exceder 50 caracteres.");
      if (customerContact && !/^[0-9+().\s-]{3,50}$/.test(customerContact))
        return err("Indique um número de contacto válido.");
      if (b.charged_amount === "" || b.charged_amount === null || b.charged_amount === undefined || !Number.isFinite(chargedAmount) || chargedAmount < 0 || chargedAmount > 100000)
        return err("Indique o valor cobrado por Multibanco.");
      if (!["normal","resident","institutional","frequent","school"].includes(rentalKind) || (rentalKind !== "institutional" && !["hour","day"].includes(rentalPeriod)))
        return err("Selecione um tipo e um período de utilização válidos.");
      if (rentalKind !== "institutional" && rentalPeriod === "hour" && (!Number.isSafeInteger(rentalHours) || rentalHours < 1 || rentalHours > 168)) return err("Indique um número de horas entre 1 e 168.");
      if (rentalKind === "resident" && (b.oeiras_move_confirmed !== true || !["AT","Dístico de residente","Subscrição 120 minutos"].includes(String(b.resident_proof_type))))
        return err("Confirme as condições do benefício de residente.");
      if (rentalKind === "institutional" && (!["Parques Tejo","Município de Oeiras"].includes(String(b.institutional_entity)) || !String(b.institutional_person || "").trim()))
        return err("Indique a entidade e o nome de quem levantou o equipamento.");
      if (rentalKind !== "institutional" && !String(b.authorization_code || "").trim())
        return err("Indique o código de autorização do talão Multibanco.");
      const rows = await db(ctx, "rpc/start_rental", {
        method: "POST",
        body: JSON.stringify({
          p_customer_ref: b.customer_ref.trim(),
          p_start_kiosk_id: b.start_kiosk_id,
          p_bike_ids: b.bike_ids,
          p_user_id: ctx.user.id,
          p_customer_contact: customerContact || null,
          p_charged_amount: chargedAmount,
          p_rental_kind: rentalKind,
          p_rental_period: rentalKind === "institutional" ? null : rentalPeriod,
          p_rental_hours: rentalKind !== "institutional" && rentalPeriod === "hour" ? rentalHours : null,
          p_oeiras_move_confirmed: b.oeiras_move_confirmed === true,
          p_resident_proof_type: b.resident_proof_type || null,
          p_institutional_entity: b.institutional_entity || null,
          p_institutional_person: String(b.institutional_person || "").trim() || null,
          p_price_override_reason: String(b.price_override_reason || "").trim() || null,
          p_customer_profile_id: b.customer_profile_id || null,
          p_deposit_authorization_id: b.deposit_authorization_id || null,
          p_authorization_code: String(b.authorization_code || "").trim() || null,
        }),
      });
      return json(rows, 201);
    }
    if (
      parts[0] === "rentals" &&
      parts[1] &&
      parts[2] === "add-bike" &&
      request.method === "POST"
    ) {
      const rental = (
        await db(ctx, `rentals?id=eq.${q(parts[1])}&select=id,started_by,status`)
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (rental.status !== "Em aberto")
        return err("Só é possível corrigir um aluguer em aberto.", 409);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode corrigir alugueres de outro utilizador.", 403);
      const b = await body(request);
      if (!b.bike_id) return err("Selecione a bicicleta a adicionar.");
      const bike = (
        await db(
          ctx,
          `bikes?id=eq.${q(String(b.bike_id))}&active=eq.true&status=eq.Disponível&select=id`,
        )
      )[0];
      if (!bike)
        return err(
          "A bicicleta já não está disponível. Atualize a página ou comunique uma discrepância.",
          409,
        );
      const result = await db(ctx, "rpc/add_bike_to_open_rental", {
        method: "POST",
        body: JSON.stringify({
          p_rental_id: parts[1],
          p_bike_id: b.bike_id,
          p_user_id: ctx.user.id,
        }),
      });
      return json(result);
    }
    if (
      parts[0] === "rentals" &&
      parts[1] &&
      parts[2] === "remove-bike" &&
      request.method === "POST"
    ) {
      const rental = (
        await db(ctx, `rentals?id=eq.${q(parts[1])}&select=id,started_by,status`)
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (rental.status !== "Em aberto")
        return err("Só é possível corrigir um aluguer em aberto.", 409);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode corrigir alugueres de outro utilizador.", 403);
      const b = await body(request);
      const openItems = await db(
        ctx,
        `rental_items?rental_id=eq.${q(parts[1])}&returned_at=is.null&select=id`,
      );
      if (openItems.length <= 1)
        return err(
          "Um aluguer tem de manter pelo menos uma bicicleta. Contacte o administrador se pretender anulá-lo.",
          409,
        );
      const result = await db(ctx, "rpc/remove_bike_from_open_rental", {
        method: "POST",
        body: JSON.stringify({
          p_rental_id: parts[1],
          p_rental_item_id: b.rental_item_id,
          p_user_id: ctx.user.id,
        }),
      });
      return json(result);
    }
    if (
      parts[0] === "rentals" &&
      parts[1] &&
      parts[2] === "discrepancies" &&
      request.method === "POST"
    ) {
      const rental = (
        await db(ctx, `rentals?id=eq.${q(parts[1])}&select=id,started_by,status`)
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (rental.status !== "Em aberto")
        return err("Só é possível comunicar uma discrepância num aluguer em aberto.", 409);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode alterar alugueres de outro utilizador.", 403);
      const b = await body(request),
        bikeCode = String(b.bike_code || "").trim().toUpperCase(),
        description = String(b.description || "").trim();
      if (!bikeCode || !description)
        return err("Indique o código da bicicleta e descreva o problema.");
      const rows = await db(ctx, "rental_discrepancies", {
        method: "POST",
        body: JSON.stringify({
          rental_id: parts[1],
          bike_code: bikeCode,
          description,
          created_by: ctx.user.id,
        }),
      });
      await audit(
        ctx,
        "comunicar discrepância",
        "aluguer",
        parts[1],
        null,
        rows[0],
      );
      return json(rows[0], 201);
    }
    if (
      parts[0] === "rental-discrepancies" &&
      parts[1] &&
      parts[2] === "resolve" &&
      request.method === "PATCH"
    ) {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const old = (
        await db(
          ctx,
          `rental_discrepancies?id=eq.${q(parts[1])}&select=*`,
        )
      )[0];
      if (!old) return err("Discrepância não encontrada.", 404);
      const b = await body(request),
        resolution = String(b.resolution || "").trim();
      if (!resolution) return err("Descreva como a discrepância foi resolvida.");
      const rows = await db(ctx, `rental_discrepancies?id=eq.${old.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "Resolvida",
          resolution,
          resolved_by: ctx.user.id,
          resolved_at: new Date().toISOString(),
        }),
      });
      await audit(
        ctx,
        "resolver discrepância",
        "aluguer",
        old.rental_id,
        old,
        rows[0],
      );
      return json(rows[0]);
    }
    if (
      parts[0] === "rentals" &&
      parts[2] === "return" &&
      request.method === "POST"
    ) {
      const rental = (
        await db(
          ctx,
          `rentals?id=eq.${parts[1]}&select=id,started_by,start_kiosk_id,rental_kind,started_at`,
        )
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      // A devolução pode ser concluída por qualquer funcionário, permitindo devolver noutro quiosque.
      const b = await body(request);
      if (!b.items?.length) return err("Não existem bicicletas por devolver.");
      const returnKioskId =
        b.return_kiosk_id ||
        ctx.user.usual_kiosk_id ||
        rental.start_kiosk_id;
      const returnKiosk = (
        await db(
          ctx,
          `kiosks?id=eq.${q(String(returnKioskId))}&active=eq.true&allows_rentals=eq.true&select=id`,
        )
      )[0];
      if (!returnKiosk)
        return err("O local selecionado não permite devoluções.");
      const result = await db(ctx, "rpc/return_rental_items", {
        method: "POST",
        body: JSON.stringify({
          p_rental_id: parts[1],
          p_return_kiosk_id: returnKioskId,
          p_items: b.items,
          p_user_id: ctx.user.id,
        }),
      });
      if (Number(result?.remaining) === 0) {
        const rentalItems=await db(ctx,`rental_items?rental_id=eq.${q(parts[1])}&select=bike:bikes(asset_type)`);
        const bicycleCount=rentalItems.filter((item:any)=>["electric","conventional","child"].includes(item.bike?.asset_type)).length;
        const durationHours=Math.max(0,(Date.now()-new Date(rental.started_at).getTime())/3600000);
        const distance=Math.round(durationHours*8*bicycleCount*100)/100;
        const co2=Math.round(distance*0.204*1000)/1000;
        await db(ctx,`rentals?id=eq.${q(parts[1])}`,{method:"PATCH",body:JSON.stringify({estimated_distance_km:distance,estimated_co2_kg:co2})});
        return json({...result,estimated_distance_km:distance,estimated_co2_kg:co2});
      }
      return json(result);
    }
  return null;
}
