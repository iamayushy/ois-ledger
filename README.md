# Order & Inventory Reservation Service (OIS)

A single service on PostgreSQL that reserves limited stock **all-or-nothing**. It is safe under **concurrent buyers** and **client retries**, and comes with an operator console for investigating orders and inventory.

- **API:** Fastify 5 + TypeBox (`apps/api`), port `3001`. Swagger UI is at `/docs`.
- **Operator UI:** React 19 + Vite + SWR (`apps/web`), port `5173`.
- **Database:** PostgreSQL 16 through Drizzle ORM (`packages/db`), with SQL migrations and a synthetic seed.
- **Shared code:** TypeBox schemas, numeric error codes, canonical request hashing and UUIDv7 (`packages/shared`).
- **Edge proxy:** a Cloudflare Worker (`apps/api-proxy`) that serves the API on its own domain.

**Live:** operator UI at https://order.atlair.cloud · API at https://ois.atlair.cloud (Swagger: https://ois.atlair.cloud/docs). The Cloud Run origin only accepts requests that come through the proxy.

---

## 1. Run it

Prerequisites: Node ≥ 22, pnpm ≥ 10, Docker.

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- `docker compose up -d` starts PostgreSQL 16 on :5439 and creates both the `ois` and `ois_test` databases.
- `pnpm db:migrate` applies the migrations to `DATABASE_URL`.
- `pnpm db:seed` loads synthetic products and sample orders. It does nothing if products already exist.
- `pnpm dev` starts the API on :3001 and the UI on :5173.

Open http://localhost:5173 for the operator console and http://localhost:3001/docs for the API explorer.

| Command | Purpose |
|---|---|
| `pnpm db:reset` | Truncate all tables and re-seed |
| `pnpm typecheck` | Strict TypeScript check across all workspaces |
| `pnpm test` | Unit, contract and real-PostgreSQL concurrency tests (uses `TEST_DATABASE_URL`, which must end in `_test`) |

### Run the API in Docker

```bash
docker compose --profile app up -d --build
docker compose --profile app run --rm migrate node dist/seed.mjs
```

The first command builds the image, runs migrations as a one-shot `migrate` service, and then starts `api` on :3001. Set `API_HOST_PORT=3012` if `pnpm dev` is already using port 3001. The second command seeds the database; it does nothing if products already exist. Plain `docker compose up -d` still starts Postgres only.

The root `Dockerfile` builds the API in several stages on `node:24-alpine`. It uses only classic Docker builder features, so it also builds on Cloud Build's `gcr.io/cloud-builders/docker` without BuildKit:

| Stage | Contents |
|---|---|
| `base` | Corepack activates the pnpm version pinned in `packageManager`. Only package manifests are copied before `pnpm install --frozen-lockfile --filter @ois/api...`, so the install layer is rebuilt only when a manifest or the lockfile changes. |
| `build` | `typecheck`, then the `bundle` script. esbuild compiles `@ois/shared` and `@ois/db` into `dist/server.mjs`, `dist/migrate.mjs` and `dist/seed.mjs`. npm packages stay external. |
| `prod-deps` | A separate `pnpm install --prod --frozen-lockfile --offline --filter @ois/api`, reusing the pnpm store from `base`. Versions come exactly from the lockfile, and no web or dev packages are installed. The bundles import `@sinclair/typebox`, `uuid` and `dotenv` directly, so `@ois/api` declares them as its own dependencies. |
| `runtime` | `node:24-alpine` plus `tini` as PID 1. Runs as the non-root `node` user, has no npm, Corepack, Yarn or pnpm, and has a `HEALTHCHECK` on `/api/health`. The bundles, `node_modules` and SQL migrations are copied in. |

Build the image on its own with `docker build -t ois-api .` from the repo root. The build context must be the repo root because the image needs the lockfile and the workspace packages.

### Deploy to Cloud Run

`cloudbuild.yaml` runs three steps: **build** the image (tagged with `$COMMIT_SHA`) → **push** it to Artifact Registry → **deploy** the `ois-ledger` service. Migrations are not run by the pipeline: apply `packages/db/drizzle/*.sql` to the database yourself, in order (for example in the Supabase SQL editor), before deploying a change that needs them.

