// Agent accounts' server side: account ids, key sealing in the vault, the env switch, the in-memory
// chain, and NearAgentAccounts against a stubbed near-api-js account (nothing reaches NEAR).
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentAccountError,
  agentAccountIdFor,
  createNearAdapters,
  loadConfig,
  LocalKeyWrapper,
  MemoryAgentAccounts,
  NearAgentAccounts,
  NearRpc,
  newAgentKeyPair,
  spendableOf,
  Vault,
  type AgentNearAccount,
} from '../src';

const PARENT_KEY = `ed25519:${'3'.repeat(60)}`;

describe('agent account ids and keys', () => {
  it('derives a lowercase sub-account of the parent', () => {
    expect(agentAccountIdFor('agt_01JB7Z3K9QX4M2T8V6N5R1C0DE', 'agents.playskirm.testnet')).toBe(
      'agt-01jb7z3k9qx4m2t8v6n5r1c0de.agents.playskirm.testnet',
    );
    expect(() => agentAccountIdFor('agt_01JB7Z3K9QX4M2T8V6N5R1C0DE', 'x'.repeat(40))).toThrow(/64/);
  });

  it('seals the key bound to its account, never in the clear', async () => {
    const vault = new Vault(new LocalKeyWrapper(new Uint8Array(randomBytes(32))));
    const { publicKey, secretKey } = newAgentKeyPair();
    expect(publicKey).toMatch(/^ed25519:/);
    const sealed = await vault.encryptSecret('agent-key:a.testnet', secretKey);
    expect(Buffer.from(sealed.ciphertext).toString('utf8')).not.toContain(secretKey.slice(8, 30));
    expect(await vault.decryptSecret('agent-key:a.testnet', sealed)).toBe(secretKey);
    await expect(vault.decryptSecret('agent-key:b.testnet', sealed)).rejects.toMatchObject({ code: 'tampered' });
    const flipped = { ...sealed, ciphertext: sealed.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b)) };
    await expect(vault.decryptSecret('agent-key:a.testnet', flipped)).rejects.toMatchObject({ code: 'tampered' });
  });
});

describe('agent accounts config', () => {
  it('is off unless parent and key are set together; errors never echo the key', () => {
    const off = loadConfig({});
    expect(off.AGENT_ACCOUNTS_PARENT).toBeUndefined();
    expect(createNearAdapters(off).agentAccounts).toBeUndefined();
    expect(() => loadConfig({ AGENT_ACCOUNTS_PARENT: 'agents.playskirm.testnet' })).toThrow(/set together/);
    let msg = '';
    try {
      loadConfig({ AGENT_ACCOUNTS_PARENT: 'agents.playskirm.testnet', AGENT_ACCOUNTS_PARENT_KEY: 'ed25519:not-a-key!' });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/AGENT_ACCOUNTS_PARENT_KEY/);
    expect(msg).not.toContain('not-a-key');
    const on = loadConfig({ AGENT_ACCOUNTS_PARENT: 'agents.playskirm.testnet', AGENT_ACCOUNTS_PARENT_KEY: PARENT_KEY });
    expect(createNearAdapters(on).agentAccounts?.kind).toBe('near');
  });
});

describe('MemoryAgentAccounts', () => {
  it('creates, funds, rents and transfers only with the right key', async () => {
    const chain = new MemoryAgentAccounts('agents.t');
    const k = newAgentKeyPair();
    await chain.create('a.agents.t', k.publicKey);
    await expect(chain.create('a.agents.t', k.publicKey)).rejects.toMatchObject({ code: 'exists' });
    chain.fund('a.agents.t', 2n * 10n ** 24n);
    const bal = (await chain.balance('a.agents.t'))!;
    expect(spendableOf(bal)).toBe(bal.totalYocto - bal.reservedYocto);
    const signer = { accountId: 'a.agents.t', secretKey: k.secretKey };
    const paid = await chain.rent(signer, { marketContract: 'm', rentalId: 'r:1', ownerId: 'o.t', priceYocto: 10n ** 24n });
    expect(paid.feeYocto + paid.ownerProceedsYocto).toBe(10n ** 24n);
    const wrong = { accountId: 'a.agents.t', secretKey: newAgentKeyPair().secretKey };
    await expect(chain.transfer(wrong, 'o.t', 1n)).rejects.toBeInstanceOf(AgentAccountError);
    await chain.transfer(signer, 'o.t', 1n);
    expect(chain.sent.map((s) => s.method)).toEqual(['rent', 'transfer']);
    expect(await chain.balance('nobody.agents.t')).toBeNull();
  });
});

