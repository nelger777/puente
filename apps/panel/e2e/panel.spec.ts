import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3100";
const ADMIN = { email: "admin@e2e.test", password: "clave-segura-123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(ADMIN.email);
  await page.getByLabel("Contraseña").fill(ADMIN.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
}

/** A real customer case, created through the public widget API. */
async function customerCase(message = "Quiero hablar con una persona"): Promise<string> {
  const res = await fetch(`${API}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5181" },
    body: JSON.stringify({ key: "pk_e2e_opticamirador", visitorId: "v_e2e", message }),
  });
  const body = (await res.json()) as { handoff: { code: string } | null };
  if (!body.handoff) throw new Error("expected a handoff");
  return body.handoff.code;
}

test("rejects a wrong password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(ADMIN.email);
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("alert")).toContainText("Correo o contraseña incorrectos");
});

test("an admin configures, edits the knowledge base, tries the assistant and resolves a case", async ({
  page,
}) => {
  const code = await customerCase();
  await login(page);

  // Summary shows the pending case and the menu badge.
  await expect(page.getByRole("link", { name: new RegExp(code) })).toBeVisible();
  await expect(page.getByLabel(/pendientes/)).toBeVisible();

  // Configuration
  await page.getByRole("link", { name: "Configuración" }).click();
  await page.getByLabel("Nombre del asistente").fill("Sol");
  await page.getByLabel("Saludo del asistente").fill("¡Hola! Soy Sol, ¿en qué te ayudo?");
  await page.getByLabel("Dominios autorizados").fill("opticamirador.com\nwww.opticamirador.com");
  await page.getByLabel("WhatsApp del equipo").fill("abc");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Revisa los campos marcados.")).toBeVisible();
  await page.getByLabel("WhatsApp del equipo").fill("595981222333");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Nombre del asistente")).toHaveValue("Sol");

  // Knowledge base
  await page.getByRole("link", { name: "Base de conocimiento" }).click();
  await expect(page.getByText(/1 pregunta · ~\d+ tokens por mensaje/)).toBeVisible();
  await page.getByRole("button", { name: "Agregar pregunta" }).click();
  await page.getByRole("textbox", { name: "Pregunta 2", exact: true }).fill("¿Hacen envíos?");
  await page.getByRole("textbox", { name: "Respuesta 2", exact: true }).fill("Sí, a todo el país.");
  await page.getByRole("button", { name: "Subir pregunta 2" }).click();
  await page.getByRole("button", { name: "Guardar base" }).click();
  await expect(page.getByText("Base guardada")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Pregunta 1", exact: true })).toHaveValue(
    "¿Hacen envíos?",
  );
  await expect(page.getByText(/2 preguntas/)).toBeVisible();

  // Try the assistant with the new settings
  await page.getByRole("link", { name: "Probar" }).click();
  await expect(page.getByText("¡Hola! Soy Sol, ¿en qué te ayudo?")).toBeVisible();
  const input = page.getByRole("textbox", { name: "Tu mensaje" });
  await input.fill("¿Cuál es el horario?");
  await input.press("Enter");
  await expect(page.getByText("Atendemos de lunes a sábado de 08:00 a 18:00.")).toBeVisible();

  // Resolve the customer's case
  await page.getByRole("link", { name: /^Derivaciones/ }).click();
  await page.getByRole("link", { name: new RegExp(code) }).click();
  await expect(page.getByRole("heading", { name: `Caso ${code}` })).toBeVisible();
  await expect(
    page.locator(".bubble.USER", { hasText: "Quiero hablar con una persona" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Marcar atendido" }).click();
  await expect(page.getByRole("button", { name: "Reabrir" })).toBeVisible();
  await expect(page.getByText("Marcada como atendida")).toBeVisible();

  await page.getByRole("link", { name: /^Derivaciones/ }).click();
  await page.getByRole("button", { name: "Atendidas" }).click();
  await expect(page.getByRole("link", { name: new RegExp(code) })).toBeVisible();
  await page.getByRole("button", { name: "Pendientes" }).click();
  await expect(page.getByRole("link", { name: new RegExp(code) })).toHaveCount(0);
});

test("shows the install snippet with the business key", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Instalación" }).click();
  await expect(page.getByLabel("Código de instalación")).toContainText(
    'data-key="pk_e2e_opticamirador"',
  );
});

test("logging out protects the panel", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/derivaciones");
  await expect(page).toHaveURL(/\/login$/);
});

test("an admin uploads the assistant picture and sees it in the chat header", async ({ page }) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await login(page);
  await page.getByRole("link", { name: "Configuración" }).click();
  await page
    .locator("#avatar-file")
    .setInputFiles({ name: "laura.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Imagen actualizada")).toBeVisible();
  await expect(page.locator(".avatar-preview img")).toHaveAttribute(
    "src",
    /\/v1\/widget\/avatar\//,
  );

  await page.getByRole("link", { name: "Probar" }).click();
  await expect(page.locator(".head .avatar img")).toHaveJSProperty("naturalWidth", 1);

  await page.getByRole("link", { name: "Configuración" }).click();
  await page.getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText("Imagen quitada")).toBeVisible();
});