One-time setup:

```bash
gcloud artifacts repositories create ois --repository-format=docker --location=asia-south1
printf '%s' 'postgres://USER:PASSWORD@HOST:5432/ois' | gcloud secrets create ois_db_url --data-file=-
```

The Cloud Build service account needs these roles:
- Cloud Run Admin
- Service Account User
- Artifact Registry Writer
- Logs Writer

The Cloud Run runtime service account needs Secret Manager Secret Accessor on `ois_db_url`.

Create a Cloud Build trigger on `main` with **Configuration: Cloud Build configuration file** at `/cloudbuild.yaml`. Override substitutions in the trigger as needed:

| Substitution | Default | Purpose |
|---|---|---|
| `_REGION` | `asia-south1` (Mumbai) | Region for Artifact Registry and Cloud Run |
| `_AR_REPO` / `_SERVICE` | `ois` / `ois-ledger` | Resource names |
| `_DB_SECRET` | `ois_db_url` | Secret Manager secret holding `DATABASE_URL` |
| `_PROXY_SECRET` | `ois_proxy_secret` | Shared secret the Cloudflare Worker (`apps/api-proxy`) sends as `x-proxy-secret`. When `PROXY_SHARED_SECRET` is set, the API rejects any request without it (`401`, code `1005`), so `https://ois.atlair.cloud` is the only working way in. The same value must be stored as the Worker secret `PROXY_SHARED_SECRET`. |
| `_CORS_ORIGIN` | `https://order.atlair.cloud` | Origin of the web app allowed by CORS |
| `_MAX_INSTANCES` × `_PG_POOL_MAX` | `4` × `10` | Maximum client connections to the Supabase pooler (40). Keep this below the database's connection limit. |

To run it manually, outside a trigger: `gcloud builds submit --config=cloudbuild.yaml --substitutions=COMMIT_SHA=$(git rev-parse HEAD)`.

### Seed data

26 synthetic products (electronics, priced in INR paise), 185 units in total. They include a few edge cases for trying the paths in the brief by hand:

| Case | SKUs |
|---|---|
| **Last unit** (race for it) | `SKU-GPU-5090`, `SKU-PHONE-S25`, `SKU-WATCH-U2`, `SKU-CHAIR-AERON`, `SKU-CONSOLE-PS5` |
| **Out of stock** (all-or-nothing failures) | `SKU-CABLE-USB4`, `SKU-UPS-1500` |
| Low stock | `SKU-KB-75`, `SKU-LAPTOP-M4`, `SKU-NAS-4BAY`, `SKU-CPU-9950` |
| Plentiful | `SKU-MOUSE-PRO`, `SKU-CAM-4K`, `SKU-BUDS-PRO`, `SKU-HDD-20TB`, … |

The seed also creates two orders, keyed `seed-order-active-001` (RESERVED, holding 3 units) and `seed-order-cancelled-002` (CANCELLED), along with their ledger history. `pnpm db:seed` does nothing if products already exist; `pnpm db:reset` truncates every table and seeds again.

### Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` / `TEST_DATABASE_URL` | see `.env.example` | Application and test databases |
| `PG_POOL_MAX` | 20 | Pool size for each API process |
| `PG_CONNECTION_TIMEOUT_MS` | 5000 | Maximum wait for a pool connection; the request then gets `503` / `1301` |
| `PG_POOL_MAX_WAITING` | 100 | Maximum number of requests queued for a connection; beyond this, new requests are rejected immediately with `503` / `1302` |
| `PG_IDLE_TIMEOUT_MS` | 20000 | How long an idle pooled connection is kept |

The Postgres session settings are `lock_timeout=5s`, `statement_timeout=10s` and `idle_in_transaction_session_timeout=15s`.

---

## 2. API reference

