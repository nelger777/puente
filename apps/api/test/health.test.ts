import { afterAll, describe, expect, it } from "vitest";
import { makeApp, testDb } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /health", () => {
  it("responds ok", async () => {
    const { app } = makeApp(db);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  it("answers unknown routes with the error format", async () => {
    const { app } = makeApp(db);
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "not_found", message: "Route not found" } });
  });
});
