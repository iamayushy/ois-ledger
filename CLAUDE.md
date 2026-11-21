# CLAUDE.md — Order & Inventory Reservation Service (OIS)

## Mission
Build a production-grade, single-service **Order & Inventory Reservation Service** with a lightweight **Operator Investigation UI**, engineered for **correctness under concurrency, crash-safe idempotency, low latency, high row-level throughput, and fault tolerance**.

Every change must be written as if reviewed by a Staff/Principal Engineer (Opus-level strictness): zero race windows, zero hand-waving, explicit lock ordering, strict TypeScript, pure functional programming (zero `class`), zero comments in code, and real PostgreSQL proofs (never mocked DBs for concurrency tests).

---

## Code Style & API Contract Non-Negotiables
- **Zero comments in code**: Do not put `//`, `/* */`, `--`, or `#` comments in any source, config, SQL, CSS, or test file. Express intent through clear naming, cohesive small functions, and explicit types.
- **Pure functional programming (zero `class`)**: Use pure functions, factory functions, discriminated unions (`Result`), and Symbol-branded error records instead of `class` / inheritance.
- **1000-series numeric error codes & clean JSON**: Error responses always use `{ error: { code: <integer >= 1000>, message, details? } }` (`ERROR_CODE` in `@ois/shared/schemas`). Never include HTTP status codes or HTTP headers in JSON response bodies.

---

## Monorepo Architecture (`pnpm` Workspace)

```text
ois/
├── packages/
│   ├── shared/   # @ois/shared — TypeBox schemas, 1000-series ERROR_CODE, canonical SHA-256 hash, monotonic UUIDv7
│   └── db/       # @ois/db     — Drizzle ORM schema, SQL migrations, pg.Pool factory, seed/reset scripts
└── apps/
    ├── api/      # @ois/api    — Fastify 5 + TypeBox + @fastify/under-pressure + Drizzle + Vitest suite
    └── web/      # @ois/web    — React 19 + Vite + SWR Operator Investigation Console
```

---

## Non-Negotiable System Invariants

1. **Zero Negative Stock & Exact Conservation**:
   - `product.available_stock >= 0`, `product.reserved_stock >= 0`, and `product.available_stock + product.reserved_stock = product.total_stock` are enforced **both** in application logic and via PostgreSQL `CHECK` constraints.
2. **All-or-Nothing Multi-Item Reservation**:
   - Every item in an order is reserved atomically inside a single PostgreSQL transaction. If any SKU is missing or short, the transaction rolls back completely—zero items reserved, zero order rows, zero ledger rows, zero claimed idempotency keys.
3. **Deadlock-Free Deterministic Lock Ordering**:
   - Whenever locking multiple `product` rows (reservation or cancellation), always lock via `WHERE sku = ANY($1) ORDER BY sku ASC FOR UPDATE`.
   - Cancellation always acquires the `reservation_order` lock (`FOR UPDATE`) **before** locking `product` rows in ascending `sku` order.
4. **Crash-Safe, Simultaneous In-Flight Idempotency**:
   - `Idempotency-Key` header is required on `POST /api/orders`.
   - Request payload is canonicalized and SHA-256 hashed **before** acquiring a DB connection (items sorted by `sku` so `{A:1, B:2}` and `{B:2, A:1}` hash identically; duplicate SKUs in one request are rejected with `400`, `code: 1003`).
   - Inside the transaction, `INSERT INTO idempotency_key ... ON CONFLICT (key) DO NOTHING RETURNING key` uses PostgreSQL's native unique-index blocking so simultaneous retries with the same key wait without polling, without `500` errors, and without orphaned `IN_PROGRESS` rows if the process crashes.
   - Matching `request_hash` returns the exact original order (`200 OK` + HTTP header `Idempotency-Replayed: true`). Mismatched `request_hash` returns `409 Conflict` (`code: 1202`) with zero state change.
5. **Idempotent & Concurrency-Safe Cancellation**:
   - `POST /api/orders/:id/cancel` locks `reservation_order` `FOR UPDATE`. Repeated or simultaneous cancellations release the exact reserved quantities **once** and return `200 OK` (`alreadyCancelled: true` on repeats).

---

## Mandatory Skill Standards (Installed in `.agents/skills/` & `.claude/skills/`)

