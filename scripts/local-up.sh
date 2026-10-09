#!/usr/bin/env bash
# One command for a laptop: .env, Postgres, migrate, seed, Next.js on :3000
set -euo pipefail
cd "$(dirname "$0")/.."

set_env() {
  local key="$1"
  local value="$2"
  python3 - "$key" "$value" <<'PY'
import sys
from pathlib import Path
key, value = sys.argv[1], sys.argv[2]
path = Path(".env")
text = path.read_text() if path.exists() else ""
lines = text.splitlines()
out, found = [], False
for line in lines:
    if line.startswith(key + "="):
        out.append(f'{key}="{value}"')
        found = True
    else:
        out.append(line)
if not found:
    if out and out[-1] != "":
        out.append("")
    out.append(f'{key}="{value}"')
path.write_text("\n".join(out) + "\n")
PY
}

need_secret() {
  local key="$1"
  local current
  current="$(python3 - "$key" <<'PY'
import sys
from pathlib import Path
key = sys.argv[1]
for line in Path(".env").read_text().splitlines() if Path(".env").exists() else []:
    if line.startswith(key + "="):
        print(line.split("=", 1)[1].strip().strip('"').strip("'"))
        break
PY
)"
  if [[ ${#current} -lt 32 ]]; then
    local gen
    gen="$(openssl rand -base64 48 | tr -d '\n')"
    set_env "$key" "$gen"
  fi
}

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

need_secret AUTH_SECRET
need_secret ENCRYPTION_KEY
set_env WHATSAPP_DRIVER mock
set_env FORCE_OPEN true
set_env APP_URL "http://localhost:3000"
if ! grep -qE '^DATABASE_URL=' .env; then
  set_env DATABASE_URL "postgresql://machachos:machachos@localhost:5432/machachos?schema=public"
fi

if [[ ! -d node_modules ]]; then
  echo "Installing npm packages…"
  npm install
fi

wait_pg() {
  for _ in $(seq 1 40); do
    if python3 - <<'PY' >/dev/null 2>&1
import socket
s = socket.create_connection(("127.0.0.1", 5432), 1)
s.close()
PY
    then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_postgres() {
  if wait_pg; then
    echo "Postgres is already running."
    return 0
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "Starting Postgres with Docker…"
    docker compose up -d
    wait_pg && return 0
  fi

  if command -v brew >/dev/null 2>&1 && brew services list 2>/dev/null | grep -q postgres; then
    brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
    wait_pg && return 0
  fi

  echo "Postgres is not running on localhost:5432."
  echo "Start Docker Desktop and rerun, or install Postgres and set DATABASE_URL in .env."
  exit 1
}

start_postgres

echo "Applying migrations and seeding the Potch menu…"
npx prisma migrate deploy
npx prisma db seed

echo
echo "Mochachos is starting at http://localhost:3000"
echo "  Customer chat (this is you on WhatsApp):  http://localhost:3000/playground"
echo "  Kitchen screen (PIN 1234):                http://localhost:3000/kitchen"
echo
exec npx next dev --hostname 0.0.0.0 --port 3000
