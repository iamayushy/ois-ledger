import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  annotate,
  createTelemetry,
  errorSlugFor,
  runWithTelemetry,
  type CanonicalValue,
  type RequestTelemetry,
} from '../observability/telemetry.js';

declare module 'fastify' {
  interface FastifyRequest {
    telemetry: RequestTelemetry | null;
  }
}

export const REQUEST_ID_HEADER = 'X-Request-Id';
const CF_RAY_PATTERN = /^[0-9a-f]{16}-[A-Z]{3,4}$/i;

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function readCfRay(request: FastifyRequest): string | undefined {
  const raw = request.headers['cf-ray'];
  return typeof raw === 'string' && CF_RAY_PATTERN.test(raw) ? raw : undefined;
}

function readErrorCode(payload: unknown): number | null {
  if (typeof payload !== 'string' || !payload.startsWith('{"error"')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    const code =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? (parsed.error as { readonly code?: unknown }).code
        : undefined;
    return typeof code === 'number' ? code : null;
  } catch {
    return null;
  }
}

function levelFor(statusCode: number): 'info' | 'warn' | 'error' {
  if (statusCode >= 500 && statusCode !== 503) {
    return 'error';
  }
  return statusCode === 503 || statusCode === 429 ? 'warn' : 'info';
}

function buildCanonicalLine(
  request: FastifyRequest,
  reply: FastifyReply,
  telemetry: RequestTelemetry,
): Record<string, CanonicalValue | undefined> {
  return {
    event: 'canonical-log-line',
    http_method: request.method,
    http_route: request.routeOptions.url ?? 'unmatched',
    http_status: reply.statusCode,
    duration_ms: roundMs(reply.elapsedTime),
    cf_ray: readCfRay(request),
    db_query_count: telemetry.dbQueryCount,
    db_failed_query_count: telemetry.dbFailedQueryCount,
    db_duration_ms: roundMs(telemetry.dbDurationMs),
    db_acquire_count: telemetry.dbAcquireCount,
    db_pool_wait_ms: roundMs(telemetry.dbPoolWaitMs),
    db_slowest_query_ms: telemetry.dbQueryCount > 0 ? roundMs(telemetry.dbSlowestQueryMs) : undefined,
    db_slowest_statement: telemetry.dbSlowestStatement || undefined,
    ...Object.fromEntries(telemetry.fields),
  };
}

function emitCanonicalLine(log: FastifyBaseLogger, request: FastifyRequest, reply: FastifyReply): void {
  try {
    const telemetry = request.telemetry ?? createTelemetry();
    log[levelFor(reply.statusCode)](buildCanonicalLine(request, reply, telemetry), 'canonical-log-line');
  } catch (error) {
    log.error({ err: error }, 'Failed to emit canonical log line');
  }
}

export const canonicalLogPlugin = fp(
  async function registerCanonicalLogPlugin(fastify: FastifyInstance) {
    fastify.decorateRequest('telemetry', null);

    fastify.addHook('onRequest', (request, reply, done) => {
      const telemetry = createTelemetry();
      request.telemetry = telemetry;
      reply.header(REQUEST_ID_HEADER, request.id);
      runWithTelemetry(telemetry, done);
    });

    fastify.addHook('onSend', async (request, reply, payload) => {
      if (reply.statusCode >= 400) {
        const code = readErrorCode(payload);
        if (code !== null) {
          annotate(request.telemetry, { error_code: code, error_slug: errorSlugFor(code) });
        }
      }
      return payload;
    });

    fastify.addHook('onResponse', async (request, reply) => {
      emitCanonicalLine(request.log, request, reply);
    });
  },
  {
    name: 'ois-canonical-log-plugin',
  },
);
