import { Type, type Static } from '@sinclair/typebox';

const NON_BLANK_PATTERN = '\\S';

export const ERROR_CODE = {
  VALIDATION_FAILED: 1000,
  MISSING_IDEMPOTENCY_KEY: 1001,
  INVALID_ORDER_PAYLOAD: 1002,
  DUPLICATE_SKU: 1003,
  INVALID_CURSOR: 1004,
  ROUTE_NOT_FOUND: 1100,
  PRODUCT_NOT_FOUND: 1101,
  UNKNOWN_SKU: 1102,
  ORDER_NOT_FOUND: 1103,
  INSUFFICIENT_STOCK: 1201,
  IDEMPOTENCY_CONFLICT: 1202,
  DATA_INTEGRITY_CONFLICT: 1203,
  INTERNAL_ERROR: 1300,
  SERVICE_UNAVAILABLE: 1301,
  SERVER_UNDER_PRESSURE: 1302,
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export const OrderStatusSchema = Type.Union([
  Type.Literal('RESERVED'),
  Type.Literal('CANCELLED'),
]);
export type OrderStatus = Static<typeof OrderStatusSchema>;

export const LedgerEventTypeSchema = Type.Union([
  Type.Literal('SEED'),
  Type.Literal('RESERVE'),
  Type.Literal('RELEASE'),
]);
export type LedgerEventType = Static<typeof LedgerEventTypeSchema>;

export const IdempotencyStatusSchema = Type.Union([
  Type.Literal('IN_PROGRESS'),
  Type.Literal('COMPLETED'),
]);
export type IdempotencyStatus = Static<typeof IdempotencyStatusSchema>;

export const OrderItemInputSchema = Type.Object(
  {
    sku: Type.String({ minLength: 1, maxLength: 64, pattern: NON_BLANK_PATTERN }),
    quantity: Type.Integer({ minimum: 1, maximum: 100000 }),
  },
  { additionalProperties: false },
);
export type OrderItemInput = Static<typeof OrderItemInputSchema>;

export const CreateOrderBodySchema = Type.Object(
  {
    customerId: Type.String({ minLength: 1, maxLength: 128, pattern: NON_BLANK_PATTERN }),
    items: Type.Array(OrderItemInputSchema, { minItems: 1, maxItems: 50 }),
  },
  { additionalProperties: false },
);
export type CreateOrderBody = Static<typeof CreateOrderBodySchema>;

export const CreateOrderHeadersSchema = Type.Object({
  'idempotency-key': Type.String({ minLength: 1, maxLength: 128, pattern: NON_BLANK_PATTERN }),
});
export type CreateOrderHeaders = Static<typeof CreateOrderHeadersSchema>;

export const OrderItemDtoSchema = Type.Object({
  sku: Type.String(),
  productName: Type.String(),
  quantity: Type.Integer(),
  unitPricePaise: Type.Integer(),
});
export type OrderItemDto = Static<typeof OrderItemDtoSchema>;

export const OrderDtoSchema = Type.Object({
  id: Type.String(),
  idempotencyKey: Type.String(),
  customerId: Type.String(),
  status: OrderStatusSchema,
  totalPaise: Type.Integer(),
  createdAt: Type.String(),
  cancelledAt: Type.Union([Type.String(), Type.Null()]),
  items: Type.Array(OrderItemDtoSchema),
});
export type OrderDto = Static<typeof OrderDtoSchema>;

export const IdempotencyMetadataDtoSchema = Type.Object({
  key: Type.String(),
  requestHash: Type.String(),
  status: IdempotencyStatusSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type IdempotencyMetadataDto = Static<typeof IdempotencyMetadataDtoSchema>;

export const LedgerEntryDtoSchema = Type.Object({
  id: Type.String(),
  sku: Type.String(),
  orderId: Type.Union([Type.String(), Type.Null()]),
  idempotencyKey: Type.Union([Type.String(), Type.Null()]),
  eventType: LedgerEventTypeSchema,
  delta: Type.Integer(),
  availableAfter: Type.Integer(),
  reservedAfter: Type.Integer(),
  createdAt: Type.String(),
});
export type LedgerEntryDto = Static<typeof LedgerEntryDtoSchema>;

export const OrderDetailDtoSchema = Type.Object({
  order: OrderDtoSchema,
  idempotency: Type.Union([IdempotencyMetadataDtoSchema, Type.Null()]),
  ledger: Type.Array(LedgerEntryDtoSchema),
});
export type OrderDetailDto = Static<typeof OrderDetailDtoSchema>;

export const CreateOrderResponseSchema = Type.Object({
  order: OrderDtoSchema,
  replayed: Type.Boolean(),
});
export type CreateOrderResponse = Static<typeof CreateOrderResponseSchema>;

export const CancelOrderResponseSchema = Type.Object({
  order: OrderDtoSchema,
  alreadyCancelled: Type.Boolean(),
});
export type CancelOrderResponse = Static<typeof CancelOrderResponseSchema>;

export const ProductDtoSchema = Type.Object({
  sku: Type.String(),
  name: Type.String(),
  pricePaise: Type.Integer(),
  totalStock: Type.Integer(),
  availableStock: Type.Integer(),
  reservedStock: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ProductDto = Static<typeof ProductDtoSchema>;

export const ProductListResponseSchema = Type.Object({
  products: Type.Array(ProductDtoSchema),
});
export type ProductListResponse = Static<typeof ProductListResponseSchema>;

export const ProductDetailDtoSchema = Type.Object({
  product: ProductDtoSchema,
  ledger: Type.Array(LedgerEntryDtoSchema),
});
export type ProductDetailDto = Static<typeof ProductDetailDtoSchema>;

export const ListOrdersQuerySchema = Type.Object({
  status: Type.Optional(OrderStatusSchema),
  customerId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  sku: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type ListOrdersQuery = Static<typeof ListOrdersQuerySchema>;

export const ListOrdersResponseSchema = Type.Object({
  orders: Type.Array(OrderDtoSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});
export type ListOrdersResponse = Static<typeof ListOrdersResponseSchema>;

export const OrderIdParamsSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
});
export type OrderIdParams = Static<typeof OrderIdParamsSchema>;

export const IdempotencyKeyParamsSchema = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 128 }),
});
export type IdempotencyKeyParams = Static<typeof IdempotencyKeyParamsSchema>;

export const SkuParamsSchema = Type.Object({
  sku: Type.String({ minLength: 1, maxLength: 64 }),
});
export type SkuParams = Static<typeof SkuParamsSchema>;

export const ProductDetailQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type ProductDetailQuery = Static<typeof ProductDetailQuerySchema>;

export const PoolStatsDtoSchema = Type.Object({
  totalCount: Type.Integer(),
  idleCount: Type.Integer(),
  waitingCount: Type.Integer(),
});
export type PoolStatsDto = Static<typeof PoolStatsDtoSchema>;

export const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  database: Type.Literal('connected'),
  dbLatencyMs: Type.Number(),
  pool: PoolStatsDtoSchema,
  timestamp: Type.String(),
});
export type HealthResponse = Static<typeof HealthResponseSchema>;

export const StockShortageDtoSchema = Type.Object({
  sku: Type.String(),
  requested: Type.Integer(),
  available: Type.Integer(),
});
export type StockShortageDto = Static<typeof StockShortageDtoSchema>;

export const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.Integer({ minimum: 1000 }),
    message: Type.String(),
    details: Type.Optional(
      Type.Object({
        shortages: Type.Optional(Type.Array(StockShortageDtoSchema)),
        missingSkus: Type.Optional(Type.Array(Type.String())),
        duplicateSkus: Type.Optional(Type.Array(Type.String())),
        idempotencyKey: Type.Optional(Type.String()),
      }),
    ),
  }),
});
export type ErrorResponse = Static<typeof ErrorResponseSchema>;
