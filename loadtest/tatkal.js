import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;

const LAST_UNIT_SKUS = ['SKU-GPU-5090', 'SKU-PHONE-S25', 'SKU-WATCH-U2', 'SKU-CHAIR-AERON', 'SKU-CONSOLE-PS5'];
const FLASH_SKUS = ['SKU-HDD-20TB', 'SKU-SSD-4TB'];
const RETRY_SKU = 'SKU-RAM-64';
const RETRY_BUYERS = Number(__ENV.RETRY_BUYERS || 20);
const RETRIES_PER_BUYER = Number(__ENV.RETRIES_PER_BUYER || 10);
const LAST_UNIT_VUS = Number(__ENV.LAST_UNIT_VUS || 250);
const FLASH_VUS = Number(__ENV.FLASH_VUS || 200);
const DEADLOCK_VUS = Number(__ENV.DEADLOCK_VUS || 60);
const DEADLOCK_PAIR = ['SKU-MOUSE-PRO', 'SKU-STREAM-DECK'];

const created = new Counter('orders_created');
const replayed = new Counter('orders_replayed');
const rejectedStock = new Counter('rejected_insufficient_stock');
const keyConflicts = new Counter('rejected_key_conflict');
const shed = new Counter('shed_or_retryable_503');
const serverErrors = new Counter('server_errors_5xx');
const unexpected = new Counter('unexpected_status');
const writeLatency = new Trend('write_latency', true);

const COUNTERS = [created, replayed, rejectedStock, keyConflicts, shed, serverErrors, unexpected];
const SCENARIOS = ['tatkal_last_unit', 'tatkal_flash', 'retry_storm', 'deadlock_bait'];

const forceSubmetrics = Object.fromEntries(
  COUNTERS.flatMap((counter) =>
    SCENARIOS.map((scenario) => [`${counter.name}{scenario:${scenario}}`, ['count>=0']]),
  ),
);

export const options = {
  discardResponseBodies: false,
  scenarios: {
    tatkal_last_unit: { executor: 'per-vu-iterations', vus: LAST_UNIT_VUS, iterations: 1, maxDuration: '90s', exec: 'tatkalLastUnit' },
    tatkal_flash: { executor: 'per-vu-iterations', vus: FLASH_VUS, iterations: 1, maxDuration: '90s', exec: 'tatkalFlash' },
    retry_storm: {
      executor: 'per-vu-iterations',
      vus: RETRY_BUYERS * RETRIES_PER_BUYER,
      iterations: 1,
      maxDuration: '90s',
      exec: 'retryStorm',
    },
    deadlock_bait: { executor: 'per-vu-iterations', vus: DEADLOCK_VUS, iterations: 1, maxDuration: '90s', exec: 'deadlockBait' },
    browse: {
      executor: 'constant-arrival-rate',
      rate: 40,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 40,
      maxVUs: 120,
      exec: 'browse',
    },
  },
  thresholds: {
    server_errors_5xx: ['count==0'],
    unexpected_status: ['count==0'],
    'http_req_duration{scenario:browse}': ['p(95)<1500'],
    ...forceSubmetrics,
  },
};

function classify(res) {
  writeLatency.add(res.timings.duration);
  const code = res.status === 0 ? null : safeErrorCode(res);
  if (res.status === 201) {
    created.add(1);
  } else if (res.status === 200) {
    replayed.add(1);
  } else if (res.status === 409 && code === 1201) {
    rejectedStock.add(1);
  } else if (res.status === 409 && code === 1202) {
    keyConflicts.add(1);
  } else if (res.status === 503) {
    shed.add(1);
  } else if (res.status >= 500) {
    serverErrors.add(1);
  } else {
    unexpected.add(1, { status: String(res.status), code: String(code) });
  }
}

function safeErrorCode(res) {
  try {
    const body = res.json();
    return body && body.error ? body.error.code : null;
  } catch (error) {
    return null;
  }
}

function placeOrder(key, customerId, items) {
  const res = http.post(`${BASE_URL}/api/v1/orders`, JSON.stringify({ customerId, items }), {
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    tags: { name: 'POST /api/v1/orders' },
    timeout: '30s',
  });
  classify(res);
  check(res, { 'no 5xx except retryable 503': (r) => r.status < 500 || r.status === 503 });
  return res;
}

export function tatkalLastUnit() {
  const vu = exec.vu.idInTest;
  const sku = LAST_UNIT_SKUS[vu % LAST_UNIT_SKUS.length];
  placeOrder(`lt-${RUN_ID}-last-${vu}`, `lt-buyer-${vu}`, [{ sku, quantity: 1 }]);
}

export function tatkalFlash() {
  const vu = exec.vu.idInTest;
  const sku = FLASH_SKUS[vu % FLASH_SKUS.length];
  placeOrder(`lt-${RUN_ID}-flash-${vu}`, `lt-buyer-${vu}`, [{ sku, quantity: 1 }]);
}

export function retryStorm() {
  const slot = exec.scenario.iterationInTest;
  const buyer = slot % RETRY_BUYERS;
  placeOrder(`lt-${RUN_ID}-retry-${buyer}`, `lt-retry-buyer-${buyer}`, [{ sku: RETRY_SKU, quantity: 1 }]);
}

export function deadlockBait() {
  const vu = exec.vu.idInTest;
  const [first, second] = vu % 2 === 0 ? DEADLOCK_PAIR : [DEADLOCK_PAIR[1], DEADLOCK_PAIR[0]];
  placeOrder(`lt-${RUN_ID}-pair-${vu}`, `lt-buyer-${vu}`, [
    { sku: first, quantity: 1 },
    { sku: second, quantity: 1 },
  ]);
}

export function browse() {
  const path = exec.scenario.iterationInTest % 2 === 0 ? '/api/v1/inventory' : '/api/v1/orders?limit=20';
  const res = http.get(`${BASE_URL}${path}`, { tags: { name: `GET ${path.split('?')[0]}` }, timeout: '30s' });
  check(res, { 'browse ok': (r) => r.status === 200 });
}

export function handleSummary(data) {
  return { [__ENV.SUMMARY_PATH || 'loadtest/summary.json']: JSON.stringify(data) };
}
