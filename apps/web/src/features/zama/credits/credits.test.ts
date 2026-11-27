import { sepolia } from '@skirm/fhevm/generated';
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

  it('uses the Sepolia cSKIRM deployment by default', () => {
    // generated/index.ts holds the addresses packages/fhevm deployed to Sepolia (#125).
    expect(creditsAddress().toLowerCase()).toBe(sepolia.contracts.ConfidentialSkirmCredits?.toLowerCase());
  });
});
