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
  { sku: 'SKU-LAPTOP-M4', name: 'MacBook Pro 14-inch M4 Pro', pricePaise: 19990000, totalStock: 2 },
  { sku: 'SKU-PHONE-S25', name: 'Galaxy S25 Ultra 512GB', pricePaise: 14199900, totalStock: 1 },
  { sku: 'SKU-TAB-AIR', name: 'iPad Air 11-inch M3', pricePaise: 5990000, totalStock: 6 },
  { sku: 'SKU-WATCH-U2', name: 'Apple Watch Ultra 2', pricePaise: 8990000, totalStock: 1 },
  { sku: 'SKU-BUDS-PRO', name: 'Sony WF-1000XM5 Earbuds', pricePaise: 2499000, totalStock: 18 },
  { sku: 'SKU-HEAD-XM6', name: 'Sony WH-1000XM6 Headphones', pricePaise: 3499000, totalStock: 9 },
  { sku: 'SKU-SSD-4TB', name: 'Samsung 990 Pro NVMe SSD 4TB', pricePaise: 2849900, totalStock: 14 },
  { sku: 'SKU-RAM-64', name: 'Corsair Vengeance DDR5 64GB Kit', pricePaise: 1899900, totalStock: 12 },
  { sku: 'SKU-CPU-9950', name: 'AMD Ryzen 9 9950X3D', pricePaise: 6499900, totalStock: 3 },
  { sku: 'SKU-PSU-1000', name: 'Corsair RM1000x Shift PSU', pricePaise: 1749900, totalStock: 7 },
  { sku: 'SKU-CAM-4K', name: 'Logitech Brio 4K Webcam', pricePaise: 1399900, totalStock: 20 },
  { sku: 'SKU-MIC-SM7', name: 'Shure SM7dB Microphone', pricePaise: 4999900, totalStock: 4 },
  { sku: 'SKU-CHAIR-AERON', name: 'Herman Miller Aeron Chair', pricePaise: 15999900, totalStock: 1 },
  { sku: 'SKU-DESK-UP', name: 'Uplift V2 Standing Desk', pricePaise: 6999900, totalStock: 5 },
  { sku: 'SKU-ROUTER-W7', name: 'TP-Link Deco BE85 Wi-Fi 7 Mesh', pricePaise: 4499900, totalStock: 8 },
  { sku: 'SKU-NAS-4BAY', name: 'Synology DS923+ 4-Bay NAS', pricePaise: 5799900, totalStock: 2 },
  { sku: 'SKU-HDD-20TB', name: 'Seagate IronWolf Pro 20TB', pricePaise: 3299900, totalStock: 16 },
  { sku: 'SKU-UPS-1500', name: 'APC Back-UPS Pro 1500VA', pricePaise: 2199900, totalStock: 0 },
  { sku: 'SKU-STREAM-DECK', name: 'Elgato Stream Deck MK.2', pricePaise: 1499900, totalStock: 11 },
  { sku: 'SKU-CONSOLE-PS5', name: 'PlayStation 5 Pro', pricePaise: 6499000, totalStock: 1 },
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
