// Creates playskirm.testnet and its contract sub-accounts (skills, market, registry, deposits, seasons,
// ops), deploys the CI-built wasm (the `contracts-wasm` artifact) and initializes each contract.
// Idempotent: existing accounts, code and initialized contracts are skipped. Every key is written to
// ~/.near-credentials/testnet/<account>.json (NEAR CLI legacy keychain) BEFORE its account exists.
// Testnet only: the root is funded by the testnet faucet.
//
// `--fresh <name,...>` deletes the named contract sub-accounts first (their balance goes back to the
// root) and recreates them, so a contract whose state layout changed is deployed and
// initialized from scratch. Its onchain state is gone: listings, records, ratings.
//
//   gh run download <ci run id> -n contracts-wasm -D /tmp/wasm
//   npx tsx scripts/deploy-testnet-contracts.ts /tmp/wasm
//   npx tsx scripts/deploy-testnet-contracts.ts /tmp/wasm --fresh market,registry
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = 'playskirm.testnet';
const OPS = `ops.${ROOT}`;
const SEASONS = `seasons.${ROOT}`;
const STARTER_SKILL_ID = 'skl_01JB7Z3K9QX4M2T8V6N5R1C0DE';
const RPC = 'https://test.rpc.fastnear.com';
const FAUCET = 'https://helper.nearprotocol.com/account';
const NEAR = 10n ** 24n;
const near = (n: number) => (BigInt(Math.round(n * 100)) * NEAR) / 100n;

// Sub-accounts and their starting balance; the ones with a wasm are deployed and initialized below.
const SUBS: [string, number][] = [
  ['skills', 5],
  ['market', 4],
  ['registry', 3.5],
  ['deposits', 3],
  ['seasons', 3],
  ['ops', 1],
];
// Seasons comes before market: the market sends 30% of each fee to `seasons.fund`.
const INITS: [string, Record<string, unknown>][] = [
  ['skills', { owner_id: ROOT, ops_id: OPS, metadata: null, account_bound_skill_ids: [STARTER_SKILL_ID] }],
  ['seasons', { owner_id: ROOT, ops_id: OPS }],
  [
    'market',
    { owner_id: ROOT, nft_contract_id: `skills.${ROOT}`, treasury_id: ROOT, fee_bps: 500, governance_id: ROOT, season_pool_id: SEASONS },
  ],
  ['registry', { owner_id: ROOT, ops_id: OPS }],
  ['deposits', { owner_id: ROOT, treasury_id: ROOT, min_deposit: null }],
];

function parseArgs(argv: string[]): { wasm: string; fresh: string[] } {
  let wasm: string | undefined;
  let fresh: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fresh') {
      fresh = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!fresh.length) throw new Error('--fresh needs a comma-separated list of contracts');
    } else wasm = argv[i];
  }
  if (!wasm) throw new Error('usage: deploy-testnet-contracts.ts <wasm dir> [--fresh <name,...>]');
  const known = INITS.map(([name]) => name);
  const unknown = fresh.filter((n) => !known.includes(n));
  if (unknown.length) throw new Error(`--fresh: unknown contract ${unknown.join(', ')} (one of ${known.join(', ')})`);
  return { wasm, fresh };
}

const { wasm: WASM, fresh: FRESH } = parseArgs(process.argv.slice(2));
const provider = new JsonRpcProvider({ url: RPC });
const credDir = join(homedir(), '.near-credentials', 'testnet');
mkdirSync(credDir, { recursive: true });

