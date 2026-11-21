import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { Pool } from 'pg';
import { ERROR_CODE } from '@ois/shared/schemas';

export interface PoolBackpressureOptions {
  readonly pool: Pool;
  readonly maxWaiting: number;
}

export function createPoolBackpressureHook(
  options: PoolBackpressureOptions,
): onRequestAsyncHookHandler {
  return async function shedWhenPoolQueueFull(request: FastifyRequest, reply: FastifyReply) {
    const waiting = options.pool.waitingCount;
    if (waiting < options.maxWaiting) {
      return;
    }

    request.log.warn(
      { poolWaiting: waiting, poolMaxWaiting: options.maxWaiting, reqId: request.id },
      'Shedding request: database pool wait queue is full',
    );
    await reply
      .header('Retry-After', '1')
      .code(503)
      .send({
        error: {
          code: ERROR_CODE.SERVER_UNDER_PRESSURE,
          message: 'Database connection pool is saturated; please retry shortly with the same Idempotency-Key',
        },
      });
  };
}
