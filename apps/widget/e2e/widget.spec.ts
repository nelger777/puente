import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3100";
const DEMO = `/demo/index.html?bundle=1&key=pk_e2e_opticamirador&api=${encodeURIComponent(API)}`;

interface E2eHandoff {
  code: string;
  contactPhone: string | null;
  events: { type: string }[];
}

async function handoff(code: string): Promise<E2eHandoff | undefined> {
  const res = await fetch(`${API}/__e2e/handoffs`);
  const all = (await res.json()) as E2eHandoff[];
  return all.find((h) => h.code === code);
}

async function openChat(page: Page) {
  await page.goto(DEMO);
  await page.getByRole("button", { name: "Abrir el chat con Luz" }).click();
  await expect(page.getByRole("dialog", { name: /Chat con Luz/ })).toBeVisible();
  await expect(page.getByText("¡Hola! Soy Luz.")).toBeVisible();
}

async function ask(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Tu mensaje" });
  await input.fill(text);
  await input.press("Enter");
}

test.beforeEach(async ({ context }) => {
  // Never leave the test machine: answer wa.me locally.
  await context.route("https://wa.me/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }),
  );
});

test("answers a question from the knowledge base", async ({ page }) => {
  await openChat(page);
  await ask(page, "¿Cuál es el horario?");

  await expect(page.getByText("Atendemos de lunes a sábado de 08:00 a 18:00.")).toBeVisible();
  await expect(page.getByRole("button", { name: "¿Dónde están ubicados?" })).toBeVisible();
  await expect(page.getByText("Te conectamos con una persona")).toHaveCount(0);
});

test("hands off to WhatsApp with the case code and records whatsapp_opened", async ({ page }) => {
  await openChat(page);
  await ask(page, "¿Qué precio tienen los lentes progresivos?");

  const card = page.getByRole("region", { name: /Derivación DER-/ });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("Hola, quiero saber el precio de unos lentes progresivos."),
  ).toBeVisible();
  const code = ((await card.getAttribute("aria-label")) ?? "").replace("Derivación ", "");
  expect(code).toMatch(/^DER-\d{4,6}$/);

  const link = card.getByRole("link", { name: "Continuar por WhatsApp con un asesor" });
  const href = (await link.getAttribute("href")) ?? "";
  const waUrl = new URL(href);
  expect(waUrl.origin + waUrl.pathname).toBe("https://wa.me/595981000000");
  expect(waUrl.searchParams.get("text")).toBe(
    `Hola, quiero saber el precio de unos lentes progresivos.\n\n(Caso ${code})`,
  );

  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(href);
  await expect(card.getByText("Listo. Continúa la conversación en WhatsApp.")).toBeVisible();

  await expect
    .poll(async () => (await handoff(code))?.events.map((e) => e.type))
    .toContain("whatsapp_opened");
});

test("the Asesor button hands off and the customer can ask to be called", async ({ page }) => {
  await openChat(page);
  await page.getByRole("button", { name: "Asesor" }).click();

  const card = page.getByRole("region", { name: /Derivación DER-/ });
  await expect(card).toBeVisible();
  const code = ((await card.getAttribute("aria-label")) ?? "").replace("Derivación ", "");

  await card.getByText("¿Prefieres que te contacten?").click();
  await card.getByRole("button", { name: "Que me contacten" }).click();
  await expect(card.getByText("Escribe un teléfono válido.")).toBeVisible();

  await card.getByLabel("Tu teléfono").fill("0981 123 456");
  await card.getByRole("button", { name: "Que me contacten" }).click();
  await expect(card.getByText("Necesitamos tu autorización para contactarte.")).toBeVisible();

  await card.getByLabel(/Acepto que Óptica Mirador/).check();
  await card.getByRole("button", { name: "Que me contacten" }).click();
  await expect(card.getByText("Listo. El equipo te contactará al 0981 123 456.")).toBeVisible();

  await expect.poll(async () => (await handoff(code))?.contactPhone).toBe("0981 123 456");
});

test("keeps the conversation after a reload", async ({ page }) => {
  await openChat(page);
  await ask(page, "¿Cuál es el horario?");
  await expect(page.getByText("Atendemos de lunes a sábado de 08:00 a 18:00.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Abrir el chat con Luz" }).click();
  await expect(page.getByText("¿Cuál es el horario?", { exact: true })).toBeVisible();
  await expect(page.getByText("Atendemos de lunes a sábado de 08:00 a 18:00.")).toBeVisible();
});

test("is keyboard accessible and closes with Escape", async ({ page }) => {
  await page.goto(DEMO);
  const launcher = page.getByRole("button", { name: "Abrir el chat con Luz" });
  await launcher.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Tu mensaje" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(launcher).toBeFocused();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
});

test("fills the screen on phones", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await openChat(page);
  const box = await page.getByRole("dialog").boundingBox();
  expect(box?.width).toBe(375);
  expect(box?.height).toBe(700);
});
