#!/usr/bin/env bash
# Mac → VPS production deploy
# Kullanım:
#   export VPS_HOST=203.0.113.10
#   export VPS_USER=root          # veya sudo yetkili kullanıcı
#   export VPS_SSH_KEY=~/.ssh/petfix_ops_deploy
#   bash scripts/ops-deploy-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${VPS_HOST:?VPS_HOST gerekli (ör. 203.0.113.10)}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/petfix_ops_deploy}"
APP_DIR="${VPS_APP_DIR:-/opt/petfix/buybox-platform}"
DOMAIN="${OPS_DOMAIN:-api.petfix.com.tr}"

SSH=(ssh -i "$VPS_SSH_KEY" -o StrictHostKeyChecking=accept-new "${VPS_USER}@${VPS_HOST}")
RSYNC=(rsync -az --delete
  -e "ssh -i $VPS_SSH_KEY -o StrictHostKeyChecking=accept-new"
  --exclude .env
  --exclude .git
  --exclude data/buybox-history.jsonl
  --exclude data/db.json
  --exclude bin/cloudflared
  --exclude logs
)

echo "==> VPS bağlantı testi: ${VPS_USER}@${VPS_HOST}"
"${SSH[@]}" 'echo ok && uname -a'

echo "==> Uzak dizin: $APP_DIR"
"${SSH[@]}" "mkdir -p '$APP_DIR'"

if [[ ! -f "$ROOT/.env.production" ]]; then
  echo "==> .env.production yok — prepare-env-production.sh çalıştırılıyor"
  bash "$ROOT/scripts/prepare-env-production.sh"
fi

if [[ ! -f "$ROOT/.env.production" ]]; then
  echo "HATA: .env.production yok — bash scripts/prepare-env-production.sh"
  exit 1
fi

echo "==> Kod senkronu"
"${RSYNC[@]}" "$ROOT/" "${VPS_USER}@${VPS_HOST}:${APP_DIR}/"

echo "==> Production .env doğrulama"
"${SSH[@]}" bash -s <<REMOTE
set -euo pipefail
cd '$APP_DIR'
grep -q '^OPS_PUBLIC_API_BASE_URL=' .env.production
grep -q '^GETIR_WEBHOOK_SECRET=' .env.production
REMOTE

echo "==> VPS kurulum (docker + nginx + certbot)"
"${SSH[@]}" "cd '$APP_DIR' && sudo APP_DIR='$APP_DIR' OPS_DOMAIN='$DOMAIN' bash deploy/vps-setup.sh"

echo "==> Poll timer (systemd)"
"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
cat > /tmp/petfix-ops-poll.service <<'UNIT'
[Unit]
Description=PetFix Ops channel poll
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/petfix/buybox-platform
ExecStart=/usr/bin/docker run --rm --network host -v /opt/petfix/buybox-platform:/app -w /app --env-file /opt/petfix/buybox-platform/.env -e OPS_POSTGRES_URL=postgresql://petfix:petfix@127.0.0.1:5433/petfix_ops node:22-alpine node scripts/ops-hub-poll.js
UNIT
cat > /tmp/petfix-ops-poll.timer <<'UNIT'
[Unit]
Description=PetFix Ops poll every 120s

[Timer]
OnBootSec=60
OnUnitActiveSec=120
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo mv /tmp/petfix-ops-poll.service /etc/systemd/system/
sudo mv /tmp/petfix-ops-poll.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now petfix-ops-poll.timer
REMOTE

echo ""
echo "Deploy tamam."
echo "  Health: https://${DOMAIN}/health"
echo "  Ops:    https://${DOMAIN}/ops/"
echo ""
echo "Sonraki adımlar:"
echo "  1. DNS A kaydı: ${DOMAIN} → ${VPS_HOST}"
echo "  2. npm run ops:verify-deploy -- https://${DOMAIN}"
echo "  3. Getir yeni sipariş: https://${DOMAIN}/webhooks/v1/getir/orders/new"
echo "  4. Getir iptal: https://${DOMAIN}/webhooks/v1/getir/orders/cancelled"
echo "  5. npm run ops:webhook-setup"
