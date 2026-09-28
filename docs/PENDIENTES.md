# Pendientes

Estado al 2026-09-28: **staging en línea** en https://puente.firefly.com.py (VPS compartido
`162.246.18.165`, detrás del Caddy del sistema; Puente escucha en `127.0.0.1:8090`). Los sitios
`judiciales` y `electro` del mismo servidor siguen funcionando igual.

## Para cerrar el Hito 6 (staging con negocio de prueba)

- [ ] **Negocio de prueba** (si no se hizo): `cd /opt/puente/deploy && docker compose exec api node dist/seed.js` → anotar la clave `pk_…`.
- [ ] **Prueba completa en el VPS** (empezar la línea con un espacio para que la contraseña no quede en el historial):
      ` cd /opt/puente && sh deploy/smoke.sh https://puente.firefly.com.py pk_XXXX https://opticamirador.com TU_CORREO 'TU_CONTRASEÑA'` → debe terminar en `Todo en orden.`
- [ ] **Panel → Configuración**: agregar `puente.firefly.com.py` y el dominio real a _Dominios autorizados_; WhatsApp del equipo con código de país (`595…` sin el 0); correo de avisos.
- [ ] **Página de prueba**: `https://puente.firefly.com.py/demo/?bundle=1&src=/widget/v1.js&key=pk_XXXX`

## Operación

- [ ] **Respaldos diarios** (agrega la tarea sin borrar otras):
      `(crontab -l 2>/dev/null; echo "30 3 * * * cd /opt/puente && sh deploy/backup.sh >> deploy/backup.log 2>&1") | crontab -`
- [ ] **Copiar los respaldos fuera del VPS** (almacenamiento del proveedor, `rclone`, etc.).

## IA (hoy con clave provisoria `sk-ant-pendiente`: todo se deriva con "IA no disponible")

- [ ] Cargar crédito en https://console.anthropic.com (Settings → Billing, ~5 USD) y poner un **límite de gasto mensual** (Settings → Limits, p. ej. 10 USD).
- [ ] Crear la clave (Settings → API Keys → Create Key, nombre `puente-vps`) y cargarla sin dejarla a la vista:
      `sh
    cd /opt/puente/deploy
    read -rsp "Pega la clave de Anthropic y presiona Enter: " K; echo
    sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$K|" .env; unset K
    docker compose up -d api
    `
- [ ] **Primera prueba con la IA real** (nunca se probó contra la API de Anthropic): en _Probar_, hacer preguntas de la base y fuera de ella; revisar _Resumen → Uso de la IA_ (costo, fallas). Si todas fallan como "respuesta inválida" o "error del servicio", revisar `docker compose logs --tail 100 api`.

## Correo (hoy `smtp://localhost:25`: los avisos no salen; las derivaciones sí se ven en el panel)

- [ ] Crear cuenta en un proveedor SMTP (Brevo: 300 correos/día gratis; o Resend) y verificar el dominio `firefly.com.py` (registros SPF/DKIM en Hosting Paraguay).
- [ ] En `/opt/puente/deploy/.env`: `SMTP_URL=smtps://USUARIO:CLAVE@smtp.proveedor.com:465`, `MAIL_FROM="Puente <avisos@firefly.com.py>"`, `ALERT_EMAIL=tu correo`; luego `docker compose up -d api`.
- [ ] Probar: pedir "hablar con una persona" en _Probar_ no envía correo (es modo prueba); hacerlo desde la página de prueba del widget.

## Opcional más adelante

- [ ] Enlace directo al chat (página alojada) para comercios que no pueden editar su HTML.
- [ ] Pantalla de gestión de usuarios del panel (hoy se crean con la semilla).