describe('NearAgentAccounts (stubbed near-api-js)', () => {
  const ok = (hash: string, logs: string[] = [], executor = 'market.t') => ({
    status: { SuccessValue: '' },
    transaction: { hash },
    receipts_outcome: [{ outcome: { logs, executor_id: executor } }],
  });
  const rentalLog = (fee: string, proceeds: string) =>
    `EVENT_JSON:${JSON.stringify({ standard: 'skirm_market', event: 'rental', data: { fee, owner_proceeds: proceeds } })}`;

  function make(account: Partial<AgentNearAccount>, rpcCall?: (m: string, p: unknown) => Promise<unknown>) {
    const rpc = new NearRpc(['http://rpc.invalid']);
    if (rpcCall) vi.spyOn(rpc, 'call').mockImplementation(rpcCall as never);
    const built: { id: string; key: string }[] = [];
    const chain = new NearAgentAccounts('agents.t', PARENT_KEY, rpc, (id, key) => {
      built.push({ id, key });
      return account as AgentNearAccount;
    });
    return { chain, built };
  }

  it('creates with the parent key, rents with the agent key and reads the rental event', async () => {
    const createAccount = vi.fn(async () => ok('H1'));
    const callFunctionRaw = vi.fn(async () => ok('H2', [rentalLog('5', '95')]));
    const { chain, built } = make({ createAccount, callFunctionRaw } as never);
    expect(await chain.create('x.agents.t', 'ed25519:pub')).toEqual({ txHash: 'H1' });
    expect(built[0]).toEqual({ id: 'agents.t', key: PARENT_KEY });
    await expect(chain.create('x.other.t', 'ed25519:pub')).rejects.toBeInstanceOf(AgentAccountError);
    const paid = await chain.rent({ accountId: 'x.agents.t', secretKey: 'ed25519:agent' }, { marketContract: 'market.t', rentalId: 'r:1', ownerId: 'o.t', priceYocto: 100n });
    expect(paid).toEqual({ txHash: 'H2', feeYocto: 5n, ownerProceedsYocto: 95n });
    expect(built[1]).toEqual({ id: 'x.agents.t', key: 'ed25519:agent' });
    expect(callFunctionRaw).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: 'market.t', methodName: 'rent', deposit: 100n, args: { rental_id: 'r:1', owner_id: 'o.t', price: '100' } }),
    );
  });

  it('refuses a rental event from another contract, and keeps errors free of keys', async () => {
    const callFunctionRaw = vi.fn(async () => ok('H3', [rentalLog('5', '95')], 'evil.t'));
    const { chain } = make({ callFunctionRaw } as never);
    await expect(chain.rent({ accountId: 'x.agents.t', secretKey: 'ed25519:agent' }, { marketContract: 'market.t', rentalId: 'r', ownerId: 'o', priceYocto: 1n })).rejects.toMatchObject({ code: 'failed', txHash: 'H3' });
    const boom = make({
      transfer: vi.fn(async () => {
        throw Object.assign(new Error('ed25519:agent leaked?'), { name: 'TypedError' });
      }),
    } as never).chain;
    const err = await boom.transfer({ accountId: 'x.agents.t', secretKey: 'ed25519:agent' }, 'o.t', 1n).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'unavailable' });
    expect((err as Error).message).not.toContain('ed25519');
  });

  it('reads the balance through view_account', async () => {
    const { chain } = make({}, async () => ({ amount: '5000000000000000000000000', storage_usage: 182 }));
    const b = (await chain.balance('x.agents.t'))!;
    expect(b.totalYocto).toBe(5n * 10n ** 24n);
    expect(b.reservedYocto).toBe(182n * 10n ** 19n + 10n ** 22n);
  });
});
