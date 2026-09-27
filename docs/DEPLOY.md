# Despliegue de Puente

Todo corre en **un solo servidor** con Docker:

| Servicio             | Qué hace                                                                                                  | Expuesto              |
| -------------------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| `web` (Caddy)        | HTTPS automático (Let's Encrypt); sirve el panel en `/`, el widget en `/widget/` y reenvía `/v1` a la API | 80 y 443              |
| `api` (Node 24)      | API y motor del asistente; aplica las migraciones al arrancar; tareas de retención y alertas              | no (solo red interna) |
| `db` (PostgreSQL 17) | Datos                                                                                                     | no (solo red interna) |

Los comercios instalan el asistente con una línea en su sitio:

```html
<script src="https://puente.tudominio.com/widget/v1.js" data-key="pk_..." async></script>
```

El panel la muestra ya armada en **Instalación**.

## 1. Preparar el servidor (una sola vez)

Requisitos: VPS con Ubuntu 24.04, 2 GB de RAM, 20 GB de disco (Hetzner CX22, DigitalOcean
Basic 2 GB o similar).

```sh
# Como root en el servidor
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh            # Docker + docker compose
adduser --disabled-password --gecos "" puente && usermod -aG docker puente

# Firewall: SSH y web
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable

# Código
mkdir -p /opt/puente && chown puente:puente /opt/puente
su - puente -c "git clone https://github.com/nelger777/puente.git /opt/puente"
```

> Si el repositorio es privado, crea una _deploy key_ de solo lectura en GitHub
> (Settings → Deploy keys) con la clave pública de `/home/puente/.ssh/id_ed25519.pub`
> y clona con `git@github.com:nelger777/puente.git`.

## 2. DNS

En el proveedor de tu dominio crea un registro **A**: `puente` → IP del servidor (y **AAAA** si
tiene IPv6). Comprueba con `dig +short puente.tudominio.com` antes de seguir: Caddy necesita
que el dominio ya apunte al servidor para emitir el certificado.

## 3. Configuración

```sh
su - puente
cd /opt/puente/deploy
cp .env.example .env
chmod 600 .env
nano .env
```

| Variable                                  | Valor                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_ADDRESS`                            | `puente.tudominio.com`                                                                                                          |
| `PUBLIC_URL`                              | `https://puente.tudominio.com`                                                                                                  |
| `POSTGRES_PASSWORD`, `SESSION_SECRET`     | `openssl rand -base64 48` (uno distinto para cada una)                                                                          |
| `ANTHROPIC_API_KEY`                       | Clave de la consola de Anthropic                                                                                                |
| `SMTP_URL`, `MAIL_FROM`                   | Proveedor SMTP (Brevo, Amazon SES, Resend, Mailgun). El remitente debe ser de un dominio verificado en ese proveedor (SPF/DKIM) |
| `ALERT_EMAIL`                             | Tu correo: alerta si la IA falla más del 5 % en una hora                                                                        |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Admin del primer negocio (contraseña de 12+ caracteres)                                                                         |

## 4. Primer despliegue

```sh
cd /opt/puente
sh deploy/deploy.sh
```

La primera vez tarda unos minutos (construye las imágenes). Al terminar, `https://puente.tudominio.com`
muestra el login del panel.

## 5. Staging: negocio de prueba

```sh
cd /opt/puente/deploy
docker compose exec api node dist/seed.js
```

Crea "Óptica Mirador" con 5 preguntas y el admin de `SEED_ADMIN_EMAIL`, y muestra la **clave
pública** (`pk_...`). Luego:

1. Entra al panel con ese admin.
2. **Configuración** → _Dominios autorizados_: agrega `puente.tudominio.com` (para la página de
   prueba) y el dominio del sitio donde lo vas a probar. Cambia el WhatsApp y el correo de avisos
   por los tuyos.
3. **Probar**: conversa con el asistente (con tu clave de Anthropic ya responde la IA real).
4. Página de prueba con el widget real:
   `https://puente.tudominio.com/demo/?bundle=1&src=/widget/v1.js&key=pk_...`
5. Verificación automática (crea una derivación de prueba):

```sh
sh deploy/smoke.sh https://puente.tudominio.com pk_... https://puente.tudominio.com admin@... 'contraseña'
```

Borra después la derivación de prueba marcándola como atendida (o déjala: la retención la
eliminará a los 90 días).

## 6. Actualizar

```sh
cd /opt/puente && sh deploy/deploy.sh
```

Descarga la última versión, reconstruye, reinicia y espera a que la API esté sana. Las
migraciones se aplican solas. Los comercios reciben el widget nuevo en menos de una hora
(`/widget/v1.js` se cachea 1 hora).

**Volver a una versión anterior:** `sh deploy/deploy.sh <commit>` (ver `git log --oneline`).
Si esa versión es anterior a una migración, restaura también el respaldo previo (sección 7).

## 7. Respaldos

```sh
crontab -e   # como usuario puente
30 3 * * * cd /opt/puente && sh deploy/backup.sh >> deploy/backup.log 2>&1
```

Guarda un volcado comprimido diario en `deploy/backups/` (14 días). **Copia los respaldos fuera
del servidor** (por ejemplo, el almacenamiento de backups del proveedor o `rclone` a otro
servicio).

Restaurar (reemplaza todos los datos actuales por los del respaldo):

```sh
cd /opt/puente/deploy
docker compose stop api
docker compose exec -T db psql -U puente -d puente -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c backups/puente-AAAAMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U puente -d puente
docker compose start api
```

## 8. Operación diaria

| Tarea              | Comando (en `/opt/puente/deploy`)                 |
| ------------------ | ------------------------------------------------- |
| Estado             | `docker compose ps`                               |
| Logs de la API     | `docker compose logs -f --tail 100 api`           |
| Reiniciar          | `docker compose restart api`                      |
| Retención manual   | `docker compose exec api node dist/retention.js`  |
| Consola de la base | `docker compose exec db psql -U puente -d puente` |

Los logs no contienen mensajes de clientes ni teléfonos. Las alertas de la IA llegan a
`ALERT_EMAIL`.

## 9. Seguridad del servidor

- Acceso SSH solo con llave (`PasswordAuthentication no` en `/etc/ssh/sshd_config`).
- Actualizaciones automáticas de seguridad: `apt install unattended-upgrades`.
- `deploy/.env` con permisos `600`; nunca lo subas al repositorio.
- Si cambias `SESSION_SECRET`, todas las sesiones del panel se cierran (útil ante una filtración).
- Checklist completo: `docs/SECURITY.md`.
