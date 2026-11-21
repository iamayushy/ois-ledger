const KEY_PREFIX = 'op-';
const TOKEN_LENGTH = 12;

export function generateIdempotencyKey(): string {
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replaceAll('-', '').slice(0, TOKEN_LENGTH)
      : Math.random().toString(36).slice(2, 2 + TOKEN_LENGTH);
  return `${KEY_PREFIX}${token}`;
}
