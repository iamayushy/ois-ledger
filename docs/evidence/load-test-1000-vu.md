# 1,000 concurrent buyers against the live deployment

A k6 recreation of a Tatkal window: 1,000 virtual buyers released in the same second against `https://ois.atlair.cloud` (Cloudflare Worker → Cloud Run `asia-south1` → Supabase Postgres), plus 40 reads per second of people refreshing stock. Script: [`loadtest/tatkal.js`](../../loadtest/tatkal.js).

```bash
k6 run -e BASE_URL=https://ois.atlair.cloud -e LAST_UNIT_VUS=300 -e FLASH_VUS=300 \
       -e RETRY_BUYERS=20 -e RETRIES_PER_BUYER=10 -e DEADLOCK_VUS=200 loadtest/tatkal.js
```

## correctness, run 4 (identical in every run)

| scenario | `201` created | `200` replayed | `409` no stock | `5xx` | orders implied by stock change | match |
|---|---|---|---|---|---|---|
| 300 buyers, 5 last units | 5 | 0 | 295 | 0 | 5 | yes |
| 300 buyers, 30 units | 30 | 0 | 270 | 0 | 30 | yes |
| 20 buyers × 10 simultaneous retries, 12 units | 12 | 108 | 80 | 0 | 12 | yes |
| 200 two-item orders, [A,B] vs [B,A] | 11 | 0 | 189 | 0 | 11 | yes |

- every product afterwards: available ≥ 0, reserved ≥ 0, available + reserved = total: **yes, 26/26**
- deadlocks (`40P01`) / lock timeouts (`55P03`) in Cloud Logging: **0 / 0**
- retry storm: 12 keys won → 12 orders and exactly 9 replays each (108); 8 keys lost → 80 × `409`, no order

## latency across the tuning steps

| run | change | k6 writes p50 / p95 | k6 browse p95 | API time p95 (server) | Postgres p50 (server) | instances |
|---|---|---|---|---|---|---|
| 1. baseline | concurrency 80, original SQL | 5.9 s / 6.5 s | 5.2 s | 605 ms | 40 ms | 3 |
| 2. fewer round trips | concurrency 80, 5 round trips per order | 6.0 s / 6.7 s | 5.2 s | 373 ms | 34 ms | 3 |
| 3. concurrency 250 | concurrency 250, first run | 2.9 s / 6.8 s | 3.0 s | 392 ms | 38 ms | 3 |
| 4. concurrency 250, warm | concurrency 250, instances already warm | 1.9 s / 2.8 s | 1.7 s | 1453 ms | 66 ms | 4 |

What moved the numbers:

- **fewer round trips under the lock** (10 → 5 per order, 7 → 3 holding the row lock) cut server-side p95 by ~40% and Postgres time for winning orders by ~60%.
- **concurrency 250 + a warm instance** stopped requests queueing in front of Cloud Run; with all four instances warm, a 1,000-buyer burst was answered with writes at **p95 2.8 s**, end to end from a laptop.
- in run 4 the queue moved from Cloud Run's front door into the API (waiting for a database connection), which is why its API-side p95 is higher while buyers got answered sooner. Postgres itself was also ~75% slower that day (66 ms vs 38 ms in run 3): Supabase's shared pooler varies through the day.
- the remaining ceiling is database connections: 4 instances × 10.

Caveat: the load generator was one laptop in India reaching Cloudflare's Marseille edge, so client-side numbers include that network path. Correctness does not depend on any of it, and held exactly in all runs.
