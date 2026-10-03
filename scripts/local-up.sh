#!/usr/bin/env bash
# Bring up Postgres, apply migrations, seed the Potch menu, and start the app.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
  # Local default is the mock WhatsApp driver so the kitchen can be tried
  # before a Meta token exists. Switch WHATSAPP_DRIVER to cloud to go live.
  if grep -q 'WHATSAPP_DRIVER="cloud"' .env; then
    sed -i 's/WHATSAPP_DRIVER="cloud"/WHATSAPP_DRIVER="mock"/' .env
  fi
  echo "Created .env. Kitchen PIN defaults to 1234. Set WHATSAPP_* before connecting Meta."
fi

if command -v docker >/dev/null 2>&1; then
  docker compose up -d
  echo "Waiting for Postgres..."
  for _ in $(seq 1 40); do
    if docker compose exec -T db pg_isready -U machachos >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

npx prisma migrate deploy
npx prisma db seed
exec npm run dev
