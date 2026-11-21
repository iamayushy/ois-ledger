# PLAN.md — Step-by-Step Implementation Plan

Each task is intentionally small, self-contained, and ends with an explicit **Verification Gate**. Do not move to the next task until the current task passes its gate cleanly and satisfies the Senior Code Review Checklist in `CLAUDE.md`.

---

## Task 0 — Skills Installation & Empty Monorepo Scaffold
**Status**: `[x]` Completed

- Install `postgres` (`planetscale/database-skills`), `fastify-best-practices` (`mcollina/skills`), `vercel-react-best-practices` (`vercel-labs/agent-skills`), and `vercel-composition-patterns` (`vercel-labs/agent-skills`) via `npx skills add`.
- Initialize Git repo (`main`), `.gitignore`, `.env.example`, `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`.
- Scaffold empty package manifests (`@ois/shared`, `@ois/db`, `@ois/api`, `@ois/web`).
- Write `CLAUDE.md` and `PLAN.md`.

**Verification Gate**:
- `.agents/skills/` and `.claude/skills/` contain all 4 skills.
- `git status` shows clean scaffold with zero untracked junk.

---

## Task 1 — Local PostgreSQL 16 Infrastructure (`docker-compose.yml`)
**Status**: `[x]` Completed

**Scope**:
- Create `docker-compose.yml` running `postgres:16-alpine` on port `5439` (avoids host `5432` conflicts) with:
  - Persistent named volume (`ois_pgdata`).
  - Init script (`docker/postgres/init-databases.sql`) creating both `ois` (dev/demo) and `ois_test` (automated test isolation).
  - Server-level safety defaults (`idle_in_transaction_session_timeout = '15s'`, `lock_timeout = '5s'`, `statement_timeout = '10s'`, `log_lock_waits = on`, `deadlock_timeout = '1s'`).
  - Docker healthcheck (`pg_isready`).
- Copy `.env.example` → `.env` for local execution.

**Verification Gate**:
- `docker compose up -d --wait` succeeded (`ois-postgres` healthy).
- Verified both `ois` and `ois_test` databases accept connections and report `idle_in_transaction_session_timeout = 15s`, `lock_timeout = 5s`, `statement_timeout = 10s`, `log_lock_waits = on`, `deadlock_timeout = 1s`.

---

## Task 2 — Shared Contracts & Deterministic Utilities (`@ois/shared`)
**Status**: `[x]` Completed

**Scope**:
- Install `@sinclair/typebox`, `uuid`, and `typescript` workspace devDependencies.
- `packages/shared/src/uuidv7.ts`: Monotonic RFC 9562 UUIDv7 generator & validator backed by `uuid` (`v7`, `validate`).
- `packages/shared/src/hash.ts`: Pure functional canonical payload normalizer + SHA-256 hash (`canonicalizeOrderPayload` + `hashOrderPayload`) returning discriminated `Result` union:
  - Trims/normalizes `customerId`, sorts `items` by `sku ASC`, rejects duplicate SKUs deterministically.
  - Same logical items in different order produce identical hashes; any quantity/SKU/customer change produces a different hash.
- `packages/shared/src/schemas.ts`: TypeBox schemas (INR integer `paise`) + `Static<>` types + 1000-series numeric `ERROR_CODE` registry (no HTTP status/headers in JSON bodies).

**Verification Gate**:
- `pnpm --filter @ois/shared typecheck` passed with zero errors.
- `pnpm --filter @ois/shared test` passed 5/5 tests (UUIDv7 RFC 9562 + 5,000-call same-ms monotonicity + canonical SHA-256 invariance & duplicate SKU rejection).

---

## Task 3 — Drizzle Schema, Migrations & DB Client (`@ois/db`)
**Status**: `[x]` Completed

