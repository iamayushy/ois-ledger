# OIS.md

> an order & inventory reservation service. and the notes I wish someone had handed me first.
>
> not a framework. not a platform. one service, one database, five promises.
>
> live: operator console https://order.atlair.cloud · api https://ois.atlair.cloud · docs https://ois.atlair.cloud/docs

## what this file is

A merchant has very little stock. Two buyers tap "reserve" on the last unit in the same millisecond. A phone loses signal mid-request and the app retries. Somebody has to make sure the merchant doesn't sell one thing twice, the buyer doesn't get charged twice, and an operator can look at the wreckage afterwards and understand exactly what happened.

That's this. A Fastify API on PostgreSQL, a small React console for the operator, and a pile of tests that hit a real database with real concurrency, because a mocked database will tell you whatever you want to hear.

| piece | where | what |
|---|---|---|
| api | `apps/api` | Fastify 5 + TypeBox, port `3001`, Swagger at `/docs` |
| operator console | `apps/web` | React 19 + Vite + SWR, port `5173` |
| database | `packages/db` | PostgreSQL 16 via Drizzle, SQL migrations, synthetic seed |
| shared | `packages/shared` | schemas, numeric error codes, canonical request hashing, UUIDv7 |
| edge proxy | `apps/api-proxy` | Cloudflare Worker that puts the API on `ois.atlair.cloud` |

## the five promises

### 1. the last unit goes to exactly one buyer

When everyone wants the same thing, somebody has to go first. Postgres decides who, not the app.

- every reservation locks its products with `SELECT … WHERE sku = ANY($1::text[]) ORDER BY sku FOR UPDATE`
- the first transaction sees `available_stock = 1`, takes it, commits
- everyone queued behind it wakes up, re-reads `available_stock = 0`, gets `409 / 1201`, rolls back
- the database refuses to go negative even if my code is wrong: `CHECK (available_stock >= 0)`, `CHECK (reserved_stock >= 0)`, `CHECK (available_stock + reserved_stock = total_stock)`

How I know: Proof 1 sends 20 buyers at 1 unit and gets exactly one `201`. The 1,000-buyer load test (below) got exactly 5 orders for 5 last units, four runs in a row.

### 2. a retry never becomes a second order

Networks lie. A timeout doesn't mean "it didn't happen", it means "you don't know". So every `POST /orders` carries an `Idempotency-Key`, and the key is claimed inside the same transaction as the reservation:

```sql
INSERT INTO idempotency_key (key, request_hash, status) … ON CONFLICT (key) DO NOTHING RETURNING key
```

- **retry after commit:** the key exists. Same payload hash → replay the stored response (`200`, `Idempotency-Replayed: true`). Different payload → `409 / 1202`, nothing written.
- **retry while the first is still running:** the second insert *blocks* on the first one's uncommitted index entry. No polling, no 500. When the first commits, the waiter replays it. If the first rolls back, the waiter just does the work itself.
- **the process gets `SIGKILL`ed mid-transaction:** Postgres rolls it back. The `IN_PROGRESS` row was never visible to anyone, so nothing is stuck.
- **the payload is canonicalized before hashing** (items sorted by SKU, strings trimmed), so `[{A,1},{B,2}]` and `[{B,2},{A,1}]` are the same request. Duplicate SKUs in one request are `400 / 1003`.
- **a replay returns the exact original body**, even if the order was cancelled since. `GET /orders/:id` is for the current state.
- **failed reservations aren't remembered.** No order existed, so retrying later may succeed if stock came back. That can't double anything.
- belt and braces: `reservation_order.idempotency_key` is `UNIQUE`.

How I know: Proof 7 *forces* the overlap. The test holds the product lock, lets request A claim the key and stall, fires 9 retries, waits until Postgres shows all 10 waiting, then lets go: 1 × `201`, 9 × `200`, same order, stock moved once. Proof 8 is the brief's exact story: the client gives up mid-flight, the server commits anyway, the retry gets the original order back.

### 3. all of it or none of it

An order with three items reserves three items or zero. Never two.

A reservation is one transaction, 5 round trips, and only 3 of them hold the product lock:

