import { describe, expect, it } from 'vitest';
import { canonicalizeOrderPayload, hashOrderPayload } from '../src/hash.js';
import { generateUuidV7 } from '../src/uuidv7.js';

const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateUuidV7', () => {
  it('produces valid RFC 9562 UUIDv7 strings', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateUuidV7()).toMatch(UUID_V7_REGEX);
    }
  });

  it('produces strictly monotonically increasing identifiers even within the same millisecond', () => {
    const generated: string[] = [];
    for (let i = 0; i < 5000; i += 1) {
      generated.push(generateUuidV7());
    }

    const unique = new Set(generated);
    expect(unique.size).toBe(5000);

    for (let i = 1; i < generated.length; i += 1) {
      expect((generated[i] ?? '') > (generated[i - 1] ?? '')).toBe(true);
    }
  });
});

describe('hashOrderPayload', () => {
  it('produces identical hashes regardless of item ordering or surrounding whitespace', () => {
    const first = hashOrderPayload({
      customerId: '  cust-42  ',
      items: [
        { sku: 'SKU-B', quantity: 2 },
        { sku: 'SKU-A', quantity: 1 },
      ],
    });

    const second = hashOrderPayload({
      customerId: 'cust-42',
      items: [
        { sku: ' SKU-A ', quantity: 1 },
        { sku: 'SKU-B', quantity: 2 },
      ],
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error('Expected valid hash results');
    }

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.requestHash).toHaveLength(64);
    expect(first.canonical.items).toEqual([
      { sku: 'SKU-A', quantity: 1 },
      { sku: 'SKU-B', quantity: 2 },
    ]);
  });

  it('produces distinct hashes when quantity, SKU, or customerId changes', () => {
    const baseline = hashOrderPayload({
      customerId: 'cust-1',
      items: [{ sku: 'SKU-A', quantity: 1 }],
    });
    const changedQty = hashOrderPayload({
      customerId: 'cust-1',
      items: [{ sku: 'SKU-A', quantity: 2 }],
    });
    const changedSku = hashOrderPayload({
      customerId: 'cust-1',
      items: [{ sku: 'SKU-B', quantity: 1 }],
    });
    const changedCustomer = hashOrderPayload({
      customerId: 'cust-2',
      items: [{ sku: 'SKU-A', quantity: 1 }],
    });

    expect(
      baseline.ok && changedQty.ok && changedSku.ok && changedCustomer.ok,
    ).toBe(true);

    if (!baseline.ok || !changedQty.ok || !changedSku.ok || !changedCustomer.ok) {
      throw new Error('Expected valid hash results');
    }

    expect(
      new Set([
        baseline.requestHash,
        changedQty.requestHash,
        changedSku.requestHash,
        changedCustomer.requestHash,
      ]).size,
    ).toBe(4);
  });

  it('returns duplicateSkus error result when duplicate SKUs appear after trimming', () => {
    const result = canonicalizeOrderPayload({
      customerId: 'cust-1',
      items: [
        { sku: 'SKU-A', quantity: 1 },
        { sku: ' SKU-A ', quantity: 2 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      duplicateSkus: ['SKU-A'],
    });
  });
});
