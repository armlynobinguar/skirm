import { describe, expect, it } from 'vitest';
import { V2_MATCH_LAST_TTL_S, parseV2Channel, v2MatchChannel, v2MatchLastKey } from '../src/index';

describe('v2 match channels', () => {
  it('names the channel and the last-message key', () => {
    expect(v2MatchChannel('mat_1')).toBe('v2match:mat_1');
    expect(v2MatchLastKey('mat_1')).toBe('v2match:mat_1:last');
    expect(V2_MATCH_LAST_TTL_S).toBe(120);
  });

  it('parses only v2 match channels', () => {
    expect(parseV2Channel(v2MatchChannel('mat_1'))).toEqual({ id: 'mat_1' });
    expect(parseV2Channel(v2MatchLastKey('mat_1'))).toBeUndefined();
    expect(parseV2Channel('match:mat_1')).toBeUndefined();
    expect(parseV2Channel('v2match:')).toBeUndefined();
  });
});