1. validate, canonicalize, hash: **before** touching a connection, so the transaction does no thinking
2. `BEGIN`
3. set transaction-local timeouts *and* claim the key, one statement (`WITH settings AS (SELECT set_config('lock_timeout','5000',true), …) INSERT …`). Local settings survive Supabase's transaction pooler, which drops session settings.
4. 🔒 lock products in SKU order
5. anything missing or short → throw → `ROLLBACK`, which takes the key claim with it. No order, no items, no ledger, no key.
6. 🔒 one statement writes everything with data-modifying CTEs: the stock `UPDATE … FROM (VALUES …)`, the order, its items, the ledger rows, and the key marked `COMPLETED` with the response body. One statement is atomic, foreign keys are checked when it ends, and row counts are verified or it rolls back.
7. 🔒 `COMMIT`

How I know: Proof 4 sends three items with one short. You get `409` with the exact shortage, and zero orders, zero items, zero ledger rows, zero keys. Every test also re-checks the invariants against the actual tables afterwards.

### 4. cancel releases stock once. once.

People double-click. Clients retry. Operators panic.

- lock the order row `FOR UPDATE`: concurrent cancels queue right here
- the first one sees `RESERVED`, locks its products in SKU order, and in one statement gives the stock back, writes `RELEASE` ledger rows, marks the order `CANCELLED`
- everyone after it sees `CANCELLED` and gets `200` with `alreadyCancelled: true`. Stock untouched.

How I know: Proof 6, 10 simultaneous cancels, stock released exactly once.

### 5. nobody deadlocks

Deadlocks come from two transactions grabbing the same locks in opposite orders. So there is one order, everywhere:

- **create:** idempotency key → products, ascending SKU
- **cancel:** order row → products, ascending SKU

`[A,B]` and `[B,A]` can't form a cycle if both lock A first.

How I know: Proof 5, 20 alternating `[A,B]` / `[B,A]` orders, zero deadlocks. In the load test, 200 opposite-order buyers at once, zero `40P01` in the logs.

## when it does go wrong

Under real load something will eventually be slow. The rule: fail loudly, fail retryably, never fail halfway.

- deadlock, serialization failure, lock timeout, statement timeout, pool timeout, dropped connection → `503 / 1301` with `Retry-After`. Retrying with the **same** key is always safe, even if the commit actually landed.
- too many requests already waiting for a database connection → shed at the door with `503 / 1302` before any database work. The health endpoints are exempt, so probes still work.
- unexpected errors → `500 / 1300`, no stack trace in the body.

## run it locally (zero effort)

Everything runs on your machine: Postgres in Docker, the API and the console with pnpm. Nothing here touches the live deployment.

**1. check you have the three things** (any recent versions above these work):

```bash
node -v          # v22 or newer
docker info      # must not error: Docker Desktop / the daemon is running
corepack -v      # ships with Node; provides pnpm
```

**2. from the repo root, run exactly this:**

```bash
corepack enable
pnpm install
pnpm bootstrap
pnpm dev
```

- `corepack enable` makes the pinned pnpm (`10.20.0`) available. Skip it if `pnpm -v` already works.
- `pnpm bootstrap` is safe to run again and again:
  - creates `.env` from `.env.example` if it's missing;
  - starts Postgres 16 on `localhost:5439` and **waits until it's healthy**;
  - creates the `ois` and `ois_test` databases on first start;
  - applies migrations to both;
  - seeds 26 products and 2 orders (skipped if already seeded).
- `pnpm dev` starts the API on **http://localhost:3001** and the console on **http://localhost:5173**. It keeps running; stop it with `Ctrl+C`.

**3. check it worked** (in a second terminal):

```bash
curl -s http://localhost:3001/readyz
# {"status":"ready","database":"connected"}

curl -s http://localhost:3001/api/v1/inventory | head -c 200
# {"products":[{"sku":"SKU-BUDS-PRO", …
```

Then open http://localhost:5173 (the console) and http://localhost:3001/docs (Swagger).

**4. watch the race in ten seconds.** Five buyers, one GPU, all at once:

```bash
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "buyer $i -> %{http_code}\n" -X POST http://localhost:3001/api/v1/orders \
    -H 'Content-Type: application/json' -H "Idempotency-Key: race-$i-$RANDOM" \
    -d '{"customerId":"buyer-'$i'","items":[{"sku":"SKU-GPU-5090","quantity":1}]}' &
done; wait
# exactly one 201, four 409s. `pnpm db:reset` puts the GPU back.
```

**everyday commands**

