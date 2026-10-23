#!/usr/bin/env bash
# One-command local boot: .env, Postgres, migrate, seed, Next.js on :3000
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need_secret() {
  local key="$1"
  local current
  current="$(grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
  if [[ ${#current} -lt 32 ]]; then
    local gen
    gen="$(openssl rand -base64 48 | tr -d '\n')"
    if grep -qE "^${key}=" .env; then
      sed -i.bak "s|^${key}=.*|${key}=\"${gen}\"|" .env && rm -f .env.bak
    else
      printf '\n%s="%s"\n' "$key" "$gen" >> .env
    fi
  fi
}

if [[ ! -f .env ]]; then
  cp .env.example .env
fi
need_secret AUTH_SECRET
need_secret ENCRYPTION_KEY

# Local boot stays on mock so seed and inbox work without Meta.
if grep -qE '^WHATSAPP_DRIVER=' .env; then
  sed -i.bak 's|^WHATSAPP_DRIVER=.*|WHATSAPP_DRIVER="mock"|' .env && rm -f .env.bak
else
  printf '\nWHATSAPP_DRIVER="mock"\n' >> .env
fi
if ! grep -qE '^APP_URL=' .env; then
  printf 'APP_URL="http://localhost:3000"\n' >> .env
fi

if [[ ! -d node_modules ]]; then
  npm install
fi

wait_pg() {
  for _ in $(seq 1 40); do
    if PGPASSWORD=autoquote psql -h localhost -U autoquote -d autoquote -c 'select 1' >/dev/null 2>&1; then
      return 0
    fi
    if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! wait_pg; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker compose up -d
    wait_pg || { echo "Postgres did not become ready on localhost:5432"; exit 1; }
  elif command -v pg_ctlcluster >/dev/null 2>&1; then
    sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true
    sudo -u postgres psql -c "CREATE USER autoquote WITH PASSWORD 'autoquote' SUPERUSER;" >/dev/null 2>&1 || true
    sudo -u postgres psql -c "CREATE DATABASE autoquote OWNER autoquote;" >/dev/null 2>&1 || true
    wait_pg || { echo "Postgres did not become ready on localhost:5432"; exit 1; }
  else
    echo "Postgres is not running. Start Docker Desktop and rerun, or install Postgres."
    exit 1
  fi
fi

npx prisma migrate deploy
WHATSAPP_DRIVER=mock npm run db:seed

if curl -sf -o /dev/null --connect-timeout 1 http://127.0.0.1:3000/login; then
  echo "AutoQuote is already running at http://localhost:3000"
  echo "  admin@elitecarspares.test / Password123!"
  exit 0
fi

echo "Starting AutoQuote at http://localhost:3000"
echo "  admin@elitecarspares.test / Password123!"
exec npx next dev --hostname 0.0.0.0 --port 3000
