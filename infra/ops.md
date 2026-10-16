# Oyaya ERP — Factory Server Operations

Target: a single on-premise server at the flour mill (Ubuntu 24.04 LTS),
running the full stack from the SRS: Docker & Docker Compose, Nginx with
TLS 1.3, PostgreSQL 16, Redis 7, automated pg_dump backups, and encrypted
cloud replication.

## 1. Install

```bash
# Docker (https://docs.docker.com/engine/install/ubuntu/)
# then:
git clone <repo> /opt/oyaya-erp && cd /opt/oyaya-erp
cp .env.example .env   # fill in: DB_PASSWORD, JWT_SECRET, AFROMESSAGE_*
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run prisma:seed
```

## 2. TLS 1.3 (Nginx)

- Point DNS for `erp.oyayaflour.com` at the server.
- Issue a certificate (Let's Encrypt):
  `certbot certonly --standalone -d erp.oyayaflour.com`
- Uncomment the 443 server block in `infra/nginx/nginx.conf` and set
  `ssl_certificate` / `ssl_certificate_key` to the cert paths.
- The ZKTeco terminals are configured with this domain under
  Cloud Server (ADMS) settings; AfroMessage delivery callbacks also
  target `https://erp.oyayaflour.com/api/v1/webhooks/afromessage/status`.

## 3. Automated pg_dump backups

```bash
sudo mkdir -p /var/backups/oyaya-erp
# /opt/oyaya-erp/.env holds PGPASSWORD (mode 600, never committed)
(crontab -l; echo "0 2 * * * PGPASSWORD=\$(grep PGPASSWORD /opt/oyaya-erp/.env | cut -d= -f2) /opt/oyaya-erp/infra/backup/pg_dump.sh >> /var/log/oyaya-backup.log 2>&1") | crontab -
```

- Default retention: 14 daily dumps in `/var/backups/oyaya-erp`.
- Test restores quarterly on a staging database (procedure is in the script header).

## 4. Encrypted cloud replication

Two supported options (configure one before go-live):

**A. WAL-G continuous archiving (recommended)** — encrypted, compressed
WAL + base backups to S3-compatible storage:

```bash
# on the postgres host: install wal-g, then
export WALG_S3_PREFIX=s3://oyaya-erp-backups/wal
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
export WALG_COMPRESSION_METHOD=brotli
# postgresql.conf:
#   archive_mode = on
#   archive_command = 'wal-g wal-push %p'
#   archive_timeout = 60
wal-g backup-push /var/lib/postgresql/data   # initial base backup
```

All archives are encrypted with a GPG key held by Oyaya IT; the cloud
bucket alone is useless without it.

**B. Hot standby replica** — a second Postgres 16 on the cloud node
streaming from the factory server over TLS (`sslmode=verify-full`),
promoted manually if the factory server fails.

## 5. Day-2 notes

- Services sleep nothing: Compose `restart: unless-stopped` is set on all
  services (add it if you extend the file).
- Redis persistence: AOF is enabled in the compose file; BullMQ SMS jobs
  survive restarts.
- Watch disk space: pg dumps + WAL archives; alert at 80%.
- ZKTeco terminals buffer 100,000 punches locally — a LAN outage loses
  nothing; the 4370 poller reconciles on recovery.