| command | does |
|---|---|
| `pnpm test` | all tests (contract and real-Postgres concurrency). Needs `pnpm bootstrap` once. |
| `pnpm db:reset` | wipe every table and seed again |
| `pnpm typecheck` | strict TypeScript across every workspace |
| `pnpm loadtest` | the k6 Tatkal test against **localhost** (needs [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/), e.g. `brew install k6`). It writes orders, so run `pnpm db:reset` afterwards. |
| `docker compose stop` | stop Postgres, keep the data |
| `docker compose down -v` | remove Postgres **and its data**. `pnpm bootstrap` rebuilds it. |

**if something goes wrong**

| you see | do |
|---|---|
| `pnpm: command not found` | `corepack enable`, then open a new terminal |
| `Cannot connect to the Docker daemon` | start Docker Desktop, wait until it says running, run `pnpm bootstrap` again |
| `port is already allocated` on 5439 | something else uses that port. In `.env`, change `PG_HOST_PORT` **and** the port inside `DATABASE_URL` and `TEST_DATABASE_URL` to the same free port, then `pnpm bootstrap` |
| `container name "/ois-postgres" is already in use` | an old copy of this project still has its container: `docker rm -f ois-postgres`, then `pnpm bootstrap` |
| `EADDRINUSE :3001` or `:5173` | another `pnpm dev` is already running; stop it, or use the one that's running |
| `pnpm test` refuses to run | `TEST_DATABASE_URL` must point at a database whose name ends in `_test`, so tests can never wipe real data. Use the default from `.env.example`. |

**notes for LLM agents running this for someone**

- Run steps 2 and 3 exactly, in order, from the repo root. Every step is non-interactive and safe to repeat.
- `pnpm dev` doesn't exit. Run it in the background, then poll `curl -s http://localhost:3001/readyz` until it returns `"status":"ready"` (usually under 10 s).
- Success means `/readyz` returns `"status":"ready"` and `/api/v1/inventory` lists 26 products.
- Don't set `BASE_URL` for `pnpm loadtest` unless the user explicitly asks for a remote target. The default is localhost on purpose. Never point it at `https://ois.atlair.cloud` without the owner's say-so; that's production.
- Never run `docker compose down -v` or `pnpm db:reset` on someone's machine without saying it deletes local data.

### the seed

26 made-up electronics, priced in INR paise, 185 units. Some are there to be fought over:

| for | SKUs |
|---|---|
| racing for the last unit | `SKU-GPU-5090`, `SKU-PHONE-S25`, `SKU-WATCH-U2`, `SKU-CHAIR-AERON`, `SKU-CONSOLE-PS5` |
| watching all-or-nothing fail | `SKU-CABLE-USB4`, `SKU-UPS-1500` (zero stock) |
| low stock | `SKU-KB-75`, `SKU-LAPTOP-M4`, `SKU-NAS-4BAY`, `SKU-CPU-9950` |
| plenty | `SKU-MOUSE-PRO`, `SKU-CAM-4K`, `SKU-BUDS-PRO`, `SKU-HDD-20TB`, … |

Plus two orders: `seed-order-active-001` (reserved, holding 3 units) and `seed-order-cancelled-002`.

### configuration

| variable | default | meaning |
|---|---|---|
| `DATABASE_URL` / `TEST_DATABASE_URL` | see `.env.example` | app and test databases |
| `PG_POOL_MAX` | 20 | connections per API process |
| `PG_CONNECTION_TIMEOUT_MS` | 5000 | max wait for a connection, then `503 / 1301` |
| `PG_POOL_MAX_WAITING` | 100 | max requests queued for a connection, then `503 / 1302` |
| `PG_IDLE_TIMEOUT_MS` | 20000 | how long idle connections live |
| `PROXY_SHARED_SECRET` | unset | when set, every request must carry `x-proxy-secret` or gets `401 / 1005` |

Postgres runs with `lock_timeout=5s`, `statement_timeout=10s`, `idle_in_transaction_session_timeout=15s`.

## the api

Base: `http://localhost:3001/api/v1` (or `https://ois.atlair.cloud/api/v1`). Every route validates input and serializes output through TypeBox.

