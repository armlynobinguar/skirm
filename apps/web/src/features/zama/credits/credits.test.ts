import { describe, expect, it } from 'vitest';
import { creditsAddress, formatWait, shortAddress } from './credits';

describe('cSKIRM helpers', () => {
  it('formats the faucet cooldown', () => {
    expect(formatWait(100, 100)).toBeNull();
    expect(formatWait(100, 200)).toBeNull();
    expect(formatWait(145, 100)).toBe('45s');
    expect(formatWait(100 + 12 * 60, 100)).toBe('12m');
    expect(formatWait(3 * 3600 + 20 * 60, 0)).toBe('3h 20m');
    expect(formatWait(2 * 3600, 0)).toBe('2h');
  });

  it('shortens addresses', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    expect(shortAddress('0x12')).toBe('0x12');
  });

  it('explains when cSKIRM is not deployed', () => {
    // generated/index.ts has no Sepolia address until the contracts are deployed.
    expect(() => creditsAddress()).toThrow(/not deployed/);
  });
});
