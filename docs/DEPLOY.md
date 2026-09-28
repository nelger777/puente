# Despliegue de Puente

Puente corre con Docker en **un solo servidor**, en tres contenedores:

| Servicio             | Qué hace                                                                           | Expuesto                                                                 |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `web` (Caddy)        | Sirve el panel en `/`, el widget en `/widget/` y reenvía `/v1` a la API            | Solo `127.0.0.1:8090` (servidor compartido) o 80/443 (servidor dedicado) |
| `api` (Node 24)      | API y motor del asistente; aplica las migraciones al arrancar; retención y alertas | No                                                                       |
| `db` (PostgreSQL 17) | Datos de Puente (base propia)                                                      | No                                                                       |

Las imágenes las construye y publica **GitHub Actions** en `ghcr.io/nelger777/puente-api` y
`puente-web` cada vez que `main` pasa todas las pruebas. **El servidor no compila nada**: solo
descarga imágenes. Uso de memoria medido: ~140 MB (límites: 256 + 384 + 96 MB).

Los comercios instalan el asistente con una línea (el panel la muestra en **Instalación**):

```html
<script src="https://puente.tudominio.com/widget/v1.js" data-key="pk_..." async></script>
```

---

## A. Servidor compartido con otros proyectos (Caddy del sistema en 80/443)

Es el caso de un VPS donde ya hay un Caddy (u otro proxy) atendiendo otros sitios. Puente **no
toca** los puertos 80/443, el firewall ni los paquetes del sistema: escucha en `127.0.0.1:8090` y
el Caddy existente le reenvía el subdominio (y emite su certificado, como para los demás sitios).

### A1. Código y configuración

```sh
mkdir -p /opt/puente && cd /opt/puente
git clone https://github.com/nelger777/puente.git .
cd deploy
cp .env.example .env && chmod 600 .env
nano .env
```

| Variable                                  | Valor                                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                              | `https://puente.tudominio.com`                                                                                                                                                |
| `SITE_ADDRESS`, `HTTP_BIND`, `HTTPS_BIND` | Dejar como en el ejemplo (`:80`, `127.0.0.1:8090`, `127.0.0.1:8453`). Si 8090 estuviera ocupado, usa otro puerto libre (`ss -tln`) y cámbialo también en el Caddy del sistema |
| `POSTGRES_PASSWORD`, `SESSION_SECRET`     | `openssl rand -hex 32` (uno distinto para cada una)                                                                                                                        |
| `ANTHROPIC_API_KEY`                       | Clave de la consola de Anthropic                                                                                                                                              |
| `SMTP_URL`, `MAIL_FROM`                   | Proveedor SMTP (Brevo, Amazon SES, Resend, Mailgun); remitente de un dominio verificado                                                                                       |
| `ALERT_EMAIL`                             | Tu correo: alerta si la IA falla más del 5 % en una hora                                                                                                                      |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Admin del primer negocio (contraseña de 12+ caracteres)                                                                                                                       |

### A2. DNS

Registro **A** `puente` → IP del servidor. Comprueba con `dig +short puente.tudominio.com`.

### A3. Levantar Puente

```sh
cd /opt/puente && sh deploy/deploy.sh
curl -s http://127.0.0.1:8090/health     # {"status":"ok"}
```

### A4. Publicarlo en el Caddy del sistema

Agrega este bloque al Caddyfile del sistema (normalmente `/etc/caddy/Caddyfile`), **sin tocar los
bloques de los otros sitios**:

```caddyfile
puente.tudominio.com {
	reverse_proxy 127.0.0.1:8090
}
```

Valida y recarga (la recarga es en caliente: los otros sitios no se interrumpen):

```sh
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
```

Si `validate` da error, no recargues: restaura la copia (`cp /etc/caddy/Caddyfile.bak-... /etc/caddy/Caddyfile`).

---

## B. Servidor dedicado a Puente

En `deploy/.env`: `SITE_ADDRESS=puente.tudominio.com`, `HTTP_BIND=80`, `HTTPS_BIND=443`. El Caddy
de Puente obtiene el certificado solo. Abre 80/443 en el firewall y ejecuta `sh deploy/deploy.sh`.

---

## Negocio de prueba (staging)

```sh
cd /opt/puente/deploy
docker compose exec api node dist/seed.js
```

Crea "Óptica Mirador" con 5 preguntas y el admin de `SEED_ADMIN_EMAIL`, y muestra la **clave
pública** (`pk_...`). Luego:

1. Entra a `https://puente.tudominio.com` con ese admin.
2. **Configuración** → _Dominios autorizados_: agrega `puente.tudominio.com` (página de prueba) y
   el dominio donde lo vas a instalar. Cambia WhatsApp y correo de avisos por los tuyos.
3. **Probar**: conversa con el asistente (IA real).
4. Página de prueba con el widget real:
   `https://puente.tudominio.com/demo/?bundle=1&src=/widget/v1.js&key=pk_...`
5. Verificación automática (crea una derivación de prueba):

```sh
sh deploy/smoke.sh https://puente.tudominio.com pk_... https://puente.tudominio.com admin@... 'contraseña'
```

## Actualizar y volver atrás

```sh
cd /opt/puente && sh deploy/deploy.sh
```

Descarga las imágenes nuevas, reinicia solo los contenedores de Puente y espera a que estén sanos.
Las migraciones se aplican solas. El widget nuevo llega a los comercios en menos de una hora.

**Volver a una versión anterior:** en `deploy/.env` pon `PUENTE_VERSION=<sha>` (el SHA completo
de un commit de `main`, `git log --format='%H %s'`) y ejecuta `sh deploy/deploy.sh`. Vuelve a
`latest` para seguir recibiendo actualizaciones. Si la versión es anterior a una migración,
restaura también el respaldo previo.

Limpiar imágenes viejas **de Puente** (nunca afecta a otros proyectos):

```sh
docker image ls 'ghcr.io/nelger777/puente-*'
docker image rm <IMAGE ID de las que ya no se usan>
```

## Respaldos

```sh
crontab -e
30 3 * * * cd /opt/puente && sh deploy/backup.sh >> deploy/backup.log 2>&1
```

Volcado diario comprimido en `deploy/backups/` (14 días). **Copia los respaldos fuera del
servidor.** Restaurar (reemplaza los datos actuales):

```sh
cd /opt/puente/deploy
docker compose stop api
docker compose exec -T db psql -U puente -d puente -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c backups/puente-AAAAMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U puente -d puente
docker compose start api
```

## Operación diaria

| Tarea              | Comando (en `/opt/puente/deploy`)                 |
| ------------------ | ------------------------------------------------- |
| Estado             | `docker compose ps`                               |
| Logs de la API     | `docker compose logs -f --tail 100 api`           |
| Memoria            | `docker stats --no-stream`                        |
| Reiniciar la API   | `docker compose restart api`                      |
| Retención manual   | `docker compose exec api node dist/retention.js`  |
| Consola de la base | `docker compose exec db psql -U puente -d puente` |

Los logs no contienen mensajes de clientes ni teléfonos. Las alertas de la IA llegan a
`ALERT_EMAIL`. Checklist de seguridad: `docs/SECURITY.md`.
