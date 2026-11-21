import type { Pool, PoolClient } from 'pg';

export type FinishTiming = (failed: boolean) => void;

export interface PoolObserver {
  readonly startQuery: (statement: string) => FinishTiming;
  readonly startAcquire: () => FinishTiming;
}

type AnyFunction = (...args: unknown[]) => unknown;

const INSTRUMENTED = Symbol.for('ois.db.instrumented');

function markInstrumented(target: object): boolean {
  const record = target as Record<symbol, unknown>;
  if (record[INSTRUMENTED] === true) {
    return false;
  }
  record[INSTRUMENTED] = true;
  return true;
}

function statementText(firstArg: unknown): string {
  if (typeof firstArg === 'string') {
    return firstArg;
  }
  if (typeof firstArg === 'object' && firstArg !== null && 'text' in firstArg) {
    const text = (firstArg as { readonly text: unknown }).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { readonly then: unknown }).then === 'function'
  );
}

function withTiming(original: AnyFunction, start: (args: unknown[]) => FinishTiming): AnyFunction {
  return function timed(this: unknown, ...args: unknown[]): unknown {
    const finish = start(args);
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      const callback = last as AnyFunction;
      const wrappedArgs = [...args.slice(0, -1), (error: unknown, ...rest: unknown[]) => {
        finish(Boolean(error));
        return callback(error, ...rest);
      }];
      return original.apply(this, wrappedArgs);
    }
    const result = original.apply(this, args);
    if (isThenable(result)) {
      result.then(
        () => finish(false),
        () => finish(true),
      );
    }
    return result;
  };
}

function instrumentClient(client: PoolClient, observer: PoolObserver): void {
  if (!markInstrumented(client)) {
    return;
  }
  const original = client.query.bind(client) as unknown as AnyFunction;
  Object.assign(client, {
    query: withTiming(original, (args) => observer.startQuery(statementText(args[0]))),
  });
}

export function instrumentPool(pool: Pool, observer: PoolObserver): void {
  if (!markInstrumented(pool)) {
    return;
  }
  pool.on('connect', (client) => instrumentClient(client, observer));
  pool.on('acquire', (client) => instrumentClient(client, observer));
  const originalConnect = pool.connect.bind(pool) as unknown as AnyFunction;
  Object.assign(pool, {
    connect: withTiming(originalConnect, () => observer.startAcquire()),
  });
}