Base URL: `http://localhost:3001/api`. Every route validates its input and serializes its output with TypeBox schemas.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/orders` | Create an all-or-nothing reservation (requires an `Idempotency-Key` header) |
| `GET` | `/orders/:id` | Get an order with its idempotency metadata and ledger trail |
| `GET` | `/orders/by-key/:key` | Look up the same details by `Idempotency-Key` |
| `GET` | `/orders` | List orders, with filters (`status`, `customerId`, `sku`, `search`), `limit` ≤ 100 and a `cursor` |
| `POST` | `/orders/:id/cancel` | Cancel idempotently and release reserved stock exactly once |
| `GET` | `/inventory` | All SKUs with total, available and reserved stock |
| `GET` | `/inventory/:sku` | One SKU plus its recent ledger entries (`?limit=`) |
| `GET` | `/health` | Database latency and pool statistics |

### Create an order

```bash
curl -i -X POST http://localhost:3001/api/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-7f3a' \
  -d '{"customerId":"cust-42","items":[{"sku":"SKU-MON-4K","quantity":1},{"sku":"SKU-MOUSE-PRO","quantity":2}]}'
```

```http
HTTP/1.1 201 Created
Idempotency-Replayed: false
```
```json
{
  "order": {
    "id": "019373c2-8a1e-7c4b-9d2e-5f8a1b3c4d5e",
    "idempotencyKey": "checkout-7f3a",
    "customerId": "cust-42",
    "status": "RESERVED",
    "totalPaise": 10298900,
    "createdAt": "2026-11-21T18:00:00.000Z",
    "cancelledAt": null,
    "items": [
      { "sku": "SKU-MON-4K", "productName": "ProArt 27-inch 4K OLED Monitor", "quantity": 1, "unitPricePaise": 7499900 },
      { "sku": "SKU-MOUSE-PRO", "productName": "Logitech G Pro X Superlight 2", "quantity": 2, "unitPricePaise": 1399500 }
    ]
  },
  "replayed": false
}
```

**Retrying the same key with the same payload** gets `200 OK` with `Idempotency-Replayed: true` and the **exact original response body**. This holds even if the order was cancelled later. To see the order's current state, use `GET /orders/:id`.

The payload is canonicalized before hashing:
- Items are sorted by SKU.
- Strings are trimmed.

So `[{A,1},{B,2}]` and `[{B,2},{A,1}]` count as the same request.

**Reusing a key with a different payload:**

```bash
curl -i -X POST http://localhost:3001/api/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: checkout-7f3a' \
  -d '{"customerId":"cust-42","items":[{"sku":"SKU-MON-4K","quantity":5}]}'
```
```json
HTTP/1.1 409 Conflict
{ "error": { "code": 1202, "message": "Idempotency key \"checkout-7f3a\" was already used with a different request payload", "details": { "idempotencyKey": "checkout-7f3a" } } }
```

**One SKU is short, so nothing is reserved:**

```bash
curl -i -X POST http://localhost:3001/api/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: checkout-9b11' \
  -d '{"customerId":"cust-7","items":[{"sku":"SKU-KB-75","quantity":1},{"sku":"SKU-CABLE-USB4","quantity":1}]}'
```
```json
HTTP/1.1 409 Conflict
{ "error": { "code": 1201, "message": "Insufficient stock for: SKU-CABLE-USB4 (requested 1, available 0)", "details": { "shortages": [ { "sku": "SKU-CABLE-USB4", "requested": 1, "available": 0 } ] } } }
```

### Retrieve and cancel

```bash
curl -s http://localhost:3001/api/orders/<orderId>
curl -s http://localhost:3001/api/orders/by-key/checkout-7f3a
curl -s -X POST http://localhost:3001/api/orders/<orderId>/cancel
curl -s -X POST http://localhost:3001/api/orders/<orderId>/cancel
```

- The first cancel returns `{"order": {..."status":"CANCELLED"...}, "alreadyCancelled": false}`.
- Every repeat, including simultaneous ones, returns `200` with `"alreadyCancelled": true` and releases nothing further.

### Inspect stock

```bash
curl -s http://localhost:3001/api/inventory
curl -s 'http://localhost:3001/api/inventory/SKU-GPU-5090?limit=20'
```

```json
{ "product": { "sku": "SKU-GPU-5090", "name": "RTX 5090 Founders Edition", "pricePaise": 19999900,
               "totalStock": 1, "availableStock": 0, "reservedStock": 1, "createdAt": "…", "updatedAt": "…" },
  "ledger": [ { "id": "7", "sku": "SKU-GPU-5090", "orderId": "…", "idempotencyKey": "…", "eventType": "RESERVE",
                "delta": -1, "availableAfter": 0, "reservedAfter": 1, "createdAt": "…" } ] }
