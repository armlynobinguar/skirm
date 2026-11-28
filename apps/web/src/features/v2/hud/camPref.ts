// The camera the viewer last picked for watching one agent (the 3D chase cam or the visor), per
// browser in localStorage. Every access is in try/catch: private mode or blocked storage just
// forgets the choice.
import type { CamMode } from '@/features/arena/chase3d';

export const CAM_KEY = 'skirm.cam.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browser(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readCamMode(store: Store | null = browser()): CamMode {
  try {
    return store?.getItem(CAM_KEY) === 'visor' ? 'visor' : 'chase';
  } catch {
    return 'chase';
  }
}

export function writeCamMode(mode: CamMode, store: Store | null = browser()): void {
  try {
    store?.setItem(CAM_KEY, mode);
  } catch {
    // Full or blocked storage: the choice lasts this page only.
  }
}
