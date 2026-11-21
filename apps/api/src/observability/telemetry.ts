import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { FinishTiming, PoolObserver } from '@ois/db/instrumentation';
import { ERROR_CODE } from '@ois/shared/schemas';

export type CanonicalValue = string | number | boolean | readonly string[];

export interface RequestTelemetry {
  dbQueryCount: number;
  dbFailedQueryCount: number;
  dbDurationMs: number;
  dbAcquireCount: number;
  dbPoolWaitMs: number;
  dbSlowestQueryMs: number;
  dbSlowestStatement: string;
  readonly fields: Map<string, CanonicalValue>;
}

const STATEMENT_PREVIEW_LENGTH = 160;
const storage = new AsyncLocalStorage<RequestTelemetry>();

const ERROR_SLUG_BY_CODE: ReadonlyMap<number, string> = new Map(
  Object.entries(ERROR_CODE).map(([name, code]) => [code, name.toLowerCase()]),
);

export function errorSlugFor(code: number): string {
  return ERROR_SLUG_BY_CODE.get(code) ?? 'unknown_error';
}

export function createTelemetry(): RequestTelemetry {
  return {
    dbQueryCount: 0,
    dbFailedQueryCount: 0,
    dbDurationMs: 0,
    dbAcquireCount: 0,
    dbPoolWaitMs: 0,
    dbSlowestQueryMs: 0,
    dbSlowestStatement: '',
    fields: new Map(),
  };
}

export function runWithTelemetry(telemetry: RequestTelemetry, next: () => void): void {
  storage.run(telemetry, next);
}

export function annotate(
  telemetry: RequestTelemetry | null | undefined,
  fields: Readonly<Record<string, CanonicalValue | null | undefined>>,
): void {
  if (!telemetry) {
    return;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      telemetry.fields.set(key, value);
    }
  }
}

function compactStatement(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().slice(0, STATEMENT_PREVIEW_LENGTH);
}

const NOOP_FINISH: FinishTiming = () => undefined;

function startQuery(statement: string): FinishTiming {
  const telemetry = storage.getStore();
  if (!telemetry) {
    return NOOP_FINISH;
  }
  const startedAt = performance.now();
  return (failed) => {
    const elapsed = performance.now() - startedAt;
    telemetry.dbQueryCount += 1;
    telemetry.dbDurationMs += elapsed;
    if (failed) {
      telemetry.dbFailedQueryCount += 1;
    }
    if (elapsed > telemetry.dbSlowestQueryMs) {
      telemetry.dbSlowestQueryMs = elapsed;
      telemetry.dbSlowestStatement = compactStatement(statement);
    }
  };
}

function startAcquire(): FinishTiming {
  const telemetry = storage.getStore();
  if (!telemetry) {
    return NOOP_FINISH;
  }
  const startedAt = performance.now();
  return () => {
    telemetry.dbAcquireCount += 1;
    telemetry.dbPoolWaitMs += performance.now() - startedAt;
  };
}

export const requestPoolObserver: PoolObserver = { startQuery, startAcquire };
