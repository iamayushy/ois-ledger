import { createHash, timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODE } from '@ois/shared/schemas';

export const PROXY_SECRET_HEADER = 'x-proxy-secret';

export interface ProxyAuthPluginOptions {
  readonly secret?: string;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function readHeader(request: FastifyRequest): string {
  const raw = request.headers[PROXY_SECRET_HEADER];
  return typeof raw === 'string' ? raw : '';
}

function createProxySecretVerifier(secret: string): (presented: string) => boolean {
  const expected = digest(secret);
  return (presented) => presented.length > 0 && timingSafeEqual(digest(presented), expected);
}

export const proxyAuthPlugin = fp<ProxyAuthPluginOptions>(
  async function registerProxyAuthPlugin(
    fastify: FastifyInstance,
    options: ProxyAuthPluginOptions,
  ) {
    if (options.secret === undefined) {
      return;
    }

    const isTrustedProxy = createProxySecretVerifier(options.secret);

    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (isTrustedProxy(readHeader(request))) {
        return;
      }
      request.log.warn({ reqId: request.id }, 'Rejected request without valid proxy secret');
      await reply.code(401).send({
        error: {
          code: ERROR_CODE.UNAUTHORIZED_ORIGIN,
          message: 'Requests must arrive through the API gateway',
        },
      });
    });
  },
  {
    name: 'ois-proxy-auth-plugin',
  },
);
