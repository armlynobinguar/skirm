import { afterEach, describe, expect, it } from 'vitest';
import { CAM_KEY, readCamMode, writeCamMode } from './camPref';

afterEach(() => localStorage.clear());

describe('camera choice', () => {
  it('defaults to the chase cam and remembers the visor', () => {
    expect(readCamMode()).toBe('chase');
    writeCamMode('visor');
    expect(localStorage.getItem(CAM_KEY)).toBe('visor');
    expect(readCamMode()).toBe('visor');
    writeCamMode('chase');
    expect(readCamMode()).toBe('chase');
  });

  it('ignores junk and storage that throws', () => {
    localStorage.setItem(CAM_KEY, 'drone');
    expect(readCamMode()).toBe('chase');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readCamMode(broken)).toBe('chase');
    expect(() => writeCamMode('visor', broken)).not.toThrow();
    expect(readCamMode(null)).toBe('chase');
  });
});