**Scope**:
- Install `drizzle-orm`, `pg`, `drizzle-kit`, `@types/pg`, `tsx`.
- `packages/db/src/schema.ts`: Define 5 singular `snake_case` tables adhering strictly to PlanetScale Postgres skill:
  - `product` (`sku PK`, `name`, `price_paise`, `total_stock`, `available_stock`, `reserved_stock`, `created_at`, `updated_at`, `CHECK` constraints for non-negative & exact conservation).
  - `reservation_order` (`id UUID PK` [UUIDv7], `idempotency_key TEXT UNIQUE NOT NULL`, `customer_id`, `status CHECK ('RESERVED','CANCELLED')`, `total_paise BIGINT`, `created_at`, `cancelled_at`, composite index `(status, created_at DESC, id DESC)`, index `(customer_id)`).
  - `order_item` (`id BIGINT IDENTITY PK`, `order_id FK`, `sku FK`, `quantity CHECK > 0`, `unit_price_paise`, `UNIQUE (order_id, sku)` serving leftmost `order_id` lookups, explicit FK index on `sku`).
  - `idempotency_key` (`key TEXT PK`, `request_hash`, `status CHECK ('IN_PROGRESS','COMPLETED')`, `response_status`, `response_body JSONB`, `order_id FK`, `created_at`, `updated_at`, explicit FK index on `order_id`).
  - `inventory_ledger` (`id BIGINT IDENTITY PK`, `sku FK`, `order_id FK`, `idempotency_key`, `event_type CHECK ('SEED','RESERVE','RELEASE')`, `delta`, `available_after`, `reserved_after`, `created_at`, indexes on `(order_id)` and `(sku, created_at DESC, id DESC)`).
