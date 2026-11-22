# evidence

What the brief asks to see, and where it is. Everything here was produced by commands in this repo, so it can be regenerated.

## one concurrency test

- [`concurrency-tests.png`](concurrency-tests.png) / [`concurrency-tests.txt`](concurrency-tests.txt): all 8 real-PostgreSQL concurrency proofs passing. Each test name states the final state it checks, for example "20 simultaneous distinct-key requests yield exactly 1 order and 0 negative stock".
  - regenerate: `cd apps/api && npx vitest run tests/concurrency.test.ts --reporter=verbose`
- [`live-race.md`](live-race.md): the same two stories against the running API, with the final stock, orders and ledger read back afterwards. 20 buyers race for one GPU (1 × `201`, 19 × `409`, stock `1/0 → 0/1`). 10 identical requests share one key (1 × `201`, 9 × replay, one order id, reserved +1); reusing the key with another payload gives `409 / 1202`.
  - regenerate: `pnpm db:reset && node loadtest/race-demo.mjs > docs/evidence/live-race.md`
- [`load-test-1000-vu.md`](load-test-1000-vu.md): 1,000 concurrent buyers against the live deployment. Exact order counts, zero deadlocks, zero `5xx`, and what each tuning step did to latency.

## the operator UI

These were taken right after the live race above, so they show its results.

| screenshot | shows |
|---|---|
| [`ui-last-unit-after-race.png`](ui-last-unit-after-race.png) | the SKU inspector for `SKU-GPU-5090`: available 0, reserved 1, total 1, "Stock balanced", and a ledger with exactly one `Reserved 1 unit` for the winning order |
| [`ui-order-lookup-by-key.png`](ui-order-lookup-by-key.png) | looking up the retried `Idempotency-Key`: one order, its items and its ledger trail |
| [`ui-retry-investigation.png`](ui-retry-investigation.png) | that order's request identity: the key, payload SHA-256, record state and how long the first attempt took |
| [`ui-inventory.png`](ui-inventory.png) | the inventory view with every SKU's available, reserved and total stock |