```

### Errors

Every error has the form `{ "error": { "code": <number>, "message": string, "details"?: object } }`. HTTP status codes and headers never appear in the body.

| Code | HTTP | Meaning |
|---|---|---|
| 1000 | 400 | Schema validation failed |
| 1001 | 400 | `Idempotency-Key` header is missing or blank |
| 1002 | 400 | Invalid order payload |
| 1003 | 400 | Duplicate SKU in one request |
| 1004 | 400 | Malformed cursor |
| 1005 | 401 | Request did not come through the API gateway (only when `PROXY_SHARED_SECRET` is set) |
| 1100 / 1101 / 1102 / 1103 | 404 | Route / product / SKU in order / order not found |
| 1201 | 409 | Insufficient stock (`details.shortages`) |
| 1202 | 409 | Idempotency key reused with a different payload |
| 1203 | 409 | Data integrity conflict |
| 1300 | 500 | Unexpected internal error |
| 1301 | 503 + `Retry-After` | Transient database failure; safe to retry with the **same** key (see below) |
| 1302 | 503 + `Retry-After` | Load shed: the event loop or memory is under pressure, or the DB pool wait queue is full |

Code 1301 covers:
- Deadlock (`40P01`), serialization failure (`40001`), lock timeout (`55P03`) and statement timeout (`57014`).
- Pool acquire timeout.
- Connection errors (`53300`, `57P0x`, `08xxx`, `ECONNREFUSED`, `ECONNRESET`).

---

## 3. How correctness is guaranteed

### No partial writes (all-or-nothing)

A create runs as **one PostgreSQL transaction**, in this order:

1. Validate the payload, canonicalize it and compute its SHA-256 hash, all **before** taking a DB connection, so the transaction does no CPU work.
2. `BEGIN`.
3. Claim the key: `INSERT INTO idempotency_key … ON CONFLICT (key) DO NOTHING RETURNING key`.
4. Lock the products: `SELECT … FROM product WHERE sku IN (…) ORDER BY sku ASC FOR UPDATE`.
5. If any SKU is missing or short, throw. This causes a **ROLLBACK**, which discards the key claim as well, so no order, item, ledger or key rows remain.
6. Write the rows:
   - `INSERT reservation_order`, then `order_item`.
   - One batched `UPDATE product … FROM (VALUES …)` covering every item.
   - `INSERT inventory_ledger`.
7. Mark the key `COMPLETED` and store the full response body, then `COMMIT`.

PostgreSQL enforces the stock invariants as a backstop, so even a bug in the code cannot commit bad state:
- `CHECK (available_stock >= 0)`
- `CHECK (reserved_stock >= 0)`
- `CHECK (available_stock + reserved_stock = total_stock)`

### Exactly one winner for the last unit

The `FOR UPDATE` row lock serializes every request that touches a SKU. The first transaction to lock `SKU-GPU-5090` sees `available_stock = 1`, reserves it and commits. Each waiter then re-reads the committed row (`available_stock = 0`), throws `1201` and rolls back.

### No duplicate reservations from retries

Idempotency relies on the **primary-key index of `idempotency_key`**, not on application-level polling:

- **Sequential retry:** the key row is already committed, so the insert does nothing. The service then compares `request_hash`:
  - If it matches, it replays the stored `response_body` (`200`, `Idempotency-Replayed: true`).
  - If it differs, it returns `409` / `1202` without writing anything.
- **Overlapping retry** (the first attempt has not committed yet): the second `INSERT … ON CONFLICT` **blocks** on the first transaction's uncommitted index entry.
  - If the first commits, the waiter gets "conflict, nothing inserted", reads the committed row and replays it.
  - If the first rolls back, the waiter's insert goes through and it runs the reservation itself.
  - Neither path produces a 500 or a second order.
- **Crash (SIGKILL) mid-transaction:** PostgreSQL aborts the open transaction, so the `IN_PROGRESS` key row never becomes visible. The next retry claims the key fresh, and no key is ever left stuck.
- **Failed reservations are not remembered.** A `1201`/`1102` rolls back the key claim, so retrying the same key later runs the request again and may succeed if stock was freed. No order existed, so this cannot create a duplicate.
- **A second safety net:** `reservation_order.idempotency_key` is `UNIQUE`.

### Losing requests are logged, not stored

A request rejected with `1102`, `1201` or `1202` writes nothing: the transaction rolls back and no row is left behind. To investigate the losing side of a race, the API emits one structured log line per rejection: `event: "reservation.rejected"`, with `idempotencyKey`, `customerId`, `errorCode`, `skus`, `shortages` and `missingSkus`. Query it in Cloud Logging by key or SKU.

This is deliberately not a database table:
- It keeps the losing path free of database writes, which matters most when a sold-out SKU is getting hammered.
- The public endpoint can't be used to fill the database with junk rows.
- Log retention and sampling already handle volume.

### Cancel exactly once

Cancel runs as follows:
1. `SELECT … FROM reservation_order WHERE id = $1 FOR UPDATE`. Concurrent cancels queue here.
2. The first cancel sees `RESERVED`. It locks that order's products in **ascending SKU order**, then in a single statement moves each item's quantity from `reserved_stock` back to `available_stock`, writes `RELEASE` ledger rows, sets the order to `CANCELLED` and commits.
3. Every later cancel sees `CANCELLED` and returns `alreadyCancelled: true` without touching stock.

### No deadlocks

Every transaction acquires locks in one global order:
- **Create:** idempotency key, then products in ascending SKU order.
- **Cancel:** order row, then products in ascending SKU order.

Since products are always locked in ascending SKU order, two orders for `[A,B]` and `[B,A]` cannot form a cycle (Proof 5).

### Failure behaviour under load

Every `503` response tells the client to retry **with the same `Idempotency-Key`**. Idempotency makes that safe even when the outcome of the first attempt is unknown, for example after `ECONNRESET` during `COMMIT`.

- **Lock contention** (deadlock, lock timeout, statement timeout): `503` / `1301` with `Retry-After: 1`.
- **Pool exhaustion:** a request that can't get a pooled connection within `PG_CONNECTION_TIMEOUT_MS` gets `503` / `1301`, not a generic 500.
- **Backpressure:** when `PG_POOL_MAX_WAITING` requests are already queued for a connection, new requests to the inventory and order routes are rejected at `onRequest` with `503` / `1302`, before any database work. `/api/health` is exempt so probes keep working.

---

## 4. Tests

All database tests run against **real PostgreSQL** (`ois_test`). Concurrency tests send real HTTP requests to a listening server. Each test then reads the final `product`, `reservation_order`, `order_item`, `inventory_ledger` and `idempotency_key` rows.

Every test also checks the same invariants:
- Stock is never negative.
- `available + reserved = total`.
- The ledger sum (`SUM(delta)`) equals available stock.
- Reserved stock equals the sum of active order items.

| Spec case | Test (`apps/api/tests/`) |
|---|---|
| Distinct requests compete for the last unit | `concurrency.test.ts`, **Proof 1**: 20 simultaneous requests with different keys → exactly 1×`201`, 19×`409/1201`, stock `0/1`, 1 order. |
| Overlapping retries with the same key and payload | **Proof 7** (deterministic): the test holds the product row lock, so request A claims the key and blocks. 9 retries then block on A's uncommitted key, and the test waits until Postgres shows all 10 waiting before releasing. Result: 1×`201`, 9×`200` replays of the same order, stock decremented once. **Proof 2** adds 10 simultaneous requests (with SKUs in different orders) plus a retry after commit. |
| "Request times out and is retried" | **Proof 8**: the client aborts A while it is in flight, the server still commits, and the retry returns `200` with the original order. 1 order, stock decremented once. |
| Failed multi-item reservation | **Proof 4**: one short SKU in a multi-item order → `409`, zero orders, items, ledger rows or keys, and stock unchanged. |
| Key reused with a different payload | **Proof 3**: sequential and concurrent → `409/1202`, no state change. |
| Deadlock resistance | **Proof 5**: 20 alternating `[A,B]` / `[B,A]` orders → 0 deadlocks |
| Repeated cancellation | **Proof 6**: 10 simultaneous cancels → stock released exactly once |
| Replay returns the original response | `api.contract.test.ts`: create → cancel → retry returns the original `RESERVED` body; the order stays `CANCELLED` |
| Pool exhaustion and backpressure | `pool-pressure.test.ts`: pool timeout → `503/1301`, and a retry with the same key creates exactly one order; full wait queue → `503/1302` with no key claimed |
| Gateway-only access | `proxy-auth.test.ts`: missing, wrong (including different-length) and correct secret; unknown routes are also gated; no gate when the secret isn't configured |

21 API tests (8 concurrency proofs) and 5 shared-package tests.

```bash
pnpm test
cd apps/api && npx vitest run tests/concurrency.test.ts --reporter=verbose
```

### Evidence

- Concurrency test run: [`artifacts/tests/concurrency-test-output.txt`](artifacts/tests/concurrency-test-output.txt)
- Operator UI, order lookup & retry investigation: [`artifacts/ui/order-lookup-by-key.png`](artifacts/ui/order-lookup-by-key.png) and [`artifacts/ui/order-retry-investigation.png`](artifacts/ui/order-retry-investigation.png)
- Operator UI, inventory view: [`artifacts/ui/inventory-atlair-light.png`](artifacts/ui/inventory-atlair-light.png) and [`artifacts/ui/inventory-atlair-dark.png`](artifacts/ui/inventory-atlair-dark.png)

### Operator UI

The console at http://localhost:5173 lets an operator:
- Look up an order by order ID or `Idempotency-Key`, and see its status, items, request hash and full ledger trail.
- Browse and filter orders.
- See total, available and reserved stock for every SKU, plus that SKU's ledger.
- Fire reservations with a chosen key, to reproduce races and retries by hand.

---

## 5. What I'd improve for production

**Throughput on hot SKUs**
- Today the product row lock is held across about 6 round trips. Two changes would shrink that:
  - Collapse lock, check and decrement into one guarded statement: `UPDATE product SET … WHERE sku = ANY($1) AND available_stock >= qty RETURNING …`.
  - Build the order and item rows before taking the lock.
- Fail fast on sold-out SKUs with an unlocked read before claiming a key, so a sold-out SKU doesn't build a lock queue.
- For flash sales, split very hot SKUs into N stock "buckets", or queue reservations per SKU.

**Idempotency lifecycle**
- Add a TTL (for example 24–72h) with a `created_at` index and a batched purge job.
- Before purging keys, drop the `reservation_order.idempotency_key` `UNIQUE` constraint, or keep a slim tombstone row for each key. Otherwise a retry after a purge returns `1203` instead of replaying.
- Scope keys per client or customer (`UNIQUE (customer_id, key)`) so one tenant's keys don't collide with, or reveal, another's.

**Capacity and operations**
- Put PgBouncer (transaction pooling) in front of Postgres. `max_connections = 100` currently caps you at about 5 API replicas × 20 connections.
- Export pool `waitingCount`, `1301`/`1302` rates, lock-wait time (`log_lock_waits` is already on) and `pg_stat_statements` to metrics, and alert on them.
- Partition `inventory_ledger` by month, and keep `response_body` small (or store a pointer instead) to limit TOAST growth.
- Add reservation expiry (holds that auto-release after N minutes) and a confirm/fulfil state.

- Turn `reservation.rejected` logs into a log-based metric (rejections per SKU and reason) with an alert on sudden spikes, and sample them during flash sales.

**Testing**
- Add a cancel-vs-create race on the same SKU.
- Kill the API process mid-transaction in CI to prove there are no orphaned keys.
- Load-test with k6 to find the pool, lock-timeout and `PG_POOL_MAX_WAITING` settings for the target traffic.
