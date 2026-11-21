import { v7, validate } from 'uuid';

export function generateUuidV7(): string {
  return v7();
}

export function isValidUuid(value: string): boolean {
  return validate(value);
}
