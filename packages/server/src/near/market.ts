// Market transaction verification for the skill NFT market (contracts/market): a purchase
// (`market.buy({token_id})`, the market's NEP-297 `sale` event) and a listing (`skills.nft_approve(
// {token_id, account_id: market, msg: {"price"}})`, the market's `list` event). Reads the tx through
// RPC and checks it succeeded, was signed by the caller's linked account (directly or through skirm's
// relayer) and made the expected call on the expected token at the expected price. `dev:` hashes are
// handled by the api (AUTH_MODE=dev) and never reach this verifier.
import type { NearRpc } from './rpc';
import { callSucceeded, effectiveCall, eventsOf, NearRpcError, txStatusOf, type TxAction, type TxStatus } from './rpc';

export type MarketTxErrorCode =
  | 'invalid_hash'
  | 'account_required'
  | 'not_found'
  | 'failed'
  | 'wrong_receiver'
  | 'wrong_sender'
  | 'wrong_call'
  | 'wrong_token'
  | 'wrong_price'
  | 'rpc_unavailable';

export class MarketTxError extends Error {
  constructor(
    readonly code: MarketTxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MarketTxError';
  }
}

export interface MarketPurchase {
  /** Idempotency key (the tx hash). */
  receipt: string;
  tokenId: string;
  buyer: string;
  seller: string | null;
  /** The listing price the market charged (its `sale` event). */
  priceYocto: bigint;
}

export interface MarketTxVerifier {
  /** The market contract (receiver of `buy` and `delist`). */
  readonly marketContract: string;
  /** The skills NFT contract (receiver of `nft_approve` and `nft_revoke`). */
  readonly skillsContract: string;
  /** A successful `market.buy` of `tokenId` by `buyerId` with a `sale` event. */
  verifyPurchase(txHash: string, opts: { buyerId: string | null | undefined; tokenId: string }): Promise<MarketPurchase>;
  /** A successful `skills.nft_approve` of `tokenId` to the market at `priceYocto` with a `list` event. */
  verifyListing(
    txHash: string,
    opts: { sellerId: string | null | undefined; tokenId: string; priceYocto: string },
  ): Promise<{ receipt: string }>;
}

const TX_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const YOCTO_RE = /^[0-9]{1,40}$/;

