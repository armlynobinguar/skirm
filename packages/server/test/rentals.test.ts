// market.rent payment verification against a mocked NEAR RPC: the tx outcome and the market's
// `rental` event (rental id, owner, renter, amounts), plus the dev and composite verifiers.
import { describe, expect, it } from 'vitest';
import {
  CompositeRentalVerifier,
  DevRentalVerifier,
  NearRpc,
  RpcRentalVerifier,
  rentalCredits,
  type FetchLike,
} from '../src/index';

const NEAR = 10n ** 24n;
const TX = '9ZsxQKpXvjhxLqC3HKbNkYfgZPhMgMHbHnfRL4y2rT5e';
const MARKET = 'market.playskirm.testnet';
const OFFER = 'rof_01JB7Z3K9QX4M2T8V6N5R1C0DE';

function rpcWith(handler: (body: { method: string; params: any }) => { status?: number; body?: unknown }) {
  const calls: { method: string; params: any }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const r = handler(body);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  };
  return { rpc: new NearRpc(['https://rpc.example'], { fetch }), calls };
}

type RentTx = Partial<{
  receiver: string;
  signer: string;
  fail: boolean;
  executor: string | null;
  standard: string;
  rentalId: string;
  owner: string;
  renter: string;
  price: bigint;
  fee: bigint;
  proceeds: bigint;
  noEvent: boolean;
}>;

/** An EXPERIMENTAL_tx_status result of `market.rent` as the RPC returns it. */
function rentTx(o: RentTx = {}) {
  const price = o.price ?? NEAR;
  const fee = o.fee ?? price / 20n;
  const event = {
    standard: o.standard ?? 'skirm_market',
    version: '1.0.0',
    event: 'rental',
    data: [
      {
        rental_id: o.rentalId ?? `${OFFER}:n1`,
        owner: o.owner ?? 'oona.testnet',
        renter: o.renter ?? 'remy.testnet',
        price: price.toString(),
        fee: fee.toString(),
        fee_bps: 500,
        season_share: '0',
        treasury_share: fee.toString(),
        owner_proceeds: (o.proceeds ?? price - fee).toString(),
        refund: '0',
      },
    ],
  };
  const outcome: Record<string, unknown> = {
    status: o.fail ? { Failure: { ActionError: {} } } : { SuccessValue: '' },
    logs: o.noEvent ? [] : [`EVENT_JSON:${JSON.stringify(event)}`],
  };
  if (o.executor !== null) outcome.executor_id = o.executor ?? MARKET;
  return {
    status: o.fail ? { Failure: { ActionError: {} } } : { SuccessValue: '' },
    transaction: { hash: TX, signer_id: o.signer ?? 'remy.testnet', receiver_id: o.receiver ?? MARKET, actions: [] },
    transaction_outcome: { id: TX, outcome: { logs: [], status: { SuccessReceiptId: 'r1' } } },
    receipts_outcome: [{ id: 'r1', outcome }],
  };
}

const verifierFor = (tx: unknown) => new RpcRentalVerifier(rpcWith(() => ({ body: { result: tx } })).rpc, MARKET);

describe('RpcRentalVerifier', () => {
  it('reads the final tx outcome as the renter and returns the rental event', async () => {
    const { rpc, calls } = rpcWith(() => ({ body: { jsonrpc: '2.0', id: 'skirm', result: rentTx() } }));
    const payment = await new RpcRentalVerifier(rpc, MARKET).verify(TX, { renterId: 'remy.testnet' });
    expect(payment).toEqual({
      receipt: TX,
      rentalId: `${OFFER}:n1`,
      owner: 'oona.testnet',
      renter: 'remy.testnet',
      priceYocto: NEAR,
      feeYocto: NEAR / 20n,
      ownerProceedsYocto: NEAR - NEAR / 20n,
      dev: false,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'EXPERIMENTAL_tx_status',
        params: { tx_hash: TX, sender_account_id: 'remy.testnet', wait_until: 'FINAL' },
      }),
    ]);
  });

  it('refuses other contracts, signers, failed txs and missing or forged events', async () => {
    const check = (tx: unknown, code: string, renterId: string | null = 'remy.testnet', hash = TX) =>
      expect(verifierFor(tx).verify(hash, { renterId })).rejects.toMatchObject({ code });
    await check(rentTx({ receiver: 'evil.testnet' }), 'wrong_receiver');
    await check(rentTx({ signer: 'eve.testnet' }), 'wrong_sender');
    await check(rentTx({ renter: 'eve.testnet' }), 'wrong_sender');
    // A failed `rent` panics before paying anyone: the runtime refunds the deposit, no pass.
    await check(rentTx({ fail: true }), 'failed');
    await check(rentTx({ noEvent: true }), 'no_rental');
    // The event must be logged by the market itself, under its own standard.
    await check(rentTx({ executor: 'evil.testnet' }), 'no_rental');
    await check(rentTx({ executor: null }), 'no_rental');
    await check(rentTx({ standard: 'nep171' }), 'no_rental');
    await check(rentTx({ proceeds: 1n }), 'no_rental');
    await check(rentTx(), 'renter_required', null);
    await check(rentTx(), 'invalid_hash', 'remy.testnet', 'dev-ish');
  });

  it('maps RPC errors: unknown tx is not_found, every endpoint down is rpc_unavailable', async () => {
    const unknown = rpcWith(() => ({ body: { error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION' } } } }));
    await expect(new RpcRentalVerifier(unknown.rpc, MARKET).verify(TX, { renterId: 'remy.testnet' })).rejects.toMatchObject({ code: 'not_found' });
    const down = rpcWith(() => ({ status: 502 }));
    await expect(new RpcRentalVerifier(down.rpc, MARKET).verify(TX, { renterId: 'remy.testnet' })).rejects.toMatchObject({ code: 'rpc_unavailable' });
  });
});

describe('dev and composite rental verifiers', () => {
  it('dev hashes split at the default fee and are refused without the dev verifier', async () => {
    const dev = new DevRentalVerifier();
    expect(await dev.verify(`dev:${NEAR}:x`, { renterId: null })).toMatchObject({ priceYocto: NEAR, feeYocto: NEAR / 20n, dev: true });
    const prod = new CompositeRentalVerifier(verifierFor(rentTx()), undefined);
    await expect(prod.verify(`dev:${NEAR}`, { renterId: 'remy.testnet' })).rejects.toMatchObject({ code: 'dev_disabled' });
    expect((await prod.verify(TX, { renterId: 'remy.testnet' })).rentalId).toBe(`${OFFER}:n1`);
  });
});

describe('rentalCredits', () => {
  it('prices a rental in whole credits, rounding up, with the 5% fee rounded down', () => {
    expect(rentalCredits(NEAR, 1000)).toEqual({ priceCredits: 1000, feeCredits: 50, ownerCredits: 950 });
    expect(rentalCredits(NEAR / 2n + 1n, 1000)).toEqual({ priceCredits: 501, feeCredits: 25, ownerCredits: 476 });
    // Anything above zero costs at least one credit (all of it to the owner below 20 credits' fee).
    expect(rentalCredits(1n, 1000)).toEqual({ priceCredits: 1, feeCredits: 0, ownerCredits: 1 });
  });
});
