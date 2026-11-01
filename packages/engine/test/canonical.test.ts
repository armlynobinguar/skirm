// Canonical JSON and SHA-256 (the hashing every v2 log uses).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalJson, sha256Hex } from '../src';

describe('hashing', () => {
  it('sha256 matches node:crypto', () => {
    for (const s of [
      '',
      'abc',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(64),
      'é漢🙂'.repeat(50),
      'x'.repeat(100000),
    ]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });

  it('canonical JSON sorts keys recursively, has no spaces and refuses non-finite numbers', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: null, y: 'é' }], c: true } })).toBe(
      '{"a":{"c":true,"d":[1,{"y":"é","z":null}]},"b":1}',
    );
    expect(canonicalJson({ a: undefined, b: 0.5 })).toBe('{"b":0.5}');
    expect(canonicalJson([1, undefined])).toBe('[1,null]');
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson({ a: Infinity })).toThrow();
  });

  it('canonicalHash is the sha256 of the canonical JSON, so key order does not change it', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(sha256Hex('{"a":1,"b":2}'));
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it('the package root exports the v2 engine', async () => {
    const root = await import('../src');
    const v2 = await import('../src/v2');
    expect(root.createMatch).toBe(v2.createMatch);
    expect(root.MAPS_V2).toBe(v2.MAPS_V2);
  });
});