function keyFor(accountId: string): KeyPairString {
  const file = join(credDir, `${accountId}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).private_key as KeyPairString;
  const kp = KeyPair.fromRandom('ed25519');
  writeFileSync(
    file,
    JSON.stringify({ account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }),
    { mode: 0o600 },
  );
  return kp.toString() as KeyPairString;
}
const pub = (k: KeyPairString) => KeyPair.fromString(k).getPublicKey().toString();

async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId, finality: 'final' } as never);
    return true;
  } catch {
    return false;
  }
}

async function faucetAccount(accountId: string): Promise<void> {
  if (await exists(accountId)) return void console.log(`= ${accountId} exists`);
  const key = keyFor(accountId);
  const res = await fetch(FAUCET, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: pub(key) }),
  });
  if (!res.ok) throw new Error(`faucet ${accountId}: ${res.status} ${await res.text()}`);
  for (let i = 0; i < 20 && !(await exists(accountId)); i++) await new Promise((r) => setTimeout(r, 1500));
  console.log(`+ ${accountId} created by the faucet`);
}

const account = (id: string) => new Account(id, provider, keyFor(id));

/** True when the contract already has near-sdk's root `STATE` key, i.e. `new` ran before. */
async function initialized(id: string): Promise<boolean> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: { request_type: 'view_state', finality: 'final', account_id: id, prefix_base64: 'U1RBVEU=' },
    }),
  });
  const body = (await res.json()) as { result?: { values?: unknown[] }; error?: unknown };
  if (!body.result?.values) throw new Error(`view_state ${id}: ${JSON.stringify(body.error ?? body)}`);
  return body.result.values.length > 0;
}
const balance = async (id: string) => BigInt((await provider.viewAccount({ accountId: id, finality: 'final' } as never)).amount);
const fmt = (y: bigint) => `${(Number(y / 10n ** 21n) / 1000).toFixed(2)} NEAR`;

/** Deletes a contract sub-account (balance to the root) and waits until it is gone. */
async function deleteSub(id: string): Promise<void> {
  if (!(await exists(id))) return void console.log(`= ${id} absent, nothing to delete`);
  const tx = await account(id).deleteAccount(ROOT);
  for (let i = 0; i < 20 && (await exists(id)); i++) await new Promise((r) => setTimeout(r, 1500));
  if (await exists(id)) throw new Error(`${id} still exists after delete (${tx.transaction.hash})`);
  console.log(`- ${id} deleted, balance sent to ${ROOT} (${tx.transaction.hash})`);
}

async function main() {
  await faucetAccount(ROOT);
  for (const name of FRESH) await deleteSub(`${name}.${ROOT}`);
  // Top up from temporary faucet accounts until the root can fund every sub-account still missing
  // (plus 1 NEAR for gas and the root's own storage).
  let NEED = near(1);
  for (const [prefix, amount] of SUBS) if (!(await exists(`${prefix}.${ROOT}`))) NEED += near(amount);
  for (let i = 0; (await balance(ROOT)) < NEED && i < 3; i++) {
    const temp = `skirm-fund-${Date.now().toString(36)}.testnet`;
    await faucetAccount(temp);
    await account(temp).deleteAccount(ROOT);
    console.log(`  ${temp} deleted, balance sent to ${ROOT}: ${fmt(await balance(ROOT))}`);
  }
  console.log(`${ROOT}: ${fmt(await balance(ROOT))}`);

  const root = account(ROOT);
  for (const [prefix, amount] of SUBS) {
    const id = `${prefix}.${ROOT}`;
    if (await exists(id)) {
      console.log(`= ${id} exists`);
      continue;
    }
    await root.createAccount({ newAccountId: id, publicKey: pub(keyFor(id)), nearToTransfer: near(amount) });
    console.log(`+ ${id} with ${amount} NEAR`);
  }

  for (const [name, args] of INITS) {
    const id = `${name}.${ROOT}`;
    const acc = account(id);
    const code = await provider.viewContractCode({ contractId: id, finality: 'final' } as never).catch(() => null);
    if (!code) {
      const wasm = readFileSync(join(WASM, `skirm_${name}.wasm`));
      const tx = await acc.deployContract(new Uint8Array(wasm));
      console.log(`+ deployed skirm_${name}.wasm to ${id} (${tx.transaction.hash})`);
    } else console.log(`= ${id} has code`);
    // A live contract's `new` may trap without a readable message, so check its state first.
    if (await initialized(id)) {
      console.log(`= ${id} already initialized`);
      continue;
    }
    try {
      const tx = await acc.callFunctionRaw({ contractId: id, methodName: 'new', args, gas: 100n * 10n ** 12n });
      console.log(`+ ${id} initialized (${tx.transaction.hash})`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/already been initialized|already initialized|state already exists|AlreadyInitialized/i.test(msg)) console.log(`= ${id} already initialized`);
      else throw e;
    }
  }

  // Read back what the backend relies on.
  const view = (contractId: string, methodName: string, args: Record<string, unknown> = {}) =>
    provider.callFunction({ contractId, method: methodName, args } as never).catch((e: Error) => `error: ${e.message}`);
  console.log('registry.get_config', JSON.stringify(await view(`registry.${ROOT}`, 'get_config')));
  console.log('seasons.get_config', JSON.stringify(await view(SEASONS, 'get_config')));
  console.log('market.get_config', JSON.stringify(await view(`market.${ROOT}`, 'get_config')));
  for (const [prefix] of SUBS) console.log(`${prefix}.${ROOT}: ${fmt(await balance(`${prefix}.${ROOT}`))}`);
  console.log(`${ROOT}: ${fmt(await balance(ROOT))}`);
}

main().catch((e) => {
  console.error('FAILED', e instanceof Error ? e.message : e);
  process.exit(1);
});
