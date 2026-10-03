# Pendientes

Estado al 2026-10-02: **staging en línea con La Rural Seguros** (12/12 verificaciones de `smoke.sh`; respaldo diario 03:30 UTC probado) en https://puente.firefly.com.py (VPS compartido
`162.246.18.165`, detrás del Caddy del sistema; Puente escucha en `127.0.0.1:8090`). Los sitios
`judiciales` y `electro` del mismo servidor siguen funcionando igual.

## Para cerrar el Hito 6 (staging con negocio de prueba)

- [x] **Negocio de prueba** (si no se hizo): `cd /opt/puente/deploy && docker compose exec api node dist/seed.js` → anotar la clave `pk_…`.
- [x] **Prueba completa en el VPS** (empezar la línea con un espacio para que la contraseña no quede en el historial):
      ` cd /opt/puente && sh deploy/smoke.sh https://puente.firefly.com.py pk_XXXX https://opticamirador.com TU_CORREO 'TU_CONTRASEÑA'` → debe terminar en `Todo en orden.`
- [x] **Panel → Configuración**: agregar `puente.firefly.com.py` y el dominio real a _Dominios autorizados_; WhatsApp del equipo con código de país (`595…` sin el 0); correo de avisos.
- [x] **Página de prueba**: `https://puente.firefly.com.py/demo/?bundle=1&src=/widget/v1.js&key=pk_XXXX`

## Operación

- [x] **Respaldos diarios** (agrega la tarea sin borrar otras):
      `(crontab -l 2>/dev/null; echo "30 3 * * * cd /opt/puente && sh deploy/backup.sh >> deploy/backup.log 2>&1") | crontab -`
- [ ] **Copiar los respaldos fuera del VPS** (almacenamiento del proveedor, `rclone`, etc.).

## IA (clave real de Anthropic cargada y probada en staging, 2026-10-02)

- [x] Cargar crédito en https://console.anthropic.com (Settings → Billing, ~5 USD) y poner un **límite de gasto mensual** (Settings → Limits, p. ej. 10 USD).
- [x] Crear la clave (Settings → API Keys → Create Key, nombre `puente-vps`) y cargarla sin dejarla a la vista (comandos abajo).
- [x] **Primera prueba con la IA real** (nunca se probó contra la API de Anthropic): en _Probar_, hacer preguntas de la base y fuera de ella; revisar _Resumen → Uso de la IA_ (costo, fallas). Si todas fallan como "respuesta inválida" o "error del servicio", revisar `docker compose logs --tail 100 api`.

Cargar la clave real:

```sh
cd /opt/puente/deploy
read -rsp "Pega la clave de Anthropic y presiona Enter: " K; echo
sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$K|" .env; unset K
docker compose up -d api
```

## Correo (hoy `smtp://localhost:25`: no salen los avisos de derivaciones, de fallas de la IA ni de uso del plan; las derivaciones sí se ven en el panel)

- [ ] Crear cuenta en un proveedor SMTP (Brevo: 300 correos/día gratis; o Resend) y verificar el dominio `firefly.com.py` (registros SPF/DKIM en Hosting Paraguay).
- [ ] En `/opt/puente/deploy/.env`: `SMTP_URL=smtps://USUARIO:CLAVE@smtp.proveedor.com:465`, `MAIL_FROM="Puente <avisos@firefly.com.py>"`, `ALERT_EMAIL=tu correo`; luego `docker compose up -d api`.
- [ ] Verificar que lleguen los avisos de uso del plan (80 % y 100 %) al correo de avisos del negocio y a `ALERT_EMAIL`, una vez fijado un tope con `set-quota.js`.
- [ ] Probar: pedir "hablar con una persona" en _Probar_ no envía correo (es modo prueba); hacerlo desde la página de prueba del widget.

## La Rural Seguros (asistente Laura)

- [x] Cargar el negocio en staging: `sh deploy/deploy.sh` y luego, en `/opt/puente/deploy`: `docker compose exec -e SEED_BUSINESS=la-rural api node dist/seed.js` (el admin de `SEED_ADMIN_EMAIL` pasa a gestionar La Rural).
- [ ] **Reemplazar los datos ficticios** antes de mostrarlo a La Rural (`_datosFicticios` en `apps/api/prisma/businesses/la-rural.json`, o desde el panel): enlaces de cotización, seguros, sucursales, denuncia de siniestros y medios de pago; lista de oficinas y horarios; correo de avisos; color de marca.
- [ ] Probar a Laura con la IA real (requiere crédito en Anthropic): preguntas de la base, pedido de datos para siniestros/pólizas y derivación.
- [ ] Instalar el widget en `www.larural.com.py` (snippet en _Instalación_).
- [ ] Presupuesto de IA estimado para ~50 conversaciones web/día: 20–30 USD/mes.
- [ ] Fase 2 (a definir con La Rural): bot en WhatsApp (API de WhatsApp Business) e integración con Joaju (CRM).

## IA gratuita para demos (Gemini)

- [ ] Crear la clave en https://aistudio.google.com → **Get API key** → **Create API key** (cuenta de Google personal o de la empresa).
- [ ] Panel → Configuración → **Motor de IA** → "Gemini gratis (solo demo)" → pegar la clave → **Guardar motor** → **Probar conexión**.
- [ ] Antes de atender clientes reales de La Rural, volver a "Predeterminado" (o Claude con clave propia): en el plan gratuito Google puede usar las conversaciones.

## Contador mensual de conversaciones

- [x] Desplegado en staging el 2026-10-03 (migración aplicada; La Rural: 4 conversaciones en septiembre y 4 en octubre). Falta mirar la tarjeta del mes en _Resumen_.
- [ ] Si La Rural elige el plan mensual: `docker compose exec api node dist/set-quota.js la-rural 4000`. Con pago único y clave propia, dejarlo sin tope.
- [ ] Cargar `ALERT_EMAIL` en `deploy/.env` para recibir los avisos de 80 % y 100 % (requiere el SMTP de la sección Correo).

## Opcional más adelante

- [ ] Enlace directo al chat (página alojada) para comercios que no pueden editar su HTML.
- [ ] Pantalla de gestión de usuarios del panel (hoy se crean con la semilla).