**versioning.** The version is in the path: `/api/v1`. Inside v1 I only make additive changes: new endpoints, new optional fields, new error codes. Anything that would break a client (renaming or removing a field, changing a status code, tightening validation) ships as `/api/v2`, side by side with v1, until v1's callers have moved. The OpenAPI document at `/docs/json` is version `1.0.0` and lists only `/api/v1` paths, and every canonical log line carries `api_version`, so you can see who still calls an old version before you remove it.

| method | path | does |
|---|---|---|
| `POST` | `/orders` | reserve, all-or-nothing. Needs `Idempotency-Key`. |
| `GET` | `/orders/:id` | the order, its idempotency record, its ledger trail |
| `GET` | `/orders/by-key/:key` | same, looked up by key |
| `GET` | `/orders` | list. `status`, `customerId`, `sku`, `search`, `limit` ≤ 100, keyset `cursor` |
| `POST` | `/orders/:id/cancel` | cancel. Releases stock once. |
| `GET` | `/inventory` | every SKU: total, available, reserved |
| `GET` | `/inventory/:sku` | one SKU and its recent ledger (`?limit=`) |

**reserve:**

```bash
curl -i -X POST http://localhost:3001/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-7f3a' \
  -d '{"customerId":"cust-42","items":[{"sku":"SKU-MON-4K","quantity":1},{"sku":"SKU-MOUSE-PRO","quantity":2}]}'
```

```json
HTTP/1.1 201 Created
Idempotency-Replayed: false

{ "order": { "id": "019373c2-8a1e-7c4b-9d2e-5f8a1b3c4d5e", "idempotencyKey": "checkout-7f3a", "customerId": "cust-42",
    "status": "RESERVED", "totalPaise": 10298900, "createdAt": "2026-11-21T18:00:00.000Z", "cancelledAt": null,
    "items": [ { "sku": "SKU-MON-4K", "productName": "ProArt 27-inch 4K OLED Monitor", "quantity": 1, "unitPricePaise": 7499900 },
               { "sku": "SKU-MOUSE-PRO", "productName": "Logitech G Pro X Superlight 2", "quantity": 2, "unitPricePaise": 1399500 } ] },
  "replayed": false }
```

Send the same thing again: `200`, `Idempotency-Replayed: true`, the identical body.

**same key, different payload:**

```bash
curl -i -X POST http://localhost:3001/api/v1/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: checkout-7f3a' \
  -d '{"customerId":"cust-42","items":[{"sku":"SKU-MON-4K","quantity":5}]}'
```
```json
HTTP/1.1 409 Conflict
{ "error": { "code": 1202, "message": "Idempotency key \"checkout-7f3a\" was already used with a different request payload", "details": { "idempotencyKey": "checkout-7f3a" } } }
```

**one item short, nothing reserved:**

```bash
curl -i -X POST http://localhost:3001/api/v1/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: checkout-9b11' \
  -d '{"customerId":"cust-7","items":[{"sku":"SKU-KB-75","quantity":1},{"sku":"SKU-CABLE-USB4","quantity":1}]}'
```
```json
HTTP/1.1 409 Conflict
{ "error": { "code": 1201, "message": "Insufficient stock for: SKU-CABLE-USB4 (requested 1, available 0)", "details": { "shortages": [ { "sku": "SKU-CABLE-USB4", "requested": 1, "available": 0 } ] } } }
```

**look, cancel, cancel again:**

```bash
curl -s http://localhost:3001/api/v1/orders/<orderId>
curl -s http://localhost:3001/api/v1/orders/by-key/checkout-7f3a
curl -s -X POST http://localhost:3001/api/v1/orders/<orderId>/cancel
curl -s -X POST http://localhost:3001/api/v1/orders/<orderId>/cancel
```

First cancel: `"alreadyCancelled": false`. Every one after: `"alreadyCancelled": true`, nothing released.

**stock:**

```bash
curl -s http://localhost:3001/api/v1/inventory
curl -s 'http://localhost:3001/api/v1/inventory/SKU-GPU-5090?limit=20'
```
```json
{ "product": { "sku": "SKU-GPU-5090", "name": "RTX 5090 Founders Edition", "pricePaise": 19999900,
               "totalStock": 1, "availableStock": 0, "reservedStock": 1, "createdAt": "…", "updatedAt": "…" },
  "ledger": [ { "id": "7", "sku": "SKU-GPU-5090", "orderId": "…", "idempotencyKey": "…", "eventType": "RESERVE",
                "delta": -1, "availableAfter": 0, "reservedAfter": 1, "createdAt": "…" } ] }
```

