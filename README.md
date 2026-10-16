# Oyaya Flour Factory ERP

Enterprise resource planning for Oyaya Flour Production Company PLC — wheat intake,
conditioning, milling, QC, finished goods, sales, Peachtree-style finance, tri-mode
payroll, fleet, and biometric attendance in one offline-capable system.

## Architecture

- **Web**: React PWA (installable, offline-first) in `packages/web`
- **API**: Node 20 / Express / TypeScript in `packages/api`
- **Database**: PostgreSQL 16 (Prisma ORM)
- **Queues**: Redis + BullMQ (SMS delivery, alerts, ZKTeco polling)
- **Attendance**: ZKTeco devices via ADMS push (`/iclock`) and TCP 4370 polling
- **SMS**: AfroMessage HTTP API (queued, retried, delivery-status webhook)

## Prerequisites

- Node 20
- Docker & Docker Compose
- Ports 8902 (API) and 8903 (web) free

## Quickstart

```bash
cp .env.example .env     # then edit secrets (JWT_SECRET, DATABASE_URL, AFROMESSAGE_*)
docker compose up --build
```

API-only (without Docker):

```bash
cd packages/api
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
```

## Run natively on this machine (no Docker)

PostgreSQL 16 and Redis 7 are installed natively. Services:

```bash
pg_ctlcluster 16 main start
redis-server --daemonize yes
```

Boot the stack:

```bash
cd ~/workspace/oyaya-erp
# .env is already configured (mode 600). First boot only:
cd packages/api
export $(grep -E "^DATABASE_URL" ../../.env | xargs)
npx prisma migrate deploy
npm run prisma:seed          # 13 roles, 60 permissions, QC thresholds, tanks, products, chart of accounts
npm run build
node dist/index.js  &        # API → http://localhost:8902 (health: /api/v1/health)
node dist/worker.js &        # BullMQ worker (SMS, lab-overdue, pest follow-ups, ZKTeco poller)
cd ../web && npm run dev -- --port 8903 --host 127.0.0.1   # PWA → http://localhost:8903
```

Demo logins (seeded): `ceo@oyaya.local` / `ChangeMe123!` (Owner/CEO, full access),
`admin@oyaya.local` / `ChangeMe123!` (System Administrator, config only).
Change both passwords before any real use.

A database snapshot lives in `backups/oyaya_erp-live-20261016.dump`
(restore: `pg_restore --clean --if-exists -h localhost -U oyaya -d oyaya_erp <file>`).
Automated daily dumps: `infra/backup/pg_dump.sh` (cron on the factory server).

## API overview

Base path: `/api/v1`. All routes require JWT auth unless marked public.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/sms/logs?status&from&to` | `sms:view` | SMS log, newest first (max 100) |
| POST | `/webhooks/afromessage/status` | public | AfroMessage delivery-status callback |
| GET | `/attendance/punches?zkPin&from&to` | `attendance:view` | Raw punches, newest first (max 200) |
| GET | `/attendance/daily?date=YYYY-MM-DD` | `attendance:view` | Per-employee check-in / check-out / hours |
| POST | `/sync/batch` | device token | Offline outbox ingest (see below) |
| — | `/api/v1/<module>` | per-module permission | Each business module (master, procurement, storage, production, qc, capa, hygiene, pest, maintenance, fg, warehouse, sales, finance, payroll, fleet, dashboard) exposes its resources under its own path |

ZKTeco ADMS endpoints (no auth, plain-text protocol, behind the `/iclock` proxy):

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/iclock/cdata` | Device handshake; `?options=all` returns ATTLOG pull config |
| POST | `/iclock/cdata` | ATTLOG push — newline/tab-separated punch lines |
| GET | `/iclock/getrequest` | Command poll (always `OK`) |
| POST | `/iclock/devicecmd` | Command result (always `OK`) |

## ZKTeco device setup

1. On the device, set **Cloud Server / ADMS** to `http://SERVER-IP/iclock`
   (or `https://erp.oyayaflour.com/iclock` in production).
2. Enable ADMS push. The device POSTs attendance lines to `/iclock/cdata?SN=<serial>&table=ATTLOG`.
3. For devices reachable on the LAN, set their IP in the device record; the TCP 4370
   poller (`pollDevices`) pulls logs every `ZK_POLL_INTERVAL_MIN` minutes (default 5).
4. Each device PIN must be registered as `Employee.zkPin` to link punches to employees.

## AfroMessage SMS config

Set in `.env`:

| Variable | Description |
|----------|-------------|
| `AFROMESSAGE_API_TOKEN` | API token from the AfroMessage dashboard |
| `AFROMESSAGE_IDENTIFIER_ID` | Identifier (account) ID |
| `AFROMESSAGE_SENDER_ID` | Sender name (default `OYAYA_MILL`) |
| `AFROMESSAGE_CALLBACK_URL` | Public URL of `/api/v1/webhooks/afromessage/status` |

Messages are queued (`queueSms` / `queueBulkSms`) and delivered by BullMQ workers
with 3 attempts and exponential backoff. Delivery statuses (`delivered`, `failed`,
`undelivered`, `rejected`, `sent`, `submitted`) arrive via the public webhook and
update `SmsLog.status`.

## Offline sync protocol

Devices work offline and flush an outbox on reconnect:

1. Every local change is stored with a **UUIDv7** client UUID in the device outbox.
2. The device POSTs the batch to `/api/v1/sync/batch` in **topological order**
   (parents before children, e.g. intake before lab check).
3. The server records each client UUID in `IdempotencyLedger` — replays are ignored,
   so retries are safe.
4. Conflicts resolve server-side; the device applies the returned resolutions.

## RBAC roles (13)

1. Owner / CEO — full access
2. System Administrator — master data + dashboard
3. Quality / Lab Head — procurement approve, QC/CAPA, hygiene/pest, traceability
4. Lab Technician — QC entry, intake, production view
5. Production Manager — production, storage, maintenance, FG, warehouse
6. Machine & Washing Operators — production execution, storage
7. Storekeeper (Raw & FG) — procurement, FG, warehouse, sales
8. Sanitation Supervisor & Pest Inspector — hygiene, pest, maintenance
9. Sales & Distribution Officer — sales, warehouse, fleet
10. Finance & Accounting Officer — finance, payroll view
11. HR & Payroll Officer — payroll, attendance view
12. Security / Gate Officer — attendance view, gate-level visibility
13. Drivers & Floor Laborers — attendance, payroll view

Permissions are stored as `module:action:scope` claims (scope `all` by default).

## Repo structure

```
oyaya-erp/
├── docker-compose.yml
├── .env.example
├── README.md
├── infra/
│   └── nginx/
│       └── nginx.conf
└── packages/
    ├── api/
    │   ├── prisma/
    │   │   ├── schema.prisma
    │   │   └── seed.ts
    │   └── src/
    │       ├── app.ts
    │       ├── config.ts
    │       ├── lib/            # prisma, audit, queues, redis, permissions
    │       ├── middleware/     # rbac, validate, errorHandler
    │       ├── types/
    │       └── modules/
    │           ├── sms/        # router.ts, service.ts
    │           └── zkteco/     # adms.ts, service.ts, poller.ts, router.ts
    └── web/                    # React PWA
```

## Notes

- JWT tokens expire after 8 hours (`JWT_EXPIRES_IN`).
- Default login after seeding: `admin@oyaya.local` / `ChangeMe123!` — change the
  password immediately after first login.
- Free-text notes in this repo avoid emojis by convention.
