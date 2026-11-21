import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isPoolAcquireTimeout } from '@ois/db/client';
import { ERROR_CODE } from '@ois/shared/schemas';
import { isAppError, toErrorResponse } from '../errors.js';

const CONTENTION_PG_CODES = new Set(['40P01', '40001', '55P03', '57014']);
const CONNECTIVITY_ERROR_CODES = new Set([
  '53300',
  '57P01',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08006',
  'ECONNREFUSED',
  'ECONNRESET',
]);
const INTEGRITY_PG_CODES = new Set(['23505', '23514']);
const MAX_CAUSE_DEPTH = 5;

type DbFailureKind = 'contention' | 'connectivity' | 'integrity';

function classifyErrorCode(code: string): DbFailureKind | null {
  if (CONTENTION_PG_CODES.has(code)) {
    return 'contention';
  }
  if (CONNECTIVITY_ERROR_CODES.has(code)) {
    return 'connectivity';
  }
  if (INTEGRITY_PG_CODES.has(code)) {
    return 'integrity';
  }
  return null;
}

interface DbFailure {
  readonly kind: DbFailureKind;
  readonly code: string;
}

function classifyDbFailure(error: unknown): DbFailure | null {
  if (isPoolAcquireTimeout(error)) {
    return { kind: 'connectivity', code: 'POOL_ACQUIRE_TIMEOUT' };
  }

  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null;
    depth += 1
  ) {
    if ('code' in current && typeof current.code === 'string') {
      const kind = classifyErrorCode(current.code);
      if (kind) {
        return { kind, code: current.code };
      }
    }
    current = 'cause' in current ? current.cause : null;
  }

  return null;
}

const RETRYABLE_MESSAGES: Record<'contention' | 'connectivity', string> = {
  contention: 'Temporary database contention occurred; please retry with the same Idempotency-Key',
  connectivity: 'Database is temporarily unavailable or saturated; please retry with the same Idempotency-Key',
};

function asFastifyError(error: unknown): FastifyError | null {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return error as FastifyError;
  }
  return null;
}

function isMissingIdempotencyHeaderValidation(error: FastifyError): boolean {
  if (error.validationContext !== 'headers' || !Array.isArray(error.validation)) {
    return false;
  }
  return error.validation.some((item) => {
    const missing =
      typeof item.params === 'object' &&
      item.params !== null &&
      'missingProperty' in item.params &&
      item.params.missingProperty === 'idempotency-key';
    const pathMatch = item.instancePath === '/idempotency-key';
    return missing || pathMatch;
  });
}

export const errorHandlerPlugin = fp(
  async function registerErrorHandlerPlugin(fastify: FastifyInstance) {
    fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
      reply.code(404).send({
        error: {
          code: ERROR_CODE.ROUTE_NOT_FOUND,
          message: `Route ${request.method} ${request.url} not found`,
        },
      });
    });

    fastify.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      if (isAppError(error)) {
        reply.code(error.httpStatus).send(toErrorResponse(error));
        return;
      }

      const fastifyError = asFastifyError(error);
      if (fastifyError?.validation) {
        const isMissingKey = isMissingIdempotencyHeaderValidation(fastifyError);
        reply.code(400).send({
          error: {
            code: isMissingKey
              ? ERROR_CODE.MISSING_IDEMPOTENCY_KEY
              : ERROR_CODE.VALIDATION_FAILED,
            message: isMissingKey
              ? 'Idempotency-Key header is required and must be non-empty'
              : fastifyError.message,
          },
        });
        return;
      }

      if (fastifyError?.statusCode === 400) {
        reply.code(400).send({
          error: {
            code: ERROR_CODE.VALIDATION_FAILED,
            message: fastifyError.message,
          },
        });
        return;
      }

      const dbFailure = classifyDbFailure(error);
      if (dbFailure && dbFailure.kind !== 'integrity') {
        request.log.warn(
          { dbErrorCode: dbFailure.code, kind: dbFailure.kind, reqId: request.id },
          'Transient database failure',
        );
        reply.header('Retry-After', '1').code(503).send({
          error: {
            code: ERROR_CODE.SERVICE_UNAVAILABLE,
            message: RETRYABLE_MESSAGES[dbFailure.kind],
          },
        });
        return;
      }

      if (dbFailure) {
        request.log.warn(
          { dbErrorCode: dbFailure.code, reqId: request.id },
          'Database integrity constraint violation',
        );
        reply.code(409).send({
          error: {
            code: ERROR_CODE.DATA_INTEGRITY_CONFLICT,
            message: 'Operation conflicted with current data integrity state',
          },
        });
        return;
      }

      request.log.error({ err: error, reqId: request.id }, 'Unhandled API error');
      reply.code(500).send({
        error: {
          code: ERROR_CODE.INTERNAL_ERROR,
          message: 'Internal server error',
        },
      });
    });
  },
  {
    name: 'ois-error-handler-plugin',
  },
);