### health (unversioned)

Health isn't part of the API contract, so it lives outside `/api/v1`, and versioning never moves it.

| path | answers | checks | used by |
|---|---|---|---|
| `GET /healthz` | **liveness**: is the process up? | nothing external, always fast | Cloud Run liveness probe, Docker `HEALTHCHECK` |
| `GET /readyz` | **readiness**: can it take traffic? | `SELECT 1` within 2 s; `503 / 1301` if not | Cloud Run startup and readiness probes |
| `GET /api/health` | diagnostics | database latency and connection-pool stats | the operator console's status dot |

- **No gateway secret on `/healthz` and `/readyz`,** so the platform can probe the container directly. They reveal nothing but "up" and "ready". `/api/health` goes through the gateway like everything else.
- **Successful probes don't write log lines,** or they would bury everything else. A failing `/readyz` is logged.
- **A new revision that can't reach Postgres never gets traffic,** so the previous one keeps serving.

### errors

Always `{ "error": { "code": <number>, "message": string, "details"?: object } }`. Never an HTTP status or header in the body.

| code | http | means |
|---|---|---|
| 1000 | 400 | schema validation failed |
| 1001 | 400 | `Idempotency-Key` missing or blank |
| 1002 | 400 | invalid order payload |
| 1003 | 400 | duplicate SKU in one request |
| 1004 | 400 | malformed cursor |
| 1005 | 401 | didn't come through the gateway (only when `PROXY_SHARED_SECRET` is set) |
| 1100 / 1101 / 1102 / 1103 | 404 | route / product / SKU in order / order not found |
| 1201 | 409 | not enough stock (`details.shortages`) |
| 1202 | 409 | key reused with a different payload |
| 1203 | 409 | data integrity conflict |
| 1300 | 500 | something I didn't expect |
| 1301 | 503 + `Retry-After` | transient database trouble. Retry with the same key. |
| 1302 | 503 + `Retry-After` | shedding load. Retry with the same key. |

## how I know (tests)

Every database test runs against **real PostgreSQL**. The concurrency tests fire real HTTP at a real listening server. Afterwards each one reads the actual `product`, `reservation_order`, `order_item`, `inventory_ledger` and `idempotency_key` rows and checks: nothing negative, `available + reserved = total`, the ledger adds up, and reserved stock equals what active orders hold.

| the brief asks | the proof (`apps/api/tests/`) |
|---|---|
| distinct buyers race for the last unit | **Proof 1**: 20 buyers, 1 unit → 1 × `201`, 19 × `409 / 1201`, stock `0/1`, one order |
| overlapping retries, same key and payload | **Proof 7**: overlap forced, 10 requests provably waiting at once → 1 × `201`, 9 × `200`, same order. **Proof 2**: 10 simultaneous (SKUs in different orders) plus a retry after commit. |
| a timeout, then a retry | **Proof 8**: client aborts mid-flight, server commits, retry gets the original order |
| a failed multi-item reservation | **Proof 4**: one short item → zero orders, items, ledger rows, keys. Stock unchanged. |
| key reused with another payload | **Proof 3**: sequential and concurrent → `409 / 1202`, no change |
| no deadlocks | **Proof 5**: 20 alternating `[A,B]` / `[B,A]` → zero |
| cancel only once | **Proof 6**: 10 simultaneous cancels → released once |
| replay is the original response | `api.contract.test.ts`: create → cancel → retry still returns the original `RESERVED` body |
| graceful overload | `pool-pressure.test.ts`: pool timeout → `503 / 1301`, retry creates exactly one order; full queue → `503 / 1302`, no key claimed |
| logs tell the truth | `canonical-log.test.ts`: one line per request, route templates, DB counts, error slugs, secret never logged |
| only the gateway gets in | `proxy-auth.test.ts`: missing, wrong, right secret; unknown routes gated too |

27 API tests, 5 shared tests.

```bash
pnpm test
cd apps/api && npx vitest run tests/concurrency.test.ts --reporter=verbose
```

### evidence

Screenshots and test runs are submitted alongside the repo, not stored in it. To produce them yourself:

