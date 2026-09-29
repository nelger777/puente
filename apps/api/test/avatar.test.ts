import { BusinessResponseSchema, WidgetConfigResponseSchema } from "@puente/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBusiness,
  createUser,
  loginAs,
  makeApp,
  ORIGIN,
  PANEL_ORIGIN,
  resetDb,
  testDb,
} from "./helpers";

const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$disconnect();
});

// 1×1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_BASE64}`;
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

type App = ReturnType<typeof makeApp>["app"];

function upload(app: App, cookie: string, dataUrl: string) {
  return app.inject({
    method: "PUT",
    url: "/v1/admin/business/avatar",
    headers: { cookie, origin: PANEL_ORIGIN },
    payload: { dataUrl },
  });
}

async function setup(role: "ADMIN" | "AGENT" = "ADMIN") {
  const business = await createBusiness(db);
  const user = await createUser(db, business.id, role);
  const { app } = makeApp(db);
  return { business, app, cookie: await loginAs(app, user.email) };
}

describe("assistant picture", () => {
  it("is uploaded by an admin, shown in the widget config and served as an image", async () => {
    const { app, cookie, business } = await setup();
    const res = await upload(app, cookie, PNG);
    expect(res.statusCode).toBe(200);
    const { avatarUrl } = BusinessResponseSchema.parse(res.json());
    expect(avatarUrl).toMatch(
      new RegExp(`^https://api\\.puente\\.test/v1/widget/avatar/${business.publicKey}\\?v=\\d+$`),
    );

    const config = WidgetConfigResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/v1/widget/config?key=${business.publicKey}`,
          headers: { origin: ORIGIN },
        })
      ).json(),
    );
    expect(config.avatarUrl).toBe(avatarUrl);

    const image = await app.inject({ method: "GET", url: new URL(avatarUrl ?? "").pathname });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(image.rawPayload.equals(Buffer.from(PNG_BASE64, "base64"))).toBe(true);
  });

  it("rejects SVG, disguised files, non-images and files over 200 KB", async () => {
    const { app, cookie } = await setup();
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg onload='alert(1)'/>").toString("base64")}`;
    const jpegClaimingPng = `data:image/png;base64,${JPEG_BYTES.toString("base64")}`;
    const text = `data:image/png;base64,${Buffer.from("<html>hola</html>").toString("base64")}`;
    const big = `data:image/png;base64,${Buffer.concat([
      Buffer.from(PNG_BASE64, "base64"),
      Buffer.alloc(201 * 1024),
    ]).toString("base64")}`;
    for (const dataUrl of [svg, jpegClaimingPng, text, big]) {
      const res = await upload(app, cookie, dataUrl);
      expect(res.statusCode).toBe(400);
    }
    expect(await db.businessAvatar.count()).toBe(0);
  });

  it("accepts a real JPEG", async () => {
    const { app, cookie } = await setup();
    const res = await upload(
      app,
      cookie,
      `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`,
    );
    expect(res.statusCode).toBe(200);
  });

  it("can be removed, falling back to the initial", async () => {
    const { app, cookie, business } = await setup();
    await upload(app, cookie, PNG);
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/admin/business/avatar",
      headers: { cookie, origin: PANEL_ORIGIN },
    });
    expect(BusinessResponseSchema.parse(res.json()).avatarUrl).toBeNull();
    const image = await app.inject({
      method: "GET",
      url: `/v1/widget/avatar/${business.publicKey}`,
    });
    expect(image.statusCode).toBe(404);
  });

  it("is changed only by admins and only for their own business", async () => {
    const agent = await setup("AGENT");
    expect((await upload(agent.app, agent.cookie, PNG)).statusCode).toBe(403);

    const other = await createBusiness(db);
    const admin = await setup();
    await upload(admin.app, admin.cookie, PNG);
    const rows = await db.businessAvatar.findMany({ select: { businessId: true } });
    expect(rows.map((r) => r.businessId)).toEqual([admin.business.id]);
    expect(rows.map((r) => r.businessId)).not.toContain(other.id);
  });
});
