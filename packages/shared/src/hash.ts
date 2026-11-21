import { createHash } from 'node:crypto';

export interface RawOrderItemInput {
  readonly sku: string;
  readonly quantity: number;
}

export interface RawOrderPayloadInput {
  readonly customerId: string;
  readonly items: readonly RawOrderItemInput[];
}

export interface NormalizedOrderItem {
  readonly sku: string;
  readonly quantity: number;
}

export interface CanonicalOrderPayload {
  readonly customerId: string;
  readonly items: readonly NormalizedOrderItem[];
}

export type CanonicalizeOrderResult =
  | {
      readonly ok: true;
      readonly canonical: CanonicalOrderPayload;
    }
  | {
      readonly ok: false;
      readonly duplicateSkus: readonly string[];
    };

export type HashOrderResult =
  | {
      readonly ok: true;
      readonly canonical: CanonicalOrderPayload;
      readonly requestHash: string;
    }
  | {
      readonly ok: false;
      readonly duplicateSkus: readonly string[];
    };

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function canonicalizeOrderPayload(
  input: RawOrderPayloadInput,
): CanonicalizeOrderResult {
  const customerId = input.customerId.trim();
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const normalized: NormalizedOrderItem[] = [];

  for (const item of input.items) {
    const sku = item.sku.trim();
    if (seen.has(sku)) {
      duplicates.add(sku);
    } else {
      seen.add(sku);
      normalized.push({ sku, quantity: item.quantity });
    }
  }

  if (duplicates.size > 0) {
    return {
      ok: false,
      duplicateSkus: [...duplicates].sort(compareAscii),
    };
  }

  normalized.sort((a, b) => compareAscii(a.sku, b.sku));

  return {
    ok: true,
    canonical: {
      customerId,
      items: normalized,
    },
  };
}

export function hashCanonicalOrderPayload(payload: CanonicalOrderPayload): string {
  const serialized = JSON.stringify({
    customerId: payload.customerId,
    items: payload.items.map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
    })),
  });
  return createHash('sha256').update(serialized).digest('hex');
}

export function hashOrderPayload(input: RawOrderPayloadInput): HashOrderResult {
  const result = canonicalizeOrderPayload(input);
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    canonical: result.canonical,
    requestHash: hashCanonicalOrderPayload(result.canonical),
  };
}
