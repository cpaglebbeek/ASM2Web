#!/usr/bin/env bash
# Deploy ASM2Web naar HorseCloud55.
# Idempotent. Self-healing (verifieert na deploy dat eigen location block aanwezig is).
# Respecteert SHARED_INFRASTRUCTURE.md: nooit andere snippets aanraken.

set -euo pipefail

SSH_HOST="${ASM2WEB_SSH_HOST:-horsecloud55}"
REMOTE_ROOT="/var/www/asm2web"
REMOTE_WEB="$REMOTE_ROOT/web"
SNIPPET_REMOTE="/etc/nginx/snippets/asm2web-locations.conf"
HORSECLOUD_CONF="/etc/nginx/sites-enabled/horsecloud"
INCLUDE_LINE="    include /etc/nginx/snippets/asm2web-locations.conf;"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_WEB="$REPO_DIR/web"
LOCAL_SNIPPET="$REPO_DIR/deploy/asm2web-locations.conf"

echo "[1/7] Verifieer lokale bron"
test -d "$LOCAL_WEB"     || { echo "FAIL: $LOCAL_WEB ontbreekt"; exit 1; }
test -f "$LOCAL_SNIPPET" || { echo "FAIL: $LOCAL_SNIPPET ontbreekt"; exit 1; }
test -f "$LOCAL_WEB/index.html"               || { echo "FAIL: web/index.html ontbreekt"; exit 1; }
test -f "$LOCAL_WEB/architecture/index.html"  || { echo "FAIL: web/architecture/index.html ontbreekt"; exit 1; }

echo "[2/7] Maak remote directories"
ssh "$SSH_HOST" "sudo mkdir -p '$REMOTE_WEB' && sudo chown -R www-data:www-data '$REMOTE_ROOT'"

echo "[3/7] Rsync web/ -> $SSH_HOST:$REMOTE_WEB/"
rsync -av --delete \
  --exclude='.DS_Store' \
  -e "ssh" \
  "$LOCAL_WEB/" "$SSH_HOST:/tmp/asm2web-staging/"
ssh "$SSH_HOST" "sudo rsync -av --delete /tmp/asm2web-staging/ '$REMOTE_WEB/' && sudo chown -R www-data:www-data '$REMOTE_ROOT' && rm -rf /tmp/asm2web-staging"

echo "[4/7] Plaats nginx snippet"
scp "$LOCAL_SNIPPET" "$SSH_HOST:/tmp/asm2web-locations.conf"
ssh "$SSH_HOST" "sudo mv /tmp/asm2web-locations.conf '$SNIPPET_REMOTE' && sudo chown root:root '$SNIPPET_REMOTE' && sudo chmod 644 '$SNIPPET_REMOTE'"

echo "[5/7] Include in horsecloud-config (idempotent)"
ssh "$SSH_HOST" "if ! sudo grep -qF 'asm2web-locations.conf' '$HORSECLOUD_CONF'; then \
    sudo cp '$HORSECLOUD_CONF' '$HORSECLOUD_CONF.bak.\$(date +%s)'; \
    sudo sed -i '/include \\/etc\\/nginx\\/snippets\\/llmshapes-locations\\.conf;/a\\
$INCLUDE_LINE' '$HORSECLOUD_CONF'; \
    echo '   -> include toegevoegd'; \
  else \
    echo '   -> include reeds aanwezig'; \
  fi"

echo "[6/7] Nginx config-test"
ssh "$SSH_HOST" "sudo nginx -t"
ssh "$SSH_HOST" "sudo systemctl reload nginx"

echo "[7/7] Smoke-test"
sleep 1
HTTP_HOME=$(ssh "$SSH_HOST" "curl -s -o /dev/null -w '%{http_code}' https://horsecloud55.ddns.net/ASM2Web/ -k -L")
HTTP_ARCH=$(ssh "$SSH_HOST" "curl -s -o /dev/null -w '%{http_code}' https://horsecloud55.ddns.net/ASM2Web/architecture/ -k -L")
HTTP_JSON=$(ssh "$SSH_HOST" "curl -s -o /dev/null -w '%{http_code}' https://horsecloud55.ddns.net/ASM2Web/modules.json -k")
echo "   /ASM2Web/                 -> $HTTP_HOME"
echo "   /ASM2Web/architecture/    -> $HTTP_ARCH"
echo "   /ASM2Web/modules.json     -> $HTTP_JSON"

# Self-healing check: alle gedeelde location blocks intact?
echo
echo "Self-healing check (top-level locations in $HORSECLOUD_CONF):"
ssh "$SSH_HOST" "sudo grep -nE 'include /etc/nginx/snippets/|location /[A-Za-z]' '$HORSECLOUD_CONF' | head -30"

echo
echo "DONE. Live op: https://horsecloud55.ddns.net/ASM2Web/"
