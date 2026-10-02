import {
  type Ctx, json, err, db, dbAll, dbCount, body, audit, allow, q,
  passwordHash, uploadReceipt, readReceipt, securityHeaders,
} from "../_shared";

export async function handleDailyAndActivityRoutes(ctx: Ctx, request: Request, route: string, parts: string[]) {
    if (parts[0] === "daily-closures" && ctx.user.role === "manutencao")
      return err(
        "O perfil de manutenção não tem acesso aos fechos diários.",
        403,
      );
    if (route === "/daily-closures" && request.method === "GET") {
      const owner =
        ctx.user.role === "admin" ? "" : `&user_id=eq.${q(ctx.user.id)}`;
      const [closures, kiosks] = await Promise.all([
        dbAll(
          ctx,
          `daily_closures?select=*,kiosk:kiosks(*),user:users!daily_closures_user_id_fkey(full_name,username)&order=report_date.desc,created_at.desc${owner}`,
        ),
        db(
          ctx,
          "kiosks?active=eq.true&allows_rentals=eq.true&select=*&order=name",
        ),
      ]);
      return json({ closures, kiosks });
    }
    if (route === "/daily-closures/stats" && request.method === "GET") {
      const url = new URL(request.url),
        reportDate = url.searchParams.get("date") || "",
        kioskId = url.searchParams.get("kiosk_id") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !kioskId)
        return err("Indique uma data e um quiosque válidos.");
      const stats = await db(ctx, "rpc/daily_closure_stats", {
        method: "POST",
        body: JSON.stringify({
          p_report_date: reportDate,
          p_kiosk_id: kioskId,
          p_user_id: ctx.user.id,
        }),
      });
      return json({
        stats: stats || {
          rental_count: 0,
          bike_count: 0,
          electric_count: 0,
          conventional_count: 0,
          child_count: 0,
          accessory_count: 0,
        },
      });
    }
    if (route === "/daily-closures" && request.method === "POST") {
      const b = await body(request),
        reportDate = String(b.report_date || ""),
        kioskId = String(b.kiosk_id || ""),
        status = b.status === "Submetido" ? "Submetido" : "Rascunho",
        cardTotal = Number(b.card_total);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !kioskId)
        return err("Indique uma data e um quiosque válidos.");
      if (!Number.isFinite(cardTotal) || cardTotal < 0)
        return err("Indique um valor de Multibanco válido.");
      const kiosk = (
        await db(
          ctx,
          `kiosks?id=eq.${q(kioskId)}&active=eq.true&allows_rentals=eq.true&select=id`,
        )
      )[0];
      if (!kiosk) return err("O quiosque selecionado não permite alugueres.");
      const existing = (
        await db(
          ctx,
          `daily_closures?report_date=eq.${q(reportDate)}&kiosk_id=eq.${q(kioskId)}&user_id=eq.${q(ctx.user.id)}&select=*`,
        )
      )[0];
      if (existing?.status === "Submetido" && ctx.user.role !== "admin")
        return err(
          "Este fecho já foi submetido. Peça a um administrador para o reabrir.",
          409,
        );
      let receiptPath = existing?.receipt_path || null,
        receiptName = existing?.receipt_name || null,
        receiptType = existing?.receipt_content_type || null;
      if (b.receipt?.data) {
        const safeName = String(b.receipt.name || "talao").replace(
            /[^a-zA-Z0-9._-]/g,
            "_",
          ),
          ext = safeName.includes(".") ? safeName.split(".").pop() : "bin";
        receiptPath = `${ctx.user.id}/${reportDate}-${kioskId}.${ext}`;
        const uploadError = await uploadReceipt(
          ctx,
          receiptPath,
          String(b.receipt.data),
          String(b.receipt.type || ""),
        );
        if (uploadError) return uploadError;
        receiptName = String(b.receipt.name || "Talão");
        receiptType = String(b.receipt.type || "application/octet-stream");
      }
      if (status === "Submetido" && !receiptPath)
        return err("Anexe o talão de fecho de caixa antes de submeter.");
      const stats = await db(ctx, "rpc/daily_closure_stats", {
        method: "POST",
        body: JSON.stringify({
          p_report_date: reportDate,
          p_kiosk_id: kioskId,
          p_user_id: ctx.user.id,
        }),
      });
      const values = {
        report_date: reportDate,
        kiosk_id: kioskId,
        user_id: ctx.user.id,
        rental_count: Number(stats?.rental_count || 0),
        bike_count: Number(stats?.bike_count || 0),
        electric_count: Number(stats?.electric_count || 0),
        conventional_count: Number(stats?.conventional_count || 0),
        child_count: Number(stats?.child_count || 0),
        accessory_count: Number(stats?.accessory_count || 0),
        card_total: cardTotal,
        receipt_path: receiptPath,
        receipt_name: receiptName,
        receipt_content_type: receiptType,
        observations: String(b.observations || "").trim() || null,
        status,
        submitted_at: status === "Submetido" ? new Date().toISOString() : null,
      };
      const rows = existing
        ? await db(ctx, `daily_closures?id=eq.${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify(values),
          })
        : await db(ctx, "daily_closures", {
            method: "POST",
            body: JSON.stringify(values),
          });
      await audit(
        ctx,
        status === "Submetido" ? "submeter" : "guardar rascunho",
        "fecho diário",
        rows[0].id,
        existing || null,
        rows[0],
      );
      return json(rows[0], existing ? 200 : 201);
    }
    if (
      parts[0] === "daily-closures" &&
      parts[1] &&
      parts[2] === "correct" &&
      request.method === "PATCH"
    ) {
      if (!allow(ctx, "admin")) return err("Acesso reservado a administradores.", 403);
      const old = (await db(ctx, `daily_closures?id=eq.${q(parts[1])}&select=*`))[0];
      if (!old) return err("Fecho diário não encontrado.", 404);
      if (old.status !== "Submetido") return err("Só é possível corrigir um fecho submetido.", 409);
      const b = await body(request), reason = String(b.reason || "").trim(), cardTotal = Number(b.card_total);
      if (reason.length < 5) return err("Indique o motivo da correção (pelo menos 5 caracteres).");
      if (!Number.isFinite(cardTotal) || cardTotal < 0) return err("Indique um valor de Multibanco válido.");
      const countFields = ["rental_count", "electric_count", "conventional_count", "child_count", "accessory_count"] as const;
      const counts = Object.fromEntries(countFields.map((field) => [field, Number(b[field])])) as Record<(typeof countFields)[number], number>;
      if (countFields.some((field) => !Number.isSafeInteger(counts[field]) || counts[field] < 0 || counts[field] > 10000))
        return err("Os totais do fecho têm de ser números inteiros entre 0 e 10000.");
      let receiptPath = old.receipt_path, receiptName = old.receipt_name, receiptType = old.receipt_content_type;
      if (b.receipt?.data) {
        const safeName = String(b.receipt.name || "talao").replace(/[^a-zA-Z0-9._-]/g, "_"), ext = safeName.includes(".") ? safeName.split(".").pop() : "bin";
        receiptPath = `${old.user_id}/${old.report_date}-${old.kiosk_id}-correcao-${Date.now()}.${ext}`;
        const uploadError = await uploadReceipt(ctx, receiptPath, String(b.receipt.data), String(b.receipt.type || ""));
        if (uploadError) return uploadError;
        receiptName = String(b.receipt.name || "Talão"); receiptType = String(b.receipt.type || "application/octet-stream");
      }
      const values = {
        ...counts,
        bike_count: counts.electric_count + counts.conventional_count + counts.child_count,
        card_total: cardTotal, observations: String(b.observations || "").trim() || null,
        receipt_path: receiptPath, receipt_name: receiptName, receipt_content_type: receiptType,
        corrected_at: new Date().toISOString(), corrected_by: ctx.user.id, correction_reason: reason,
      };
      const rows = await db(ctx, `daily_closures?id=eq.${old.id}`, { method: "PATCH", body: JSON.stringify(values) });
      await db(ctx, "daily_closure_revisions", { method: "POST", body: JSON.stringify({ closure_id: old.id, corrected_by: ctx.user.id, reason, old_value: old, new_value: rows[0] }) });
      await audit(ctx, "corrigir", "fecho diário", old.id, old, rows[0], reason);
      return json(rows[0]);
    }
    if (
      parts[0] === "daily-closures" &&
      parts[1] &&
      parts[2] === "receipt" &&
      request.method === "GET"
    ) {
      const closure = (
        await db(
          ctx,
          `daily_closures?id=eq.${q(parts[1])}&select=id,user_id,receipt_path,receipt_name,receipt_content_type`,
        )
      )[0];
      if (!closure?.receipt_path) return err("Talão não encontrado.", 404);
      if (ctx.user.role !== "admin" && closure.user_id !== ctx.user.id)
        return err("Não pode consultar este talão.", 403);
      const response = await readReceipt(ctx, closure.receipt_path);
      return new Response(response.body, {
        status: 200,
        headers: {
          ...securityHeaders,
          "Content-Type":
            closure.receipt_content_type ||
            response.headers.get("Content-Type") ||
            "application/octet-stream",
          "Content-Disposition": `inline; filename="${String(closure.receipt_name || "talao").replace(/"/g, "")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (
      parts[0] === "daily-closures" &&
      parts[1] &&
      parts[2] === "reopen" &&
      request.method === "PATCH"
    ) {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const old = (
        await db(ctx, `daily_closures?id=eq.${q(parts[1])}&select=*`)
      )[0];
      if (!old) return err("Fecho diário não encontrado.", 404);
      const rows = await db(ctx, `daily_closures?id=eq.${old.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Rascunho", submitted_at: null }),
      });
      await audit(ctx, "reabrir", "fecho diário", old.id, old, rows[0]);
      return json(rows[0]);
    }
    if (route === "/activity" && request.method === "GET") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const rows = await db(
        ctx,
        "audit_log?select=*,user:users(full_name,username)&order=created_at.desc&limit=500",
      );
      return json({ activity: rows });
    }
  return null;
}
