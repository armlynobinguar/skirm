/**
 * Publishes the source of every contract in deployments/<network>.json on Sourcify (no API key;
 * Sepolia explorers read it), through Sourcify's API v2: hardhat-verify 2 still calls v1, which
 * Sourcify removed. Sends the compiler's standard JSON input from Hardhat's build-info and the
 * creation transaction, then polls each job. Already-verified contracts are reported and skipped.
 *
 *   npx hardhat compile && npx hardhat run scripts/verify-sources.ts --network sepolia
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { network } from "hardhat";

import { readDeployments } from "./lib/deployments";

const API = process.env.SOURCIFY_API_URL || "https://sourcify.dev/server";
const HEADERS = { "content-type": "application/json", "user-agent": "skirm-fhevm-verify/0.1 (+https://github.com/armlynobinguar/skirm)" };

interface BuildInfo {
  solcLongVersion: string;
  input: Record<string, unknown>;
}

function buildInfoFor(name: string): BuildInfo {
  const dbg = join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.dbg.json`);
  const rel = (JSON.parse(readFileSync(dbg, "utf8")) as { buildInfo: string }).buildInfo.replace(/\\/g, "/");
  return JSON.parse(readFileSync(resolve(dirname(dbg), rel), "utf8")) as BuildInfo;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

async function main(): Promise<void> {
  const d = readDeployments(network.name);
  if (!d) throw new Error(`No deployments/${network.name}.json`);
  let failed = 0;
  for (const [name, rec] of Object.entries(d.contracts)) {
    const existing = await json(await fetch(`${API}/v2/contract/${d.chainId}/${rec.address}`, { headers: HEADERS }));
    if (existing.match) {
      console.log(`${name}: already verified (${String(existing.match)})`);
      continue;
    }
    const info = buildInfoFor(name);
    const res = await fetch(`${API}/v2/verify/${d.chainId}/${rec.address}`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        stdJsonInput: info.input,
        compilerVersion: info.solcLongVersion,
        contractIdentifier: `contracts/${name}.sol:${name}`,
        creationTransactionHash: rec.txHash || undefined,
      }),
    });
    const job = await json(res);
    const id = job.verificationId as string | undefined;
    if (!res.ok || !id) {
      failed++;
      console.log(`${name}: FAILED to submit (${res.status}) ${JSON.stringify(job).slice(0, 300)}`);
      continue;
    }
    let status: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      status = await json(await fetch(`${API}/v2/verify/${id}`, { headers: HEADERS }));
      if (status.isJobCompleted) break;
    }
    const contract = status.contract as { match?: string } | undefined;
    if (contract?.match) console.log(`${name}: verified (${contract.match})`);
    else {
      failed++;
      console.log(`${name}: FAILED ${JSON.stringify(status.error ?? status).slice(0, 300)}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
