import { afterEach, beforeEach, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION_TESTS === "1";
const baseUrl = process.env.TEST_SUPABASE_URL || "";
const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";
const confirmation = process.env.INTEGRATION_TEST_CONFIRMATION || "";

if (enabled && (!baseUrl || !serviceKey)) {
  throw new Error(
    "Defina TEST_SUPABASE_URL e TEST_SUPABASE_SERVICE_ROLE_KEY para executar os testes de integração.",
  );
}
if (enabled && confirmation !== "TEST_DATABASE_CAN_BE_CLEARED") {
  throw new Error(
    "Confirme uma base isolada com INTEGRATION_TEST_CONFIRMATION=TEST_DATABASE_CAN_BE_CLEARED.",
  );
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

const ids: Record<string, string[]> = {
  kiosks: [],
  users: [],
  bikes: [],
  rentals: [],
};
let kioskId = "";
let userId = "";
let bikeIds: string[] = [];

async function insert(table: string, body: unknown) {
  const result = await request(table, {
    method: "POST",
    body: JSON.stringify(body),
  });
  expect(result.response.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body;
}

async function startRental(selectedBikeIds: string[], contact = "+351 910 000 000") {
  return request("rpc/start_rental", {
    method: "POST",
    body: JSON.stringify({
      p_customer_ref: "Teste de concorrência",
      p_start_kiosk_id: kioskId,
      p_bike_ids: selectedBikeIds,
      p_user_id: userId,
      p_customer_contact: contact,
    }),
  });
}

describe.skipIf(!enabled)("alugueres contra PostgreSQL real", () => {
  beforeEach(async () => {
    for (const key of Object.keys(ids)) ids[key] = [];
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const kiosk = await insert("kiosks", {
      name: `Quiosque integração ${suffix}`,
      active: true,
      allows_rentals: true,
    });
    kioskId = kiosk[0].id;
    ids.kiosks.push(kioskId);

    const user = await insert("users", {
      full_name: "Teste Integração",
      username: `integration${suffix}`.toLowerCase(),
      password_hash: "integration-test-only",
      role: "admin",
      active: true,
      usual_kiosk_id: kioskId,
    });
    userId = user[0].id;
    ids.users.push(userId);

    const number = Number(suffix.slice(-6));
    const bikes = await insert("bikes", [0, 1].map((offset) => ({
      code: `E${String(number + offset).padStart(6, "0")}`,
      asset_type: "electric",
      model: "Bicicleta de teste",
      kiosk_id: kioskId,
      status: "Disponível",
      active: true,
    })));
    bikeIds = bikes.map((bike: { id: string }) => bike.id);
    ids.bikes.push(...bikeIds);
  });

  afterEach(async () => {
    if (ids.rentals.length) {
      const rentalFilter = ids.rentals.join(",");
      await request(`audit_log?entity_id=in.(${rentalFilter})`, { method: "DELETE" });
      await request(`rental_items?rental_id=in.(${rentalFilter})`, { method: "DELETE" });
      await request(`rentals?id=in.(${rentalFilter})`, { method: "DELETE" });
    }
    if (ids.bikes.length) {
      const bikeFilter = ids.bikes.join(",");
      await request(`bike_status_history?bike_id=in.(${bikeFilter})`, { method: "DELETE" });
      await request(`bikes?id=in.(${bikeFilter})`, { method: "DELETE" });
    }
    if (ids.users.length)
      await request(`users?id=in.(${ids.users.join(",")})`, { method: "DELETE" });
    if (ids.kiosks.length)
      await request(`kiosks?id=in.(${ids.kiosks.join(",")})`, { method: "DELETE" });
  });

  it("permite apenas um de dois alugueres simultâneos do mesmo artigo", async () => {
    const results = await Promise.all([
      startRental([bikeIds[0]]),
      startRental([bikeIds[0]]),
    ]);
    const successes = results.filter((result) => result.response.ok);
    expect(successes).toHaveLength(1);
    ids.rentals.push(successes[0].body.id);
  });

  it("conclui corretamente duas devoluções simultâneas", async () => {
    const started = await startRental(bikeIds);
    expect(started.response.status, JSON.stringify(started.body)).toBeLessThan(300);
    const rentalId = started.body.id;
    ids.rentals.push(rentalId);

    const items = await request(
      `rental_items?rental_id=eq.${rentalId}&select=id&order=id`,
    );
    expect(items.body).toHaveLength(2);

    const returnItem = (id: string) =>
      request("rpc/return_rental_items", {
        method: "POST",
        body: JSON.stringify({
          p_rental_id: rentalId,
          p_return_kiosk_id: kioskId,
          p_items: [
            { rental_item_id: id, anomaly: false, anomaly_description: "" },
          ],
          p_user_id: userId,
        }),
      });

    const returned = await Promise.all(items.body.map((item: { id: string }) => returnItem(item.id)));
    expect(returned.every((result) => result.response.ok)).toBe(true);

    const rental = await request(
      `rentals?id=eq.${rentalId}&select=status,customer_contact`,
    );
    expect(rental.body[0]).toEqual({
      status: "Concluído",
      customer_contact: null,
    });
  });
});