- SQL migrations: `0000_init_schema.sql`, `0001_product_hot_fillfactor.sql` (`ALTER TABLE product SET (fillfactor = 75);` for HOT updates), and `0002_currency_to_inr_paise.sql` (INR `paise` + `BIGINT` `total_paise`).
- `packages/db/src/client.ts`: Configured `pg.Pool` (explicit `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, session timeouts, pool acquire timeout classifier) + `drizzle(pool, { schema })` + pool metrics helper.
- `packages/db/src/migrate.ts`: Safe programmatic migration runner (works for both `DATABASE_URL` and `TEST_DATABASE_URL`).

**Verification Gate**:
- `pnpm --filter @ois/db typecheck` passed cleanly.
- `pnpm db:migrate` applied idempotently across both `ois` and `ois_test`.
- Verified `pg_class.reloptions = {fillfactor=75}` on `product`, all `CHECK` constraints, and zero redundant indexes across all 5 tables.

---

## Task 4 — Synthetic Seed & Clean Reset Scripts (`@ois/db`)
**Status**: `[x]` Completed

**Scope**:
- `packages/db/src/seed-data.ts`, `packages/db/src/seed.ts`: Idempotent synthetic merchant catalog in INR (`paise`) featuring realistic limited-stock scenarios:
  - Last-unit scarce SKU (`SKU-GPU-5090`, stock `1`) — ready for instant race demo.
  - Low-stock SKU (`SKU-KB-75`, stock `3`) — ready for multi-item partial-shortage demo.
  - Standard SKUs (`SKU-MON-4K` stock `10`, `SKU-MOUSE-PRO` stock `25`, `SKU-DOCK-TB4` stock `5`, `SKU-CABLE-USB4` stock `0` out-of-stock).
  - Initial `SEED` entries in `inventory_ledger` + 2 realistic sample orders (1 `RESERVED`, 1 `CANCELLED`) with matching `idempotency_key` and `inventory_ledger` entries so the Operator UI is immediately rich to explore.
- `packages/db/src/reset.ts`: Clean truncate/re-seed utility for repeatable demos.

**Verification Gate**:
- `pnpm --filter @ois/db typecheck` passed cleanly.
- `pnpm db:seed` ran idempotently and `pnpm db:reset` cleanly truncated & re-seeded.
- SQL invariant query verified `available_stock + reserved_stock = total_stock` and `SUM(ledger.delta) = available_stock` across all 6 SKUs.

---

## Task 5 — Core Domain Services: Atomic Reservation & Idempotent Cancellation (`@ois/api`)
**Status**: `[x]` Completed

**Scope**:
- `apps/api/src/errors.ts`: Pure functional Symbol-branded domain errors (`createAppError`, `isAppError`, `toErrorResponse`) using 1000-series numeric `ERROR_CODE` integers (zero `class`, zero HTTP status/headers in JSON bodies).
- `apps/api/src/services/inventory-service.ts`:
  - `listInventory()`: Explicit columns, bounded `LIMIT`, ordered by `sku ASC`.
  - `getProductWithLedger(sku, limit)`: Product row + bounded recent `inventory_ledger` entries.
- `apps/api/src/services/order-service.ts`:
  - `createOrder`, `cancelOrder`, `getOrderDetailById`, `getOrderDetailByIdempotencyKey`, `listOrders`.

**Verification Gate**:
- `pnpm --filter @ois/api typecheck` passed with 0 errors (strict TS, zero `any`, zero non-null assertions, zero comments, zero `class`).

---

## Task 6 — Fastify 5 Application, Plugins & TypeBox Routes (`@ois/api`)
**Status**: `[x]` Completed

**Scope**:
- Official Fastify ecosystem plugins: `fastify`, `fastify-plugin`, `@fastify/cors`, `@fastify/helmet`, `@fastify/compress`, `@fastify/etag`, `@fastify/env`, `@fastify/swagger`, `@fastify/swagger-ui`, `@fastify/under-pressure`, `@fastify/type-provider-typebox`, `close-with-grace`.
- `apps/api/src/plugins/env.ts`, `db.ts`, `pressure.ts`, `pool-backpressure.ts` (pool wait-queue load shedding with `503` / `1302` while keeping `/api/health` exempt), `swagger.ts`, `error-handler.ts` (full transient contention/connectivity/pool-timeout `503` / `1301` + `Retry-After` classification).
- `apps/api/src/routes/health.ts`, `inventory.ts`, `orders.ts` (full TypeBox request validation, OpenAPI 3.1 metadata & response serialization).
- `apps/api/src/app.ts` & `apps/api/src/server.ts` (graceful `SIGINT`/`SIGTERM` shutdown via `close-with-grace`).

**Verification Gate**:
- `pnpm --filter @ois/shared typecheck && pnpm --filter @ois/db typecheck && pnpm --filter @ois/api typecheck` — 0 errors.
- Live smoke test verified Helmet headers, ETag `304`, gzip compression, OpenAPI 3.1 at `/docs/json`, graceful `SIGTERM` exit, and full order/idempotency/cancellation lifecycle.

---

## Task 7 — Automated Contract, Concurrency & Pool-Pressure Proof Suite (`@ois/api/tests`)
**Status**: `[x]` Completed

**Scope**:
- `apps/api/vitest.config.ts`: Sequential file execution (`fileParallelism: false`) against isolated PostgreSQL `ois_test`.
- `apps/api/tests/setup.ts`: Connects to `TEST_DATABASE_URL` (with `_test` DB name safety guard), runs Drizzle migrations once, provides `resetTestDb()`, `seedTestProducts()`, and global 5-way SQL invariant verifier (`assertInventoryInvariants()`).
- `apps/api/tests/api.contract.test.ts` (Fastify `inject()` — 6 tests): Health, ETag `304`, product detail/404, full 1000-series error contract with zero HTTP status/headers in JSON, canonical payload replay (including post-cancellation replay returning original creation snapshot), ID/key lookup, keyset cursor pagination, and idempotent cancellation.
- `apps/api/tests/concurrency.test.ts` (bound HTTP server + real `Promise.all(fetch(...))` against real PostgreSQL — 6 proofs):
  1. Competing for the Last Unit (`20` concurrent → `1×201`, `19×409` `1201`).
  2. Overlapping Retries (`10` simultaneous same-key + `1` post-commit → `1×201`, `10×200`, identical `order.id`, stock decremented once).
  3. Key Reuse Conflict (sequential & `10`-way concurrent race → `409` `1202`, zero state corruption).
  4. Failed Multi-Item Reservation (All-or-Nothing → `409` `1201`, zero stock/order/item/key/ledger writes).
  5. Reverse-Order Multi-Item Contention (`20` alternating `[A,B]`/`[B,A]` → `0` deadlocks, exact `10` reserved).
  6. Concurrent Repeated Cancellation (`10` simultaneous cancels → `10×200`, `1×false` + `9×true`, stock restored once).
- `apps/api/tests/pool-pressure.test.ts` (2 tests): Pool acquire timeout → `503` / `1301` with safe same-key retry; full pool wait queue → `503` / `1302` backpressure shedding without touching DB state.

**Verification Gate**:
- `pnpm --filter @ois/api typecheck` passed with 0 errors.
- `pnpm test` passed `19/19` tests (`5` shared + `14` API/concurrency/pool-pressure) with `0` classes and `0` comments.

---

## Task 8 — Lightweight Operator Investigation UI (`@ois/web`)
**Status**: `[x]` Completed

**Scope**:
- Stack: React `19.3.1`, Vite `8.3.8` (`@vitejs/plugin-react@6.3.0`), Tailwind CSS `4.3.5` (`@tailwindcss/vite`), Base UI (`@base-ui/react@1.9.0`), SWR `2.5.1` (`useSWR` + `useSWRInfinite`), and `@phosphor-icons/react` (direct CSR subpath imports — zero barrel imports, zero Fluent icons, zero shadcn).
- Color theming: Light & Dark semantic tokens derived from Atlair Design (`design.atlair.cloud/tokens`) mapped in Tailwind v4 `@theme inline` (`src/styles/app.css`) with INR (`en-IN`) formatting and URL-synced navigation state (`src/lib/url-state.ts`).
- Team-scalable architecture + Vercel Composition Patterns + Vercel React Best Practices:
  - `src/api/`: Core typed HTTP client (`client.ts`) + centralized SWR key builders (`queryKeys.ts`) + domain folders (`health/`, `inventory/`, `orders/`).
  - `src/components/shared/`: Reusable explicit UI primitives (`button.tsx`, `copy-button.tsx`, `ledger-timeline.tsx`, `status-badge.tsx`).
  - `src/context/workbench-context.tsx`: React 19 `{ state, actions, meta }` context read via `use()`.
  - `src/layout/`: `top-bar.tsx` (single top bar with Base UI `Tabs` for `Orders` | `Inventory`, PG health status, Refresh, API docs link, Theme toggle, `+ New reservation`) + `app-shell.tsx`.
  - `src/features/orders/`: Orders workspace with unified search + exact Order UUIDv7 / Idempotency-Key lookup, Base UI `Tabs` status filter, prominent Cancel Order / Test Duplicate Cancel, progressive-disclosure stock movement timeline, and Request & Retry Investigation panel.
  - `src/features/inventory/`: Inventory workspace with Base UI `Meter` availability indicator, SKU Stock & Ledger inspector, conservation invariant verification, and clickable Order cross-links.
  - `src/features/reservation/`: Compound `ReservationDraftProvider` + lazy-loaded Base UI `Dialog` with Base UI `Select` & `NumberField`, live stock warnings, and HTTP / `Idempotency-Replayed` / 1000-series error telemetry.

**Verification Gate**:
- `pnpm --filter @ois/web typecheck` and `pnpm --filter @ois/web build` passed cleanly (`628` modules, `128ms`, `6.67 kB` gzip CSS, `143.56 kB` main JS + `31.32 kB` lazy reservation drawer chunk).
- Code audit: `0` classes, `0` comments, `0` `any`.

---

## Task 9 — Documentation, Evidence & Final Senior Audit (`README.md`)
**Status**: `[x]` Completed

**Scope**:
- Complete, concise `README.md` covering Quickstart, Seed Data, Configuration, API Reference with copy-pasteable `curl` examples (INR `paise`), complete 1000-series error table, Concurrency/Idempotency/Backpressure architecture guarantees, Test matrix, Evidence artifacts, and Production Evolution roadmap.
- Evidence artifacts captured under `artifacts/`:
  - `artifacts/tests/concurrency-test-output.txt`
  - `artifacts/ui/order-lookup-by-key.png`
  - `artifacts/ui/order-retry-investigation.png`
  - `artifacts/ui/inventory-atlair-light.png`
  - `artifacts/ui/inventory-atlair-dark.png`

**Verification Gate**:
- Fresh `pnpm typecheck && pnpm build && pnpm test` passed `100%` (`19/19` tests across 4 workspaces).
- Full monorepo audit passed every item in `CLAUDE.md` Senior Code Review Checklist (`0` comments, `0` classes, `0` `any`, `0` `@ts-ignore`, strict 1000-series error codes, all 5 SQL invariants verified).
