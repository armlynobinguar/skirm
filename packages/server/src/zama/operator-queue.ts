// One transaction at a time for an operator account. Settlement, predictions and the private ladder all
// send from ZAMA_OPERATOR_PRIVATE_KEY in the realtime process; sent side by side they would pick the
// same nonce and one would be dropped. Every sender of one account shares one queue here. (Another
// process using the same key, such as the benchmark worker, is not covered: give it its own key.)

/** How long one send may hold the queue; a transaction stuck longer no longer blocks the others. */
export const OPERATOR_SLOT_MS = 180_000;

export class OperatorQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly slotMs = OPERATOR_SLOT_MS) {}

  /** Runs `fn` (send and wait for the receipt) once the sends before it are done or timed out. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const out = this.tail.then(fn);
    const done = out.then(
      () => undefined,
      () => undefined,
    );
    // The slot's clock starts when the send does.
    this.tail = this.tail.then(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.slotMs);
        timer.unref?.();
      });
      return Promise.race([done, limit]).finally(() => clearTimeout(timer));
    });
    return out;
  }
}

const queues = new Map<string, OperatorQueue>();

/** The queue of an operator account (by address, any case), the same one for every caller in the process. */
export function operatorQueue(address: string): OperatorQueue {
  const key = address.toLowerCase();
  let q = queues.get(key);
  if (!q) queues.set(key, (q = new OperatorQueue()));
  return q;
}
