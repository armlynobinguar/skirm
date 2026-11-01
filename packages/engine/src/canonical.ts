// Canonical JSON (Spec §5): object keys sorted, no spaces, UTF-8. Used for every hashed object.
import { sha256Hex } from './sha256';

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return (
          '[' + value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']'
        );
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

/** SHA-256 (hex) of the canonical JSON of `value`. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export { sha256Hex };