### 1. PlanetScale PostgreSQL (`postgres`)
- Primary keys: `BIGINT GENERATED ALWAYS AS IDENTITY` for internal/append tables (`order_item`, `inventory_ledger`), time-ordered `UUIDv7` for `reservation_order.id` (never random UUIDv4 PKs).
- `ALTER TABLE product SET (fillfactor = 75);` and no secondary indexes on `available_stock` / `reserved_stock` to enable **HOT updates**.
- Use `TEXT NOT NULL CHECK (col IN (...))` instead of Postgres `ENUM` types.
- Use `TIMESTAMPTZ` everywhere; singular `snake_case` table names (`product`, `reservation_order`, `order_item`, `idempotency_key`, `inventory_ledger`).
- Index **every** foreign key column explicitly without redundant prefix duplicates; use composite index `(status, created_at DESC, id DESC)` + cursor pagination (`LIMIT` on every list query, never `OFFSET`).
- Explicit column projections on every query (never `SELECT *`, avoiding unnecessary TOAST fetches on `idempotency_key.response_body`).
- Batch multi-item stock mutations in a **single SQL roundtrip** (`UPDATE product ... FROM (VALUES ...)`) to minimize lock-hold duration.
- Configure `lock_timeout = '5s'`, `statement_timeout = '10s'`, and `idle_in_transaction_session_timeout = '15s'`.

### 2. Fastify Best Practices (`fastify-best-practices`)
- Use `@sinclair/typebox` + `@fastify/type-provider-typebox` for **both** request validation (`ajv`) and response serialization (`fast-json-stringify`). Never compile schemas dynamically per request.
- Encapsulate infrastructure plugins (`db`, `under-pressure`, `error-handler`) with `fastify-plugin`, clean `onClose` hooks, and explicit scoped `/api` route plugins.
- Use `@fastify/under-pressure` for load shedding under event-loop/memory pressure.
- Keep Pino logging concise—never log full request/response bodies containing large payloads; log structured IDs (`orderId`, `idempotencyKey`).
- Test API contracts with `fastify.inject()` and concurrency invariants with real HTTP requests against PostgreSQL.

### 3. Vercel React Best Practices (`vercel-react-best-practices`)
- Eliminate request waterfalls: fetch independent endpoints in parallel (`Promise.all` / parallel `useSWR` hooks).
- Use `swr` for deduplicated client fetching and crisp cache invalidation after mutations.
- No barrel (`index.ts`) re-export files—import components and utilities directly.
- Derive filtered/computed state during render (no `useEffect` state syncing). Use `useTransition` / `useDeferredValue` for non-urgent search/filter interactions.
- Use `Map` for O(1) SKU lookups, ternary (`? ... : null`) instead of `&&`, hoist static JSX, and never define components inside components.

---

## Senior Code Review Checklist (Applied to Every Task)

- [ ] Zero comments in code files (`//`, `/* */`, `--`, `#`).
- [ ] Zero `class` declarations across the codebase (pure functional style).
- [ ] Numeric 1000-series error codes only; zero HTTP status codes or HTTP headers inside JSON response bodies.
- [ ] Can any concurrent interleaving violate stock conservation or produce negative stock?
- [ ] Are all locks acquired in a single global total order across every transaction path?
- [ ] Are transactions as short as possible (zero hashing, validation, or external I/O inside `BEGIN...COMMIT`)?
- [ ] What happens if the API process receives `SIGKILL` mid-transaction? (Must leave zero partial writes and zero stuck keys.)
- [ ] Are PostgreSQL error codes (`40P01` deadlock, `55P03` lock timeout, `23514` check violation, `23505` unique violation) mapped cleanly without leaking stack traces?
- [ ] Does every API route define both input and response TypeBox schemas?
- [ ] Does every list query enforce `LIMIT` and select explicit columns?
- [ ] Are there zero `any` types, zero `@ts-ignore`, and clean `pnpm typecheck` across all workspaces?

---

## Workspace Commands

```bash
docker compose up -d          # Start PostgreSQL 16 (ois + ois_test)
pnpm db:migrate               # Apply Drizzle SQL migrations
pnpm db:seed                  # Seed synthetic merchant inventory & sample orders
pnpm dev                      # Run Fastify API (:3001) + Operator Web UI (:5173)
pnpm typecheck                # Strict TS check across all workspaces
pnpm test                     # Run contract + real-Postgres concurrency test suite
```
