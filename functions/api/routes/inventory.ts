import {
  type Ctx, json, err, db, dbAll, dbCount, body, audit, allow, q,
  passwordHash, uploadReceipt, readReceipt,
} from "../_shared";

export async function handleInventoryRoutes(ctx: Ctx, request: Request, route: string, parts: string[]) {
    if (route === "/dashboard" && request.method === "GET") {
      const own =
        ctx.user.role === "admin" ? "" : `&started_by=eq.${q(ctx.user.id)}`;
      const returnOwner =
        ctx.user.role === "admin"
          ? ""
          : `&rentals.started_by=eq.${q(ctx.user.id)}`;
      const todayLisbon = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Lisbon",
      }).format(new Date());
      const [allBikes, allKiosks, rentals, faults, returns, dailyClosure, pendingFaultCount] =
        await Promise.all([
        db(ctx, "bikes?active=eq.true&select=id,code,asset_type,status,kiosk_id"),
        db(ctx, "kiosks?active=eq.true&select=*"),
        db(ctx, `rentals?status=eq.Em%20aberto${own}&select=id`),
        db(
          ctx,
          "faults?status=in.(Aberta,Em%20análise,Em%20reparação)&select=*,bikes(code)&order=created_at.desc&limit=8",
        ),
        db(
          ctx,
          `rental_items?returned_at=not.is.null${returnOwner}&select=id,returned_at,rentals!inner(customer_ref,started_by),bikes(code)&order=returned_at.desc&limit=8`,
        ),
        ctx.user.role === "manutencao"
          ? Promise.resolve([])
          : db(
              ctx,
              `daily_closures?report_date=eq.${q(todayLisbon)}&user_id=eq.${q(ctx.user.id)}&select=id,status,kiosk:kiosks(name)&limit=1`,
            ),
        ctx.user.role === "funcionario"
          ? Promise.resolve(0)
          : dbCount(ctx, "faults?status=in.(Aberta,Em%20análise,Em%20reparação)&select=id"),
        ]);
      const kiosks=ctx.user.role==='funcionario'?allKiosks.filter((k:any)=>k.allows_rentals):allKiosks;
      const visibleKioskIds=new Set(kiosks.map((k:any)=>k.id));
      const bikes=ctx.user.role==='funcionario'?allBikes.filter((b:any)=>visibleKioskIds.has(b.kiosk_id)&&['Disponível','Alugada'].includes(b.status)):allBikes;
      const counts: any = {},
        counts_by_type: any = {};
      bikes.forEach((b: any) => {
        counts[b.status] = (counts[b.status] || 0) + 1;
        const row =
          counts_by_type[b.status] ||
          (counts_by_type[b.status] = {
            total: 0,
            electric: 0,
            conventional: 0,
            child: 0,
            helmet: 0,
            lock: 0,
            stroller: 0,
          });
        row.total++;
        if (row[b.asset_type] !== undefined) row[b.asset_type]++;
      });
      const rentedBikes = bikes.filter((b: any) => b.status === "Alugada"),
        rented = {
          total: rentedBikes.length,
          electric: rentedBikes.filter((b: any) => b.asset_type === "electric").length,
          conventional: rentedBikes.filter((b: any) => b.asset_type === "conventional").length,
          child: rentedBikes.filter((b: any) => b.asset_type === "child").length,
          accessories: rentedBikes.filter((b: any) => ["helmet","lock","stroller"].includes(b.asset_type)).length,
          by_kiosk: kiosks.map((k: any) => {
            const list = rentedBikes.filter((b: any) => b.kiosk_id === k.id);
            return {
              id: k.id,
              name: k.name,
              total: list.length,
              electric: list.filter((b: any) => b.asset_type === "electric").length,
              conventional: list.filter((b: any) => b.asset_type === "conventional").length,
              child: list.filter((b: any) => b.asset_type === "child").length,
              accessories: list.filter((b: any) => ["helmet","lock","stroller"].includes(b.asset_type)).length,
            };
          }),
        };
      let admin_management:any=null;
      if(ctx.user.role==='admin'){
        const dateKey=(value:string|Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon'}).format(new Date(value)),today=dateKey(new Date()),todayDate=new Date(today+'T00:00:00Z'),yesterdayDate=new Date(todayDate);yesterdayDate.setUTCDate(yesterdayDate.getUTCDate()-1);const yesterday=yesterdayDate.toISOString().slice(0,10),weekDate=new Date(todayDate);weekDate.setUTCDate(weekDate.getUTCDate()-((weekDate.getUTCDay()+6)%7));const weekStart=weekDate.toISOString().slice(0,10),previousWeekDate=new Date(weekDate);previousWeekDate.setUTCDate(previousWeekDate.getUTCDate()-7);const previousWeekStart=previousWeekDate.toISOString().slice(0,10),monthStart=today.slice(0,7)+'-01',monthDate=new Date(monthStart+'T00:00:00Z'),previousMonthDate=new Date(monthDate);previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth()-1);const previousMonthStart=previousMonthDate.toISOString().slice(0,10);
        const rentalKiosks=kiosks.filter((k:any)=>k.allows_rentals);
        const [periodRentals,periodClosures,openRentalDetails,discrepancies,recentClosureGroups]=await Promise.all([
          db(ctx,`rentals?started_at=gte.${q(previousMonthStart+'T00:00:00Z')}&select=id,started_at,status,items:rental_items(id,bike:bikes(asset_type))`),
          db(ctx,`daily_closures?report_date=gte.${q(previousMonthStart)}&select=*,kiosk:kiosks(name),user:users(full_name,username)&order=report_date.desc,submitted_at.desc.nullslast`),
          db(ctx,'rentals?status=eq.Em%20aberto&select=id,reference,customer_ref,customer_contact,started_at,start_kiosk:kiosks(name),started_by_user:users!rentals_started_by_fkey(full_name),items:rental_items(id,bike:bikes(code,asset_type))&order=started_at.asc'),
          db(ctx,'rental_discrepancies?status=eq.Pendente&select=id'),
          Promise.all(rentalKiosks.map((k:any)=>db(ctx,`daily_closures?kiosk_id=eq.${q(k.id)}&status=eq.Submetido&select=*,kiosk:kiosks(name),user:users(full_name,username)&order=report_date.desc,submitted_at.desc.nullslast&limit=3`)))
        ]);
        const rentalStats=(from:string,to?:string)=>{const list=periodRentals.filter((r:any)=>{const d=dateKey(r.started_at);return d>=from&&(!to||d<to)});return{rentals:list.length,items:list.reduce((sum:number,r:any)=>sum+(r.items?.length||0),0)}};
        const revenueStats=(from:string,to?:string)=>periodClosures.filter((c:any)=>c.status==='Submetido'&&c.report_date>=from&&(!to||c.report_date<to)).reduce((sum:number,c:any)=>sum+Number(c.card_total||0),0);
        admin_management={
          periods:{
            today:{current:rentalStats(today),previous:rentalStats(yesterday,today),revenue:revenueStats(today),previous_revenue:revenueStats(yesterday,today)},
            week:{current:rentalStats(weekStart),previous:rentalStats(previousWeekStart,weekStart),revenue:revenueStats(weekStart),previous_revenue:revenueStats(previousWeekStart,weekStart)},
            month:{current:rentalStats(monthStart),previous:rentalStats(previousMonthStart,monthStart),revenue:revenueStats(monthStart),previous_revenue:revenueStats(previousMonthStart,monthStart)}
          },
          closures_recent:recentClosureGroups.flat().sort((a:any,b:any)=>String(b.report_date||'').localeCompare(String(a.report_date||''))||String(b.submitted_at||b.created_at||'').localeCompare(String(a.submitted_at||a.created_at||''))),
          recent_observations:periodClosures.filter((c:any)=>String(c.observations||'').trim()).slice(0,6),
          open_rentals:openRentalDetails,
          pending_discrepancies:discrepancies.length,
          pending_faults:pendingFaultCount,
          fleet_by_kiosk:rentalKiosks.map((k:any)=>{const list=bikes.filter((b:any)=>b.kiosk_id===k.id&&['Disponível','Alugada'].includes(b.status));return{id:k.id,name:k.name,total:list.length,by_type:{electric:list.filter((b:any)=>b.asset_type==='electric').length,conventional:list.filter((b:any)=>b.asset_type==='conventional').length,child:list.filter((b:any)=>b.asset_type==='child').length,accessories:list.filter((b:any)=>['helmet','lock','stroller'].includes(b.asset_type)).length},by_status:Object.fromEntries(['Disponível','Alugada'].map(s=>[s,list.filter((b:any)=>b.status===s).length]))}})
        };
      }
      return json({
        counts,
        counts_by_type,
        rented:
          ctx.user.role === "manutencao"
            ? { total: 0, electric: 0, conventional: 0, child: 0, accessories: 0, by_kiosk: [] }
            : rented,
        kiosks: kiosks.map((k: any) => ({
          ...k,
          total: bikes.filter((b: any) => b.kiosk_id === k.id).length,
        })),
        open_rentals: ctx.user.role === "manutencao" ? 0 : rentals.length,
        daily_closure: dailyClosure[0] || null,
        pending_faults: pendingFaultCount,
        faults:
          ctx.user.role === "funcionario"
            ? []
            : faults.map((f: any) => ({ ...f, bike_code: f.bikes?.code })),
        recent_returns:
          ctx.user.role === "manutencao"
            ? []
            : returns.map((r: any) => ({
                ...r,
                bike_code: r.bikes?.code,
                customer_ref: r.rentals?.customer_ref,
              })),
        admin_management,
      });
    }
    if (route === "/bikes" && request.method === "GET") {
      const kiosks=await db(ctx,`kiosks?active=eq.true${ctx.user.role==='funcionario'?'&allows_rentals=eq.true':''}&select=*&order=name`);
      const kioskIds=kiosks.map((k:any)=>k.id);
      const bikeQuery=ctx.user.role==='funcionario'
        ? `bikes?active=eq.true&kiosk_id=in.(${kioskIds.join(',')})&select=id,code,asset_type,model,kiosk_id,status,active,created_at,updated_at,kiosk:kiosks(id,name,allows_rentals)&order=code`
        : "bikes?select=*,kiosk:kiosks(*)&order=code";
      const bikes=ctx.user.role==='funcionario'&&!kioskIds.length?[]:await db(ctx,bikeQuery);
      return json({ bikes, kiosks });
    }
    if (route === "/bikes/report" && request.method === "GET") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const [bikes, items, faults, interventions] = await Promise.all([
        db(ctx, "bikes?select=*,kiosk:kiosks(*)&order=code"),
        db(ctx, "rental_items?select=bike_id"),
        db(ctx, "faults?select=id,bike_id,created_at"),
        db(
          ctx,
          "maintenance_interventions?select=intervention_date,fault:faults!inner(bike_id)",
        ),
      ]);
      return json({
        bikes: bikes.map((b: any) => {
          const bikeFaults = faults.filter((f: any) => f.bike_id === b.id),
            dates = [
              ...bikeFaults.map((f: any) => f.created_at),
              ...interventions
                .filter((i: any) => i.fault?.bike_id === b.id)
                .map((i: any) => i.intervention_date),
            ]
              .filter(Boolean)
              .sort();
          return {
            ...b,
            rental_count: items.filter((i: any) => i.bike_id === b.id).length,
            fault_count: bikeFaults.length,
            last_maintenance_at: dates.at(-1) || null,
          };
        }),
      });
    }
    if (route === "/bikes" && request.method === "POST") {
      if (!allow(ctx, "admin"))
        return err("Apenas administradores podem criar itens de inventário.", 403);
      const b = await body(request),types:any={electric:{prefix:'E',model:'Bicicleta elétrica'},conventional:{prefix:'C',model:'Bicicleta convencional'},child:{prefix:'I',model:'Bicicleta infantil'},helmet:{prefix:'CAP',model:'Capacete'},lock:{prefix:'CAD',model:'Cadeado'},stroller:{prefix:'CAR',model:'Carrinho de bebé'}},assetType=types[b.asset_type]?b.asset_type:(b.type==='E'?'electric':'conventional'),definition=types[assetType],number=String(b.number||b.code||'').replace(/^[A-Z]+/i,'');
      if (!/^\d{1,6}$/.test(number))
        return err("Indique um número válido para a bicicleta.");
      const code = definition.prefix + number.padStart(3, "0");
      const rows = await db(ctx, "bikes", {
        method: "POST",
        body: JSON.stringify({
          code,
          model:b.model||definition.model,
          asset_type:assetType,
          kiosk_id: b.kiosk_id,
          status: "Disponível",
        }),
      });
      await audit(ctx, "criar", "bicicleta", rows[0].id, null, rows[0]);
      return json(rows[0], 201);
    }
    if (
      parts[0] === "bikes" &&
      parts[1] &&
      parts[2] === "history" &&
      request.method === "GET"
    ) {
      if (!["admin", "manutencao"].includes(ctx.user.role))
        return err("Acesso reservado a administradores e manutenção.", 403);
      const itemsPromise =
        ctx.user.role === "manutencao"
          ? Promise.resolve([])
          : db(
              ctx,
              `rental_items?bike_id=eq.${parts[1]}&select=*,return_kiosk:kiosks(*),returned_by_user:users!rental_items_returned_by_fkey(full_name),rental:rentals(*,start_kiosk:kiosks(*),started_by_user:users!rentals_started_by_fkey(full_name),returned_by_user:users!rentals_returned_by_fkey(full_name))&order=returned_at.desc.nullsfirst`,
            );
      const [bike, items, faults] = await Promise.all([
        db(ctx, `bikes?id=eq.${parts[1]}&select=*,kiosk:kiosks(*)`),
        itemsPromise,
        db(
          ctx,
          `faults?bike_id=eq.${parts[1]}&select=*,created_by_user:users!faults_created_by_fkey(full_name),interventions:maintenance_interventions(*,created_by_user:users!maintenance_interventions_created_by_fkey(full_name))&order=created_at.desc`,
        ),
      ]);
      if (!bike[0]) return err("Bicicleta não encontrada.", 404);
      return json({ bike: bike[0], rental_items: items, faults });
    }
    if (parts[0] === "bikes" && parts[1] && request.method === "PATCH") {
      if (!["admin", "manutencao"].includes(ctx.user.role))
        return err(
          "Apenas administradores e manutenção podem alterar bicicletas.",
          403,
        );
      const old = (await db(ctx, `bikes?id=eq.${parts[1]}&select=*`))[0];
      if (!old) return err("Bicicleta não encontrada.", 404);
      const b = await body(request),
        admin = ctx.user.role === "admin",
        code = admin && b.code !== undefined ? String(b.code).trim().toUpperCase() : old.code,
        assetType = admin && b.asset_type !== undefined ? String(b.asset_type) : old.asset_type,
        model = admin && b.model !== undefined ? String(b.model).trim() : old.model,
        active = admin && b.active !== undefined ? !!b.active : old.active,
        prefixes:any={electric:'E',conventional:'C',child:'I',helmet:'CAP',lock:'CAD',stroller:'CAR'};
      if (!prefixes[assetType] || !new RegExp(`^${prefixes[assetType]}\\d{3,6}$`).test(code))
        return err("O código não corresponde à tipologia selecionada.");
      if (!model) return err("Indique o modelo ou a designação do item.");
      const rows = await db(ctx, "rpc/update_inventory_item", {
        method: "POST",
        body: JSON.stringify({
          p_bike_id: parts[1],
          p_code: code,
          p_asset_type: assetType,
          p_model: model,
          p_status: b.status ?? old.status,
          p_kiosk_id: b.kiosk_id ?? old.kiosk_id,
          p_active: active,
          p_user_id: ctx.user.id,
          p_fault_description: String(b.fault_description || "").trim() || null,
        }),
      });
      return json(rows);
    }
    if (route === "/reports/data" && request.method === "GET") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const [rentals, faults] = await Promise.all([
        dbAll(
          ctx,
          "rentals?status=eq.Concluído&select=*,start_kiosk:kiosks(*),started_by_user:users!rentals_started_by_fkey(full_name),returned_by_user:users!rentals_returned_by_fkey(full_name),items:rental_items(*,bike:bikes(*),return_kiosk:kiosks(*),returned_by_user:users!rental_items_returned_by_fkey(full_name))&order=started_at.desc",
        ),
        dbAll(
          ctx,
          "faults?select=*,bike:bikes(*),created_by_user:users!faults_created_by_fkey(full_name)&order=created_at.desc",
        ),
      ]);
      return json({ rentals, faults });
    }
  return null;
}