- **a concurrency test run:** `cd apps/api && npx vitest run tests/concurrency.test.ts --reporter=verbose` prints all 8 proofs passing against your local Postgres.
- **the operator console:** after `pnpm dev`, open http://localhost:5173, search `seed-order-active-001` and press Enter. The order, its request hash and its ledger trail appear. The Inventory tab shows live stock; run the ten-second race above and watch `SKU-GPU-5090` drop to 0.

### the operator console

Look up an order by ID or `Idempotency-Key` and see its status, items, request hash and ledger trail. Browse and filter orders. See every SKU's total, available and reserved stock, with its ledger. Fire reservations with a key of your choosing, to reproduce a race or a retry by hand.

## when 1,000 people showed up at once

I pointed k6 at the live deployment and recreated a Tatkal window: 1,000 virtual buyers released in the same second, split four ways, plus 40 reads a second of people refreshing the stock page.

| who | how many | for what | orders |
|---|---|---|---|
| last-unit hunters | 300 | 5 last units | **5** |
| flash sale | 300 | 30 units | **30** |
| retry storm | 200 (20 buyers, each key sent 10 times at once) | 12 units | **12**, plus exactly 108 replays |
| opposite-order pairs | 200 | `[A,B]` vs `[B,A]` | **11** |

Five runs at that size. Every one: exact counts matching the stock that moved, zero negative stock, zero deadlocks, zero lock timeouts, zero `5xx`.

Speed was the part that taught me things:

