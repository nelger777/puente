#!/bin/sh
# End-to-end check of a running Puente (staging, production or local test):
#   sh deploy/smoke.sh <BASE_URL> [PUBLIC_KEY SITE_ORIGIN [ADMIN_EMAIL ADMIN_PASSWORD]]
# Example:
#   sh deploy/smoke.sh https://puente.tudominio.com pk_xxx https://tienda.com admin@tienda.com 'clave'
# Uses only curl. It creates a real test handoff when PUBLIC_KEY is given.
set -eu

BASE="${1:?Uso: smoke.sh BASE_URL [PUBLIC_KEY SITE_ORIGIN [ADMIN_EMAIL ADMIN_PASSWORD]]}"
KEY="${2:-}"
SITE="${3:-}"
EMAIL="${4:-}"
PASSWORD="${5:-}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

ok() { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "Puente en $BASE"

check "API viva (/health)" '[ "$(status "$BASE/health")" = 200 ]'

curl -s -D "$TMP/panel.h" -o "$TMP/panel.html" "$BASE/"
check "panel servido" 'grep -q "<div id=\"root\">" "$TMP/panel.html"'
check "panel con CSP y sin iframes" 'grep -qi "content-security-policy" "$TMP/panel.h" && grep -qi "x-frame-options: DENY" "$TMP/panel.h"'
check "ruta del panel (SPA) responde" '[ "$(status "$BASE/derivaciones")" = 200 ]'

curl -s -D "$TMP/widget.h" -o "$TMP/v1.js" "$BASE/widget/v1.js"
check "widget v1.js servido" '[ -s "$TMP/v1.js" ] && grep -qi "content-type: .*javascript" "$TMP/widget.h"'
check "widget con caché de 1 hora" 'grep -qi "cache-control: .*max-age=3600" "$TMP/widget.h"'
pinned="$(curl -s "$BASE/widget/manifest.json" | sed -n 's/.*"pinned": *"\([^"]*\)".*/\1/p')"
check "copia fija del widget inmutable" '[ -n "$pinned" ] && curl -s -D - -o /dev/null "$BASE/widget/$pinned" | grep -qi "immutable"'

if [ -n "$KEY" ] && [ -n "$SITE" ]; then
  check "config del widget para $SITE" '[ "$(status -H "Origin: $SITE" "$BASE/v1/widget/config?key=$KEY")" = 200 ]'
  check "origen no autorizado rechazado" '[ "$(status -H "Origin: https://sitio-no-autorizado.example" "$BASE/v1/widget/config?key=$KEY")" = 403 ]'
  curl -s -H "Origin: $SITE" -H "content-type: application/json" \
    -d "{\"key\":\"$KEY\",\"visitorId\":\"v_smoke\",\"message\":\"Prueba de despliegue: quiero hablar con una persona\"}" \
    "$BASE/v1/chat" > "$TMP/chat.json"
  code="$(sed -n 's/.*"code":"\(DER-[0-9]*\)".*/\1/p' "$TMP/chat.json")"
  check "chat deriva con enlace de WhatsApp ($code)" '[ -n "$code" ] && grep -q "https://wa.me/" "$TMP/chat.json"'

  if [ -n "$EMAIL" ] && [ -n "$PASSWORD" ]; then
    printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD" > "$TMP/login.json"
    check "login del panel" '[ "$(status -c "$TMP/cookies" -H "Origin: $BASE" -H "content-type: application/json" --data-binary @"$TMP/login.json" "$BASE/v1/auth/login")" = 200 ]'
    check "la derivación aparece en el panel" 'curl -s -b "$TMP/cookies" "$BASE/v1/admin/handoffs?status=PENDING" | grep -q "$code"'
  fi
fi

if [ "$fails" -gt 0 ]; then
  echo "$fails verificaciones fallaron."
  exit 1
fi
echo "Todo en orden."
