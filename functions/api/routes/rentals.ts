import {
  type Ctx, json, err, db, dbAll, dbCount, body, audit, allow, q,
  passwordHash, uploadReceipt, readReceipt,
} from "../_shared";

export async function handleRentalRoutes(ctx: Ctx, request: Request, route: string, parts: string[]) {
    if (parts[0] === "rentals" && ctx.user.role === "manutencao")
      return err("O perfil de manutenção não tem acesso aos alugueres.", 403);
    if (route === "/rentals" && request.method === "GET") {
      const owner =
        ctx.user.role === "admin" ? "" : `&started_by=eq.${q(ctx.user.id)}`;
      const discrepancyOwner =
        ctx.user.role === "admin" ? "" : `&created_by=eq.${q(ctx.user.id)}`;
      const rentalSelect = "select=*,start_kiosk:kiosks(*),started_by_user:users!rentals_started_by_fkey(full_name),returned_by_user:users!rentals_returned_by_fkey(full_name),items:rental_items(*,bike:bikes(*),return_kiosk:kiosks(*),returned_by_user:users!rental_items_returned_by_fkey(full_name))";
      const [openRentals, completedRentals, bikes, kiosks, discrepancies, summary] = await Promise.all([
        db(
          ctx,
          `rentals?${rentalSelect}&status=eq.Em%20aberto${owner}&order=started_at.desc`,
        ),
        db(
          ctx,
          `rentals?${rentalSelect}&status=eq.Concluído${owner}&order=started_at.desc&limit=500`,
        ),
        db(
          ctx,
          "bikes?active=eq.true&status=eq.Disponível&select=*,kiosk:kiosks!inner(*)&kiosk.allows_rentals=eq.true&order=code",
        ),
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
      ]);
      const rentals=[...openRentals,...completedRentals].sort((a:any,b:any)=>String(b.started_at).localeCompare(String(a.started_at)));
      return json({ rentals, available_bikes: bikes, kiosks, discrepancies, summary });
    }
    if (route === "/rentals" && request.method === "POST") {
      const b = await body(request),
        customerContact = String(b.customer_contact || "").trim(),
        chargedAmount = Number(b.charged_amount);
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
      const rows = await db(ctx, "rpc/start_rental", {
        method: "POST",
        body: JSON.stringify({
          p_customer_ref: b.customer_ref.trim(),
          p_start_kiosk_id: b.start_kiosk_id,
          p_bike_ids: b.bike_ids,
          p_user_id: ctx.user.id,
          p_customer_contact: customerContact || null,
          p_charged_amount: chargedAmount,
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
          `rentals?id=eq.${parts[1]}&select=id,started_by,start_kiosk_id`,
        )
      )[0];
      if (!rental) return err("Aluguer não encontrado.", 404);
      if (ctx.user.role !== "admin" && rental.started_by !== ctx.user.id)
        return err("Não pode alterar alugueres de outro utilizador.", 403);
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
      return json(result);
    }
  return null;
}
