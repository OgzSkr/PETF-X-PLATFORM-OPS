#!/usr/bin/env bash
# Production deploy pipeline — VPS üzerinde çalıştırın
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
BASE_URL="${BASE_URL:-https://api.petfix.com.tr}"

echo "==> 1/8 Image build"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build api

echo "==> 2/8 Tests"
if command -v node >/dev/null 2>&1; then
  npm test
else
  echo "host node yok — testler container içinde çalıştırılıyor"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm --no-deps api node --test test/*.test.js
fi

echo "==> 3/8 Production config validation"
NODE_ENV=production PETFIX_ENV_FILE="$ENV_FILE" node -e "
  import { readEnvFile } from './lib/env.js';
  import { validateProductionConfig } from './lib/production/validate-config.js';
  const env = await readEnvFile('$ENV_FILE');
  validateProductionConfig(env, process.env);
  console.log('config ok');
"

echo "==> 4/8 Migration"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm api node scripts/ops-hub-migrate.js

echo "==> 5/8 Service start/update"
mkdir -p data
# Container petfix uid=100 — host'ta da 100:101 olmalı (VPS'te genelde _apt:input)
chown -R 100:101 data 2>/dev/null || sudo chown -R 100:101 data 2>/dev/null || true
if id -u petfix >/dev/null 2>&1 && [[ "$(stat -c '%u' data 2>/dev/null || echo 0)" != "100" ]]; then
  chown -R 100:101 data 2>/dev/null || sudo chown -R 100:101 data 2>/dev/null || true
fi
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

echo "==> 6/8 Readiness"
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:8787/ready" | grep -q '"status":"ready"'; then
    echo "ready ok"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "readiness failed"
    exit 1
  fi
  sleep 2
done

echo "==> 7/8 Smoke test"
HOST=127.0.0.1 PORT=8787 PETFIX_ENV_FILE="$ENV_FILE" npm run smoke

echo "==> 8/8 External verify (optional)"
if [[ "${SKIP_EXTERNAL_VERIFY:-}" != "1" ]]; then
  npm run ops:verify-deploy -- "$BASE_URL" || {
    echo "External verify failed — DNS/TLS henüz hazır olmayabilir"
    exit 1
  }
fi

echo "Deploy başarılı"
