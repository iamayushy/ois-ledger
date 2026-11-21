import { sql } from 'drizzle-orm';
import { hashOrderPayload } from '@ois/shared/hash';
import type { OrderDto } from '@ois/shared/schemas';
import { generateUuidV7 } from '@ois/shared/uuidv7';
import type { OisDatabase } from './client.js';
import {
  idempotencyKey,
  inventoryLedger,
  orderItem,
  product,
  reservationOrder,
} from './schema.js';

interface SeedProductSpec {
  readonly sku: string;
  readonly name: string;
  readonly pricePaise: number;
  readonly totalStock: number;
}

const SEED_PRODUCTS: readonly SeedProductSpec[] = [
  {
    sku: 'SKU-GPU-5090',
    name: 'RTX 5090 Founders Edition',
    pricePaise: 19999900,
    totalStock: 1,
  },
  {
    sku: 'SKU-KB-75',
    name: 'Keychron Q1 Pro Mechanical Keyboard',
    pricePaise: 1799900,
    totalStock: 3,
  },
  {
    sku: 'SKU-MON-4K',
    name: 'ProArt 27-inch 4K OLED Monitor',
    pricePaise: 7499900,
    totalStock: 10,
  },
  {
    sku: 'SKU-MOUSE-PRO',
    name: 'Logitech G Pro X Superlight 2',
    pricePaise: 1399500,
    totalStock: 25,
  },
  {
    sku: 'SKU-DOCK-TB4',
    name: 'CalDigit TS4 Thunderbolt 4 Dock',
    pricePaise: 3499900,
    totalStock: 5,
  },
  {
    sku: 'SKU-CABLE-USB4',
    name: 'Anker USB4 Braided Cable 240W',
    pricePaise: 249900,
    totalStock: 0,
  },
];

export interface SeedResult {
  readonly seeded: boolean;
  readonly productCount: number;
  readonly orderCount: number;
}

function mustHashPayload(payload: {
  readonly customerId: string;
  readonly items: readonly { readonly sku: string; readonly quantity: number }[];
}): string {
  const result = hashOrderPayload(payload);
  if (!result.ok) {
    throw new Error(`Invalid seed payload with duplicate SKUs: ${result.duplicateSkus.join(', ')}`);
  }
  return result.requestHash;
}

