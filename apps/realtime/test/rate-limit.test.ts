// A client over MESSAGES_PER_WINDOW messages per window is told once and the rest are dropped
// before they queue.
import { describe, expect, it } from 'vitest';
import { MESSAGES_PER_WINDOW, RealtimeHub } from '../src/hub';
import { FakeSocket, makeDeps } from './helpers';

describe('realtime message rate', () => {
  it('handles the first MESSAGES_PER_WINDOW messages, then answers rate_limited once and drops the rest', async () => {
    const deps = await makeDeps();
    const hub = new RealtimeHub(deps);
    const sock = new FakeSocket();
    const c = hub.connect(sock);
    // Malformed messages are cheap to handle: each one answered bad_message while within the limit.
    for (let i = 0; i < MESSAGES_PER_WINDOW + 10; i++) void hub.message(c, 'not json');
    await hub.message(c, 'not json');
    const errors = sock.inbox.ofType('error').map((e) => e.code);
    expect(errors.filter((code) => code === 'bad_json')).toHaveLength(MESSAGES_PER_WINDOW);
    expect(errors.filter((code) => code === 'rate_limited')).toHaveLength(1);
    await hub.close();
  });
});
