const BASE = (process.env.BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const RUN = Date.now().toString(36);
const LAST_UNIT_SKU = process.env.LAST_UNIT_SKU ?? 'SKU-GPU-5090';
const RETRY_SKU = process.env.RETRY_SKU ?? 'SKU-MON-4K';
const BUYERS = Number(process.env.BUYERS ?? 20);
const RETRIES = Number(process.env.RETRIES ?? 10);

const out = [];
const say = (line = '') => out.push(line);

async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, body: await res.json() };
}

async function postOrder(key, customerId, items) {
  const started = performance.now();
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ customerId, items }),
  });
  const body = await res.json();
  return {
    key,
    status: res.status,
    replayed: res.headers.get('idempotency-replayed'),
    orderId: body.order?.id ?? null,
    errorCode: body.error?.code ?? null,
    ms: Math.round(performance.now() - started),
  };
}

function countBy(results, pick) {
  return results.reduce((acc, r) => acc.set(pick(r), (acc.get(pick(r)) ?? 0) + 1), new Map());
}

function stockRow(label, p) {
  return `| ${label} | ${p.availableStock} | ${p.reservedStock} | ${p.totalStock} | ${p.availableStock + p.reservedStock === p.totalStock ? 'yes' : '**NO**'} |`;
}

async function lastUnitRace() {
  const before = (await getJson(`/inventory/${LAST_UNIT_SKU}`)).body.product;
  say(`## 1. ${BUYERS} buyers, one \`${LAST_UNIT_SKU}\`, all at once`);
  say();
  say(`Every buyer has a different \`Idempotency-Key\`, and all ${BUYERS} requests are sent in the same instant (\`Promise.all\`).`);
  say();
  const results = await Promise.all(
    Array.from({ length: BUYERS }, (_, i) =>
      postOrder(`race-${RUN}-buyer-${i + 1}`, `buyer-${i + 1}`, [{ sku: LAST_UNIT_SKU, quantity: 1 }]),
    ),
  );
  const statuses = countBy(results, (r) => `${r.status}${r.errorCode ? ` / ${r.errorCode}` : ''}`);
  say('| response | count |');
  say('|---|---|');
  for (const [k, v] of [...statuses.entries()].sort()) say(`| \`${k}\` | ${v} |`);
  const winners = results.filter((r) => r.status === 201);
  say();
  say(`Winner: \`${winners.map((w) => w.key).join(', ')}\` → order \`${winners.map((w) => w.orderId).join(', ')}\``);
  say();
  const after = await getJson(`/inventory/${LAST_UNIT_SKU}?limit=50`);
  const orders = (await getJson(`/orders?sku=${LAST_UNIT_SKU}&status=RESERVED&limit=100`)).body.orders.filter((o) =>
    o.idempotencyKey.startsWith(`race-${RUN}-`),
  );
  const reserveEvents = after.body.ledger.filter((e) => e.eventType === 'RESERVE' && e.idempotencyKey?.startsWith(`race-${RUN}-`));
  say('Final state, read back from the API:');
  say();
  say('| | available | reserved | total | available + reserved = total |');
  say('|---|---|---|---|---|');
  say(stockRow('before', before));
  say(stockRow('after', after.body.product));
  say();
  say(`- orders created by this race: **${orders.length}**`);
  say(`- \`RESERVE\` ledger events from this race: **${reserveEvents.length}**`);
  say(`- stock never went below zero: **${after.body.product.availableStock >= 0 ? 'yes' : 'NO'}**`);
  say();
  return winners.length === 1 && orders.length === 1 && reserveEvents.length === 1;
}

async function retryStorm() {
  const before = (await getJson(`/inventory/${RETRY_SKU}`)).body.product;
  const key = `retry-${RUN}`;
  const items = [{ sku: RETRY_SKU, quantity: 1 }];
  say(`## 2. one buyer, one key, ${RETRIES} identical requests at once`);
  say();
  say(`A client that timed out and retried aggressively: the same \`Idempotency-Key: ${key}\` and the same payload, sent ${RETRIES} times simultaneously.`);
  say();
  const results = await Promise.all(Array.from({ length: RETRIES }, () => postOrder(key, 'retry-buyer', items)));
  const statuses = countBy(results, (r) => `${r.status} (Idempotency-Replayed: ${r.replayed})`);
  say('| response | count |');
  say('|---|---|');
  for (const [k, v] of [...statuses.entries()].sort()) say(`| \`${k}\` | ${v} |`);
  const ids = new Set(results.map((r) => r.orderId));
  say();
  say(`Distinct order ids across all ${RETRIES} responses: **${ids.size}** (\`${[...ids].join(', ')}\`)`);
  say();
  const conflict = await postOrder(key, 'retry-buyer', [{ sku: RETRY_SKU, quantity: 3 }]);
  say(`Same key, **different** payload afterwards: \`${conflict.status} / ${conflict.errorCode}\` (key conflict, nothing written).`);
  say();
  const after = (await getJson(`/inventory/${RETRY_SKU}`)).body.product;
  const detail = (await getJson(`/orders/by-key/${key}`)).body;
  say('| | available | reserved | total | available + reserved = total |');
  say('|---|---|---|---|---|');
  say(stockRow('before', before));
  say(stockRow('after', after));
  say();
  say(`- reserved stock went up by **${after.reservedStock - before.reservedStock}** (one order × quantity 1)`);
  say(`- \`GET /orders/by-key/${key}\` → one order, status \`${detail.order.status}\`, ledger events: **${detail.ledger.length}**`);
  say();
  return ids.size === 1 && after.reservedStock - before.reservedStock === 1 && conflict.errorCode === 1202;
}

const raceOk = await lastUnitRace();
const retryOk = await retryStorm();
const header = [
  '# live race transcript',
  '',
  `Generated by \`node loadtest/race-demo.mjs\` against \`${BASE}\` on ${new Date().toISOString()}.`,
  '',
  `Result: last-unit race **${raceOk ? 'PASS' : 'FAIL'}**, retry storm **${retryOk ? 'PASS' : 'FAIL'}**.`,
  '',
];
process.stdout.write([...header, ...out].join('\n') + '\n');
process.exitCode = raceOk && retryOk ? 0 : 1;
