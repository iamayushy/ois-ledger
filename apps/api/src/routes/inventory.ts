import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ErrorResponseSchema,
  ProductDetailDtoSchema,
  ProductDetailQuerySchema,
  ProductListResponseSchema,
  SkuParamsSchema,
} from '@ois/shared/schemas';
import { getProductWithLedger, listInventory } from '../services/inventory-service.js';

export const inventoryRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/inventory',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'List all SKUs with total, available, and reserved stock',
        response: {
          200: ProductListResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async () => {
      const products = await listInventory(fastify.db);
      return { products };
    },
  );

  fastify.get(
    '/inventory/:sku',
    {
      schema: {
        tags: ['Inventory'],
        summary: 'Inspect a SKU and its recent inventory audit ledger',
        params: SkuParamsSchema,
        querystring: ProductDetailQuerySchema,
        response: {
          200: ProductDetailDtoSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      return getProductWithLedger(fastify.db, request.params.sku, request.query.limit);
    },
  );
};