- **first run:** inside the API every order took under a second, but buyers waited about 6 s. The wait was Cloud Run's queue: one instance took ~1,100 of the requests while the others were still starting cold.
- **cut the round trips held under the lock** (10 → 5 per order, 7 → 3 under the lock): Postgres time for winning orders fell ~60%.
- **one warm instance, CPU boost, 250 concurrent requests per instance:** buyers' median wait halved.
- **best warm run:** writes p50 **1.9 s**, p95 **2.8 s** for a 1,000-buyer burst. The next ceiling is database connections (4 instances × 10, on Supabase's shared pooler, whose latency moves around during the day).

The script is [`loadtest/tatkal.js`](loadtest/tatkal.js). `pnpm loadtest` runs it against **localhost** with the default (smaller) split. For the 1,000-VU version:

```bash
k6 run -e LAST_UNIT_VUS=300 -e FLASH_VUS=300 -e RETRY_BUYERS=20 -e RETRIES_PER_BUYER=10 -e DEADLOCK_VUS=200 loadtest/tatkal.js
pnpm db:reset
```

It only targets another environment if you pass `-e BASE_URL=…` yourself. The script ignores `.env`, on purpose.

## logging: one line per request

I follow Stripe's [canonical log lines](https://stripe.com/blog/canonical-log-lines): every request emits **one** wide JSON line when it finishes, instead of a dozen scattered ones. A real one, from somebody losing the race for a GPU:

```json
{"severity":"INFO","service":"ois-api","build_id":"ois-ledger-00007-abc","request_id":"01a1ffdf-3afc-7137-88a9-4a6b49859173",
 "event":"canonical-log-line","http_method":"POST","http_route":"/api/v1/orders","http_status":409,"duration_ms":4.04,
 "cf_ray":"a5e2600e39e44348-BOM","db_query_count":5,"db_duration_ms":2.66,"db_acquire_count":1,"db_pool_wait_ms":0.03,
 "db_slowest_query_ms":0.75,"db_slowest_statement":"begin","idempotency_key":"checkout-9b11","customer_id":"cust-7",
 "skus":["SKU-GPU-5090"],"shortage_skus":["SKU-GPU-5090"],"error_code":1201,"error_slug":"insufficient_stock"}
```

- route templates (`/api/v1/orders/:id`), never raw paths
- the pg pool is instrumented once. Every query and connection wait is timed and attributed to its request (`AsyncLocalStorage`). Totals and the slowest statement only, and SQL text only, never parameters.
- stable `error_slug`s, so `insufficient_stock` groups across releases
- `request_id` is a UUIDv7 the API makes itself (returned as `X-Request-Id`). `cf_ray` links back to Cloudflare. `build_id` is the Cloud Run revision.
- never logged: bodies, headers. `authorization`, `cookie` and `x-proxy-secret` are redacted anyway, and a test checks the secret never appears.

Who lost the race for the GPU? `jsonPayload.error_slug="insufficient_stock" AND jsonPayload.skus="SKU-GPU-5090"`.

## shipping it

### docker

```bash
docker compose --profile app up -d --build
docker compose --profile app run --rm migrate node dist/seed.mjs
```

The root `Dockerfile` is multi-stage on `node:24-alpine`, and plain enough to build on Cloud Build's classic builder (no BuildKit):

- `base`: pnpm pinned through Corepack. Manifests first, so installs are cached until the lockfile changes.
- `build`: typecheck, then esbuild bundles the API with `@ois/shared` and `@ois/db` compiled in
- `prod-deps`: frozen, offline, production-only install. Exactly the lockfile, nothing from the web app.
- `runtime`: `tini` as PID 1, non-root `node` user, no package managers left behind, Docker health check on `/healthz`

Build context is the repo root, because the image needs the lockfile and the workspace packages.

### cloud run

`cloudbuild.yaml`: build → push to Artifact Registry → deploy `ois-ledger` in `asia-south1`. Migrations are applied by hand (`packages/db/drizzle/*.sql`, in order), not by the pipeline.

One-time setup:

```bash
gcloud artifacts repositories create ois --repository-format=docker --location=asia-south1
printf '%s' 'postgres://USER:PASSWORD@HOST:5432/ois' | gcloud secrets create ois_db_url --data-file=-
```

The Cloud Build service account needs Cloud Run Admin, Service Account User, Artifact Registry Writer and Logs Writer. The runtime account needs Secret Accessor on `ois_db_url` and `ois_proxy_secret`.

| substitution | default | why |
|---|---|---|
| `_REGION` | `asia-south1` | Mumbai, next to the users |
| `_AR_REPO` / `_SERVICE` | `ois` / `ois-ledger` | names |
| `_DB_SECRET` / `_PROXY_SECRET` | `ois_db_url` / `ois_proxy_secret` | secrets |
| `_CORS_ORIGIN` | `https://order.atlair.cloud` | the console's origin |
| `_CONCURRENCY` / `_PG_POOL_MAX_WAITING` | `250` / `250` | halved buyers' median wait in the load test |
| `_MIN_INSTANCES` | `1` | plus `--cpu-boost`. Cold scale-out was most of the original wait. |
| `_MAX_INSTANCES` × `_PG_POOL_MAX` | `4` × `10` | 40 pooler connections, max |

Manually: `gcloud builds submit --config=cloudbuild.yaml --substitutions=COMMIT_SHA=$(git rev-parse HEAD)`.

### the front door

Cloud Run can't map custom domains in every region, so a ~40-line Cloudflare Worker (`apps/api-proxy`) serves `ois.atlair.cloud`. It forwards everything to Cloud Run and adds a shared secret. The API rejects anything without that secret (`401 / 1005`), so the raw `run.app` URL is a dead end and the domain is the only way in.

## things this deliberately doesn't do

- **log in.** The API is open on purpose: the brief is about correctness, not identity. Anyone can reserve and cancel. That's a choice, not an oversight.
- **store the losers.** A rejected request writes nothing. I tried a rejection table, and it put a database write on the hottest, angriest path and let anyone fill a table from the public endpoint. The canonical log line already has everything.
- **switch languages to go faster.** Node accounts for about 3 ms of a ~190 ms request. The rest is waiting for a database connection and the lock. Go wouldn't move that.
- **pretend one load test is a benchmark.** It's a laptop in India going through a Cloudflare edge in Marseille to a shared Supabase pooler. Correctness held every time. Latency moved with the weather.

## things I'd do next

- hold the hot lock for even less: one stored procedure that locks, checks and writes in a single call
- fail fast on sold-out SKUs with an unlocked read before claiming a key
- for genuinely hot SKUs, split stock across a few rows, or queue reservations per SKU
- reservations that expire if nobody confirms them
- expire idempotency keys (24–72 h, batched purge), scope them per customer, and keep a tombstone so a late retry still replays
- a separate small connection pool for reads, so refreshing the stock page doesn't wait behind checkouts
- more pooler connections: a dedicated pooler or a bigger compute size
- alerts built from the canonical lines: p95 `duration_ms`, `db_pool_wait_ms`, `503` and `5xx` rates
- a cancel-vs-create race on the same SKU, and killing the process mid-transaction in CI

This file will be wrong in six months. That is fine.
I'd rather be specifically wrong than vaguely correct.
