/**
 * Deploys ConfidentialSkirmCredits and records it in deployments/<network>.json, then regenerates
 * the web-facing module in generated/.
 *
 *   npm run deploy:sepolia -w @skirm/fhevm
 *
 * Env: SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY (required on Sepolia), and optionally
 * CREDITS_OWNER (defaults to the deployer), FAUCET_AMOUNT (base units, 6 decimals; default 1,000
 * cSKIRM), FAUCET_COOLDOWN_SECONDS (default 86400).
 */
import { ethers, network } from "hardhat";

import { readDeployments, writeDeployments, type NetworkDeployments } from "./lib/deployments";
import { writeGeneratedModule } from "./lib/generate";

const DEFAULT_FAUCET_AMOUNT = 1_000n * 10n ** 6n;
const DEFAULT_FAUCET_COOLDOWN = 24n * 60n * 60n;

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error(`No deployer account for network "${network.name}". Set DEPLOYER_PRIVATE_KEY.`);

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const owner = process.env.CREDITS_OWNER ?? deployer.address;
  const faucetAmount = BigInt(process.env.FAUCET_AMOUNT ?? DEFAULT_FAUCET_AMOUNT);
  const faucetCooldown = BigInt(process.env.FAUCET_COOLDOWN_SECONDS ?? DEFAULT_FAUCET_COOLDOWN);

  console.log(`Deploying ConfidentialSkirmCredits to ${network.name} (chain ${chainId}) from ${deployer.address}`);
  const factory = await ethers.getContractFactory("ConfidentialSkirmCredits", deployer);
  const args = [owner, faucetAmount, faucetCooldown] as const;
  const token = await factory.deploy(...args);
  const tx = token.deploymentTransaction();
  await token.waitForDeployment();
  const receipt = tx ? await tx.wait() : null;
  const address = await token.getAddress();
  console.log(`ConfidentialSkirmCredits: ${address}`);

  const previous = readDeployments(network.name);
  const deployments: NetworkDeployments = {
    network: network.name,
    chainId,
    contracts: {
      ...(previous?.chainId === chainId ? previous.contracts : {}),
      ConfidentialSkirmCredits: {
        address,
        txHash: tx?.hash ?? "",
        blockNumber: receipt?.blockNumber ?? null,
        deployedAt: new Date().toISOString(),
        args: args.map((a) => (typeof a === "bigint" ? a.toString() : a)),
      },
    },
  };
  console.log(`Wrote ${writeDeployments(deployments)}`);
  console.log(`Wrote ${await writeGeneratedModule()}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
