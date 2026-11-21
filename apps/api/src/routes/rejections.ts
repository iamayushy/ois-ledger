import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ErrorResponseSchema,
  ListRejectionsQuerySchema,
  ListRejectionsResponseSchema,
} from '@ois/shared/schemas';
import { listRejections } from '../services/rejection-service.js';

export const rejectionRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/rejections',
    {
      schema: {
        tags: ['Rejections'],
        summary: 'List rejected reservation attempts (losing races, shortages, key conflicts), newest first',
        querystring: ListRejectionsQuerySchema,
        response: {
          200: ListRejectionsResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => listRejections(fastify.db, request.query),
  );
};
