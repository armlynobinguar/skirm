// What a confidential action is waiting for, for the whole app: the encrypt, wallet, transaction and
// decrypt helpers in lib/zama report here, and features/zama/progress draws it. Screens do nothing.
//
// Relayer calls (encrypting needs its proof checked, decrypting goes to the KMS) retry on their own
// when the relayer or the network fails, then ask the player through the progress panel. A wallet
// request or a transaction is never repeated here: that could send it twice.
export type ZamaStep = 'encrypt' | 'sign' | 'confirm' | 'decrypt';
export const ZAMA_STEPS: readonly ZamaStep[] = ['encrypt', 'sign', 'confirm', 'decrypt'];

export interface ZamaProgressState {
  /** The steps running now (several when actions overlap), oldest first. */
  active: readonly ZamaStep[];
  /** Steps finished since the panel was last idle. */
  done: readonly ZamaStep[];
  /** The automatic retry under way (1-based), or 0. */
  retry: number;
  /** A relayer call that kept failing: the player picks. */
  failed: { step: ZamaStep; retry(): void; giveUp(): void } | null;
}

const IDLE: ZamaProgressState = { active: [], done: [], retry: 0, failed: null };
/** How long the finished steps stay on screen once nothing runs. */
export const STEPS_LINGER_MS = 2_500;
/** Waits before the automatic relayer retries. */
export const RELAYER_RETRY_MS: readonly number[] = [1_000, 3_000];
/** An unanswered "Try again" gives up after this long. */
export const RELAYER_ASK_MS = 60_000;

let state = IDLE;
const listeners = new Set<() => void>();
const running: { id: number; step: ZamaStep }[] = [];
let nextId = 1;
let linger: ReturnType<typeof setTimeout> | undefined;

function set(patch: Partial<ZamaProgressState>) {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
}

export const zamaProgress = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  get: (): ZamaProgressState => state,
  serverState: (): ZamaProgressState => IDLE,
};

/** Runs `fn` as `step`. */
export async function trackStep<T>(step: ZamaStep, fn: () => Promise<T>): Promise<T> {
  const id = nextId++;
  clearTimeout(linger);
  running.push({ id, step });
  set({ active: running.map((r) => r.step) });
  let ok = false;
  try {
    const out = await fn();
    ok = true;
    return out;
  } finally {
    running.splice(
      running.findIndex((r) => r.id === id),
      1,
    );
    set({ active: running.map((r) => r.step), ...(ok && !state.done.includes(step) ? { done: [...state.done, step] } : {}) });
    if (!running.length) linger = setTimeout(() => set(IDLE), ok ? STEPS_LINGER_MS : 0);
  }
}

/** Whether an error looks like the relayer or the network failing, not a refusal that would repeat. */
export function isRelayerOutage(e: unknown): boolean {
  if ((e as { code?: unknown } | null)?.code === 4001) return false;
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /failed to fetch|fetch failed|networkerror|network error|timed? ?out|load failed|econn|\b(429|500|502|503|504)\b|bad gateway|service unavailable/i.test(text);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Asks the player; false at once when no panel is mounted to ask with, or another call is asking. */
function askRetry(step: ZamaStep): Promise<boolean> {
  if (!listeners.size || state.failed) return Promise.resolve(false);
  return new Promise((resolve) => {
    const answer = (again: boolean) => {
      clearTimeout(timer);
      set({ failed: null });
      resolve(again);
    };
    const timer = setTimeout(() => answer(false), RELAYER_ASK_MS);
    set({ failed: { step, retry: () => answer(true), giveUp: () => answer(false) } });
  });
}

/** A relayer call as `step`: retried on an outage, then again for as long as the player asks. */
export function trackRelayer<T>(step: ZamaStep, fn: () => Promise<T>, waits: readonly number[] = RELAYER_RETRY_MS): Promise<T> {
  return trackStep(step, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await fn();
        if (state.retry) set({ retry: 0 });
        return out;
      } catch (e) {
        if (!isRelayerOutage(e)) throw e;
        if (attempt < waits.length) {
          set({ retry: attempt + 1 });
          await sleep(waits[attempt]!);
          continue;
        }
        set({ retry: 0 });
        if (!(await askRetry(step))) throw e;
      }
    }
  });
}

/** Sends a transaction (the wallet asks) and waits for it; returns the transaction and its receipt. */
export async function trackTx<T extends { wait(): Promise<unknown> }>(send: () => Promise<T>): Promise<{ tx: T; receipt: Awaited<ReturnType<T['wait']>> }> {
  const tx = await trackStep('sign', send);
  const receipt = (await trackStep('confirm', () => tx.wait())) as Awaited<ReturnType<T['wait']>>;
  return { tx, receipt };
}

/** Back to idle (tests). */
export function resetZamaProgress(): void {
  clearTimeout(linger);
  running.length = 0;
  set(IDLE);
}
