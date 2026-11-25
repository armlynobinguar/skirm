/**
 * Deploys skirm's FHEVM contracts and records them in deployments/<network>.json, then regenerates
 * the web-facing module in generated/.
 *
 *   npm run deploy:sepolia -w @skirm/fhevm
 *
 * Env: SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY (required on Sepolia), and optionally
 * DEPLOY_CONTRACTS (comma list, default every contract:
 * ConfidentialSkirmCredits,SkirmMatch,FogSkirm,SkillAuction,BenchmarkSeeds; e.g. `SkirmMatch` to add
 * it next to an already deployed token, `FogSkirm` to add the Fog Skirm mode, which takes no
 * constructor arguments, `SkillAuction` to add the sealed-bid skill auctions, or `BenchmarkSeeds` to
 * add the on-chain benchmark seeds), CREDITS_OWNER (defaults to the
 * deployer), FAUCET_AMOUNT (base units, 6 decimals; default 1,000 cSKIRM), FAUCET_COOLDOWN_SECONDS
 * (default 86400).
 *
 * SkirmMatch escrows cSKIRM stakes, so it takes: the cSKIRM address (CREDITS_ADDRESS, else the one
 * deployed in this run or recorded in deployments/<network>.json), MATCH_OPERATOR (the game server
 * signer that settles results; default the deployer; the server holds its key as
 * ZAMA_OPERATOR_PRIVATE_KEY), TREASURY (fee recipient; default none) and FEE_BPS (fee on the matched
 * pot in basis points, at most 1000; default 0).
 *
 * SkillAuction escrows cSKIRM bids, so it takes the same cSKIRM address, TREASURY and
 * AUCTION_FEE_BPS (fee on the clearing price, at most 1000; default FEE_BPS, else 0).
 *
 * BenchmarkSeeds takes BENCHMARK_OPERATOR (the account that commits and publishes benchmark seeds;
 * default MATCH_OPERATOR, else the deployer; the worker holds its key as ZAMA_OPERATOR_PRIVATE_KEY)
 * and BENCHMARK_REVEAL_WINDOW_SECONDS (how long the operator has to publish before anyone may force
 * the reveal, 600..2592000; default 86400).
 */
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, network } from "hardhat";

import { EXPORTED_CONTRACTS, readDeployments, writeDeployments, type DeploymentRecord, type NetworkDeployments } from "./lib/deployments";
import { writeGeneratedModule } from "./lib/generate";

const DEFAULT_FAUCET_AMOUNT = 1_000n * 10n ** 6n;
const DEFAULT_FAUCET_COOLDOWN = 24n * 60n * 60n;

type ContractName = (typeof EXPORTED_CONTRACTS)[number];

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** An address from env `name`, else `fallback`; throws on a malformed value. */
function envAddress(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  if (!ADDRESS_RE.test(v)) throw new Error(`${name}: "${v}" is not an address`);
  return v;
}

/** Constructor arguments per contract (`contracts`: what is deployed so far on this network). */
function constructorArgs(name: ContractName, deployer: HardhatEthersSigner, contracts: Record<string, DeploymentRecord>): unknown[] {
  switch (name) {
    case "ConfidentialSkirmCredits":
      return [
        process.env.CREDITS_OWNER ?? deployer.address,
        BigInt(process.env.FAUCET_AMOUNT ?? DEFAULT_FAUCET_AMOUNT),
        BigInt(process.env.FAUCET_COOLDOWN_SECONDS ?? DEFAULT_FAUCET_COOLDOWN),
      ];
    case "SkirmMatch": {
      const credits = envAddress("CREDITS_ADDRESS", contracts.ConfidentialSkirmCredits?.address ?? "");
      if (!credits) throw new Error("SkirmMatch needs cSKIRM: deploy ConfidentialSkirmCredits first or set CREDITS_ADDRESS");
      const feeBps = Number(process.env.FEE_BPS ?? 0);
      if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) throw new Error(`FEE_BPS: ${process.env.FEE_BPS} is not 0..1000`);
      return [credits, envAddress("MATCH_OPERATOR", deployer.address), envAddress("TREASURY", ethers.ZeroAddress), feeBps];
    }
    case "FogSkirm":
      return [];
    case "SkillAuction": {
      const credits = envAddress("CREDITS_ADDRESS", contracts.ConfidentialSkirmCredits?.address ?? "");
      if (!credits) throw new Error("SkillAuction needs cSKIRM: deploy ConfidentialSkirmCredits first or set CREDITS_ADDRESS");
      const raw = process.env.AUCTION_FEE_BPS ?? process.env.FEE_BPS ?? 0;
      const feeBps = Number(raw);
      if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) throw new Error(`AUCTION_FEE_BPS: ${raw} is not 0..1000`);
      return [credits, envAddress("TREASURY", ethers.ZeroAddress), feeBps];
    }
    case "BenchmarkSeeds": {
      const raw = process.env.BENCHMARK_REVEAL_WINDOW_SECONDS ?? 86_400;
      const window = Number(raw);
      if (!Number.isInteger(window) || window < 600 || window > 30 * 86_400) throw new Error(`BENCHMARK_REVEAL_WINDOW_SECONDS: ${raw} is not 600..2592000`);
      return [envAddress("BENCHMARK_OPERATOR", envAddress("MATCH_OPERATOR", deployer.address)), window];
    }
  }
}

function selected(): ContractName[] {
  const raw = process.env.DEPLOY_CONTRACTS?.trim();
  if (!raw) return [...EXPORTED_CONTRACTS];
  const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    if (!(EXPORTED_CONTRACTS as readonly string[]).includes(n)) throw new Error(`DEPLOY_CONTRACTS: unknown contract "${n}"`);
  }
  return names as ContractName[];
}

async function deployOne(name: ContractName, deployer: HardhatEthersSigner, contracts: Record<string, DeploymentRecord>): Promise<DeploymentRecord> {
  const args = constructorArgs(name, deployer, contracts);
  const factory = await ethers.getContractFactory(name, deployer);
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const receipt = tx ? await tx.wait() : null;
  const address = await contract.getAddress();
  console.log(`${name}: ${address}`);
  return {
    address,
    txHash: tx?.hash ?? "",
    blockNumber: receipt?.blockNumber ?? null,
    deployedAt: new Date().toISOString(),
    args: args.map((a) => (typeof a === "bigint" ? a.toString() : a)),
  };
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error(`No deployer account for network "${network.name}". Set DEPLOYER_PRIVATE_KEY.`);

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const names = selected();
  console.log(`Deploying ${names.join(", ")} to ${network.name} (chain ${chainId}) from ${deployer.address}`);

  const previous = readDeployments(network.name);
  const contracts: Record<string, DeploymentRecord> = previous?.chainId === chainId ? { ...previous.contracts } : {};
  for (const name of names) {
    contracts[name] = await deployOne(name, deployer, contracts);
    // Written after each contract, so a later failure keeps the ones already deployed.
    const deployments: NetworkDeployments = { network: network.name, chainId, contracts };
    writeDeployments(deployments);
  }
  console.log(`Wrote deployments/${network.name}.json`);
  console.log(`Wrote ${await writeGeneratedModule()}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