function argsOf(a: TxAction | string): { method: string; args: Record<string, unknown> | null; deposit: string } | null {
  if (typeof a !== 'object' || !a.FunctionCall) return null;
  const f = a.FunctionCall;
  let args: Record<string, unknown> | null = null;
  if (typeof f.args === 'string' && f.args.length > 0) {
    try {
      const parsed = JSON.parse(Buffer.from(f.args, 'base64').toString('utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      args = null;
    }
  }
  return { method: f.method_name, args, deposit: String(f.deposit ?? '0') };
}

function eventData(tx: TxStatus, event: string, executor: string): Record<string, unknown>[] {
  return eventsOf(tx, 'skirm_market')
    .filter((e) => e.event === event && e.executor === executor)
    .flatMap((e) => (Array.isArray(e.data) ? e.data : [e.data]))
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object');
}

export class RpcMarketTxVerifier implements MarketTxVerifier {
  constructor(
    private readonly rpc: NearRpc,
    readonly marketContract: string,
    readonly skillsContract: string,
    /** Relayer accounts whose meta-transactions count as the player's own (docs/gasless.md). */
    private readonly relayers: readonly string[] = [],
  ) {}

  private async read(txHash: string, signer: string | null | undefined): Promise<{ tx: TxStatus; signer: string }> {
    if (!TX_RE.test(txHash)) throw new MarketTxError('invalid_hash', 'not a NEAR transaction hash');
    if (!signer) throw new MarketTxError('account_required', 'link a NEAR account first');
    try {
      return { tx: await txStatusOf(this.rpc, txHash, signer, this.relayers), signer };
    } catch (err) {
      if (err instanceof NearRpcError && err.code === 'not_found')
        throw new MarketTxError('not_found', 'transaction not found');
      if (err instanceof NearRpcError && err.code === 'unavailable')
        throw new MarketTxError('rpc_unavailable', 'NEAR RPC is unavailable, try again');
      throw new MarketTxError('not_found', 'transaction could not be read');
    }
  }

  async verifyPurchase(
    txHash: string,
    opts: { buyerId: string | null | undefined; tokenId: string },
  ): Promise<MarketPurchase> {
    const { tx, signer } = await this.read(txHash, opts.buyerId);
    const call = effectiveCall(tx, this.relayers);
    if (call.receiverId !== this.marketContract)
      throw new MarketTxError('wrong_receiver', 'transaction is not a call to the market contract');
    if (call.signerId !== signer) throw new MarketTxError('wrong_sender', 'transaction was signed by another account');
    if (!callSucceeded(tx, call)) throw new MarketTxError('failed', 'purchase transaction failed');
    const buys = call.actions.map(argsOf).filter((f) => f?.method === 'buy');
    if (!buys.some((f) => f?.args?.token_id === opts.tokenId))
      throw new MarketTxError('wrong_call', 'transaction does not call buy() for this token');
    // `buy` succeeds even when the NFT transfer fails (the market refunds and logs
    // purchase_failed), so only the market's own `sale` event proves the token changed hands.
    const sale = eventData(tx, 'sale', this.marketContract).find((d) => d.token_id === opts.tokenId);
    if (!sale) throw new MarketTxError('failed', 'the market recorded no sale of this token');
    if (sale.buyer !== signer) throw new MarketTxError('wrong_sender', 'the sale went to another account');
    const price = typeof sale.price === 'string' && YOCTO_RE.test(sale.price) ? BigInt(sale.price) : null;
    if (price === null) throw new MarketTxError('wrong_price', 'the sale event has no price');
    return {
      receipt: tx.transaction.hash || txHash,
      tokenId: opts.tokenId,
      buyer: signer,
      seller: typeof sale.seller === 'string' ? sale.seller : null,
      priceYocto: price,
    };
  }

  async verifyListing(
    txHash: string,
    opts: { sellerId: string | null | undefined; tokenId: string; priceYocto: string },
  ): Promise<{ receipt: string }> {
    const { tx, signer } = await this.read(txHash, opts.sellerId);
    const call = effectiveCall(tx, this.relayers);
    if (call.receiverId !== this.skillsContract)
      throw new MarketTxError('wrong_receiver', 'transaction is not a call to the skills contract');
    if (call.signerId !== signer) throw new MarketTxError('wrong_sender', 'transaction was signed by another account');
    if (!callSucceeded(tx, call)) throw new MarketTxError('failed', 'listing transaction failed');
    const approve = call.actions
      .map(argsOf)
      .find((f) => f?.method === 'nft_approve' && f.args?.token_id === opts.tokenId);
    if (!approve?.args) throw new MarketTxError('wrong_call', 'transaction does not call nft_approve() for this token');
    if (approve.args.account_id !== this.marketContract)
      throw new MarketTxError('wrong_call', 'the approval is not for the market contract');
    let msgPrice: unknown;
    try {
      msgPrice = (JSON.parse(String(approve.args.msg ?? '')) as { price?: unknown }).price;
    } catch {
      msgPrice = undefined;
    }
    if (msgPrice !== opts.priceYocto) throw new MarketTxError('wrong_price', 'the approval lists another price');
    // The market's `list` event: nft_on_approve accepted it (the token's owner, at this price).
    const listed = eventData(tx, 'list', this.marketContract).find((d) => d.token_id === opts.tokenId);
    if (!listed) throw new MarketTxError('failed', 'the market did not record the listing');
    if (listed.seller !== signer) throw new MarketTxError('wrong_sender', 'the listing belongs to another account');
    if (listed.price !== opts.priceYocto) throw new MarketTxError('wrong_price', 'the market listed another price');
    return { receipt: tx.transaction.hash || txHash };
  }
}
