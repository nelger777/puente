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

  describe("animations", () => {
    // GIF built byte by byte: header with a 2-color table, frames, trailer. `subBlocks` sets the
    // weight of each frame's image data (255 bytes each); the pixels themselves don't matter.
    const header = Buffer.concat([
      Buffer.from("GIF89a"),
      Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]),
    ]);
    const netscape = Buffer.concat([
      Buffer.from([0x21, 0xff, 11]),
      Buffer.from("NETSCAPE2.0"),
      Buffer.from([3, 1, 0, 0, 0]),
    ]);
    const xmp = Buffer.concat([
      Buffer.from([0x21, 0xff, 11]),
      Buffer.from("XMP DataXMP"),
      Buffer.from([9]),
      Buffer.from("gps=-25.3"),
      Buffer.from([0]),
    ]);
    const frame = (subBlocks: number) =>
      Buffer.concat([
        Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2]),
        ...Array.from({ length: subBlocks }, () =>
          Buffer.concat([Buffer.from([255]), Buffer.alloc(255, 7)]),
        ),
        Buffer.from([0]),
      ]);
    const gif = (...blocks: Buffer[]) => Buffer.concat([header, ...blocks, Buffer.from([0x3b])]);
    const dataUrl = (bytes: Buffer, type = "image/gif") =>
      `data:${type};base64,${bytes.toString("base64")}`;

    it("stores an animated GIF over 200 KB as uploaded, minus its metadata", async () => {
      const { app, cookie } = await setup();
      // Two frames of ~250 KB each: over the still-picture limit, under the animation one.
      const res = await upload(app, cookie, dataUrl(gif(netscape, xmp, frame(1000), frame(1000))));
      expect(res.statusCode).toBe(200);
      const { avatarUrl } = BusinessResponseSchema.parse(res.json());

      const image = await app.inject({ method: "GET", url: new URL(avatarUrl ?? "").pathname });
      expect(image.headers["content-type"]).toBe("image/gif");
      expect(image.rawPayload.equals(gif(netscape, frame(1000), frame(1000)))).toBe(true);
      expect(image.rawPayload.includes("gps")).toBe(false);
    });

    it("refuses an animation over 1000 KB and a still GIF over 200 KB", async () => {
      const { app, cookie } = await setup();
      const heavy = await upload(app, cookie, dataUrl(gif(netscape, frame(2100), frame(2100))));
      expect(heavy.statusCode).toBe(400);
      expect(heavy.json()).toMatchObject({ error: { message: /1000 KB/ } });

      const still = await upload(app, cookie, dataUrl(gif(frame(900))));
      expect(still.statusCode).toBe(400);
      expect(still.json()).toMatchObject({ error: { message: /200 KB/ } });
      expect(await db.businessAvatar.count()).toBe(0);
    });

    it("refuses a truncated file and a GIF declared as PNG", async () => {
      const { app, cookie } = await setup();
      const whole = gif(netscape, frame(2), frame(2));
      const truncated = await upload(app, cookie, dataUrl(whole.subarray(0, whole.length - 5)));
      expect(truncated.statusCode).toBe(400);
      const disguised = await upload(app, cookie, dataUrl(whole, "image/png"));
      expect(disguised.statusCode).toBe(400);
      expect(await db.businessAvatar.count()).toBe(0);
    });
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