export async function seedDatabase(db: OisDatabase): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ sku: product.sku })
      .from(product)
      .limit(1);

    if (existing.length > 0) {
      return {
        seeded: false,
        productCount: 0,
        orderCount: 0,
      };
    }

    const baseTime = new Date(Date.now() - 10 * 60 * 1000);
    const activeOrderTime = new Date(Date.now() - 5 * 60 * 1000);
    const cancelledOrderCreateTime = new Date(Date.now() - 3 * 60 * 1000);
    const cancelledOrderCancelTime = new Date(Date.now() - 2 * 60 * 1000);

    await tx.insert(product).values(
      SEED_PRODUCTS.map((item) => {
        if (item.sku === 'SKU-MON-4K') {
          return {
            sku: item.sku,
            name: item.name,
            pricePaise: item.pricePaise,
            totalStock: item.totalStock,
            availableStock: item.totalStock - 1,
            reservedStock: 1,
            createdAt: baseTime,
            updatedAt: activeOrderTime,
          };
        }
        if (item.sku === 'SKU-MOUSE-PRO') {
          return {
            sku: item.sku,
            name: item.name,
            pricePaise: item.pricePaise,
            totalStock: item.totalStock,
            availableStock: item.totalStock - 2,
            reservedStock: 2,
            createdAt: baseTime,
            updatedAt: activeOrderTime,
          };
        }
        return {
          sku: item.sku,
          name: item.name,
          pricePaise: item.pricePaise,
          totalStock: item.totalStock,
          availableStock: item.totalStock,
          reservedStock: 0,
          createdAt: baseTime,
          updatedAt: item.sku === 'SKU-DOCK-TB4' ? cancelledOrderCancelTime : baseTime,
        };
      }),
    );

    await tx.insert(inventoryLedger).values(
      SEED_PRODUCTS.map((item) => ({
        sku: item.sku,
        orderId: null,
        idempotencyKey: null,
        eventType: 'SEED',
        delta: item.totalStock,
        availableAfter: item.totalStock,
        reservedAfter: 0,
        createdAt: baseTime,
      })),
    );

    const activeOrderId = generateUuidV7();
    const activeKey = 'seed-order-active-001';
    const activePayload = {
      customerId: 'cust-acme-01',
      items: [
        { sku: 'SKU-MON-4K', quantity: 1 },
        { sku: 'SKU-MOUSE-PRO', quantity: 2 },
      ],
    };
    const activeHash = mustHashPayload(activePayload);
    const activeTotalPaise = 7499900 * 1 + 1399500 * 2;
    const activeOrderDto: OrderDto = {
      id: activeOrderId,
      idempotencyKey: activeKey,
      customerId: activePayload.customerId,
      status: 'RESERVED',
      totalPaise: activeTotalPaise,
      createdAt: activeOrderTime.toISOString(),
      cancelledAt: null,
      items: [
        {
          sku: 'SKU-MON-4K',
          productName: 'ProArt 27-inch 4K OLED Monitor',
          quantity: 1,
          unitPricePaise: 7499900,
        },
        {
          sku: 'SKU-MOUSE-PRO',
          productName: 'Logitech G Pro X Superlight 2',
          quantity: 2,
          unitPricePaise: 1399500,
        },
      ],
    };

    const cancelledOrderId = generateUuidV7();
    const cancelledKey = 'seed-order-cancelled-002';
    const cancelledPayload = {
      customerId: 'cust-globex-02',
      items: [{ sku: 'SKU-DOCK-TB4', quantity: 1 }],
    };
    const cancelledHash = mustHashPayload(cancelledPayload);
    const cancelledTotalPaise = 3499900;
    const cancelledOrderCreationDto: OrderDto = {
      id: cancelledOrderId,
      idempotencyKey: cancelledKey,
      customerId: cancelledPayload.customerId,
      status: 'RESERVED',
      totalPaise: cancelledTotalPaise,
      createdAt: cancelledOrderCreateTime.toISOString(),
      cancelledAt: null,
      items: [
        {
          sku: 'SKU-DOCK-TB4',
          productName: 'CalDigit TS4 Thunderbolt 4 Dock',
          quantity: 1,
          unitPricePaise: 3499900,
        },
      ],
    };

    await tx.insert(reservationOrder).values([
      {
        id: activeOrderId,
        idempotencyKey: activeKey,
        customerId: activePayload.customerId,
        status: 'RESERVED',
        totalPaise: activeTotalPaise,
        createdAt: activeOrderTime,
        cancelledAt: null,
      },
      {
        id: cancelledOrderId,
        idempotencyKey: cancelledKey,
        customerId: cancelledPayload.customerId,
        status: 'CANCELLED',
        totalPaise: cancelledTotalPaise,
        createdAt: cancelledOrderCreateTime,
        cancelledAt: cancelledOrderCancelTime,
      },
    ]);

    await tx.insert(orderItem).values([
      {
        orderId: activeOrderId,
        sku: 'SKU-MON-4K',
        quantity: 1,
        unitPricePaise: 7499900,
        createdAt: activeOrderTime,
      },
      {
        orderId: activeOrderId,
        sku: 'SKU-MOUSE-PRO',
        quantity: 2,
        unitPricePaise: 1399500,
        createdAt: activeOrderTime,
      },
      {
        orderId: cancelledOrderId,
        sku: 'SKU-DOCK-TB4',
        quantity: 1,
        unitPricePaise: 3499900,
        createdAt: cancelledOrderCreateTime,
      },
    ]);

    await tx.insert(idempotencyKey).values([
      {
        key: activeKey,
        requestHash: activeHash,
        status: 'COMPLETED',
        responseStatus: 201,
        responseBody: activeOrderDto,
        orderId: activeOrderId,
        createdAt: activeOrderTime,
        updatedAt: activeOrderTime,
      },
      {
        key: cancelledKey,
        requestHash: cancelledHash,
        status: 'COMPLETED',
        responseStatus: 201,
        responseBody: cancelledOrderCreationDto,
        orderId: cancelledOrderId,
        createdAt: cancelledOrderCreateTime,
        updatedAt: cancelledOrderCreateTime,
      },
    ]);

    await tx.insert(inventoryLedger).values([
      {
        sku: 'SKU-MON-4K',
        orderId: activeOrderId,
        idempotencyKey: activeKey,
        eventType: 'RESERVE',
        delta: -1,
        availableAfter: 9,
        reservedAfter: 1,
        createdAt: activeOrderTime,
      },
      {
        sku: 'SKU-MOUSE-PRO',
        orderId: activeOrderId,
        idempotencyKey: activeKey,
        eventType: 'RESERVE',
        delta: -2,
        availableAfter: 23,
        reservedAfter: 2,
        createdAt: activeOrderTime,
      },
      {
        sku: 'SKU-DOCK-TB4',
        orderId: cancelledOrderId,
        idempotencyKey: cancelledKey,
        eventType: 'RESERVE',
        delta: -1,
        availableAfter: 4,
        reservedAfter: 1,
        createdAt: cancelledOrderCreateTime,
      },
      {
        sku: 'SKU-DOCK-TB4',
        orderId: cancelledOrderId,
        idempotencyKey: cancelledKey,
        eventType: 'RELEASE',
        delta: 1,
        availableAfter: 5,
        reservedAfter: 0,
        createdAt: cancelledOrderCancelTime,
      },
    ]);

    return {
      seeded: true,
      productCount: SEED_PRODUCTS.length,
      orderCount: 2,
    };
  });
}

export async function truncateAllTables(db: OisDatabase): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE inventory_ledger, idempotency_key, order_item, reservation_order, product RESTART IDENTITY CASCADE`,
  );
}
