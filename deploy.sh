#!/usr/bin/env bash
# Oyaya ERP — factory server deployment (one command).
# Usage: sudo ./deploy.sh [domain]
#   domain defaults to erp.oyayaflour.com
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:-erp.oyayaflour.com}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 is required" >&2; exit 1; }; }
need docker
docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose plugin is required" >&2; exit 1; }

# ── 1. Environment & secrets ──────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  DB_PASS="$(openssl rand -hex 16)"
  JWT="$(openssl rand -hex 32)"
  sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DB_PASS/" .env
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT/" .env
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://oyaya:$DB_PASS@postgres:5432/oyaya_erp|" .env
  sed -i "s|^AFROMESSAGE_CALLBACK_URL=.*|AFROMESSAGE_CALLBACK_URL=https://$DOMAIN/api/v1/webhooks/afromessage/status|" .env
  chmod 600 .env
  echo "generated .env with fresh secrets"
else
  echo ".env exists — keeping current secrets"
fi

# ── 2. TLS certificate (self-signed bootstrap; replace with Let's Encrypt) ──
mkdir -p certs
if [ ! -f "certs/$DOMAIN.crt" ]; then
  openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes \
    -keyout "certs/$DOMAIN.key" -out "certs/$DOMAIN.crt" \
    -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" 2>/dev/null
  chmod 600 "certs/$DOMAIN.key"
  echo "self-signed TLS certificate created for $DOMAIN"
  echo "NOTE: replace with a Let's Encrypt certificate for public trust (see infra/ops.md)"
fi
# nginx.conf expects these exact filenames
[ -f certs/erp.oyayaflour.com.crt ] || { cp "certs/$DOMAIN.crt" certs/erp.oyayaflour.com.crt; cp "certs/$DOMAIN.key" certs/erp.oyayaflour.com.key; }

# ── 3. Build & start ──────────────────────────────────────────────
docker compose build
docker compose up -d

# ── 4. Seed (only on a fresh database) ────────────────────────────
echo "waiting for API health..."
for i in $(seq 1 30); do
  if docker compose exec -T api wget -q -O /dev/null http://127.0.0.1:8902/api/v1/health 2>/dev/null; then
    break
  fi
  sleep 5
done
USERS=$(docker compose exec -T postgres psql -U "${DB_USER:-oyaya}" -d "${DB_NAME:-oyaya_erp}" -tAc 'SELECT count(*) FROM "User";' | tr -d '\r')
if [ "$USERS" = "0" ]; then
  docker compose exec -T api npm run prisma:seed
  echo "database seeded (roles, thresholds, tanks, products, chart of accounts, admin user)"
else
  echo "database already has $USERS user(s) — skipping seed"
fi

# ── 5. Report ─────────────────────────────────────────────────────
echo
echo "Oyaya ERP is live:"
echo "  Web (LAN):      http://<server-ip>/"
echo "  Web (TLS):      https://$DOMAIN/"
echo "  API health:     http://<server-ip>/api/v1/health"
echo "  ZKTeco ADMS:    point terminals at http://<server-ip>/iclock"
echo "  Backups:        automated every ${BACKUP_INTERVAL_HOURS:-24}h → docker volume pgbackups"
echo
echo "Demo logins: ceo@oyaya.local / admin@oyaya.local  (password: ChangeMe123! — change immediately)"
echo "Next: set AFROMESSAGE_* in .env and run: docker compose up -d api worker"
