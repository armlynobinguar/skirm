/**
 * Checks a deploy before it spends anything: prints the deployer address (never the key), its
 * balance, and the gas each contract's deployment would take at the current fee.
 *
 *   npx hardhat run scripts/preflight.ts --network sepolia
 */
import { ethers, network } from "hardhat";

import { EXPORTED_CONTRACTS } from "./lib/deployments";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error(`No deployer account for "${network.name}". Set DEPLOYER_PRIVATE_KEY in packages/fhevm/.env.`);
  const provider = ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  const balance = await provider.getBalance(deployer.address);
  const fee = await provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  console.log(`network ${network.name} (chain ${chainId})`);
  console.log(`deployer ${deployer.address}`);
  console.log(`balance  ${ethers.formatEther(balance)} ETH`);
  console.log(`max fee  ${ethers.formatUnits(gasPrice, "gwei")} gwei`);

  // Bytecode size only bounds the cost (constructor args change little): estimate with placeholder args.
  const placeholder = deployer.address;
  const args: Record<string, unknown[]> = {
    ConfidentialSkirmCredits: [placeholder, 1_000_000_000n, 86_400n],
    SkirmMatch: [placeholder, placeholder, ethers.ZeroAddress, 0],
    FogSkirm: [],
    SkillAuction: [placeholder, ethers.ZeroAddress, 0],
    BenchmarkSeeds: [placeholder, 86_400],
    MatchPredictions: [placeholder, ethers.ZeroAddress, placeholder, ethers.ZeroAddress, 0],
    PrivateLadder: [ethers.ZeroAddress, placeholder, 200],
  };
  let total = 0n;
  for (const name of EXPORTED_CONTRACTS) {
    const factory = await ethers.getContractFactory(name, deployer);
    const tx = await factory.getDeployTransaction(...(args[name] ?? []));
    const gas = await provider.estimateGas({ ...tx, from: deployer.address });
    total += gas;
    console.log(`${name.padEnd(26)} ${gas.toString().padStart(9)} gas`);
  }
  const cost = total * gasPrice;
  console.log(`total ${total} gas, up to ${ethers.formatEther(cost)} ETH at the current max fee`);
  console.log(balance > cost ? "OK: balance covers the deploy" : "NOT ENOUGH: top up the deployer with Sepolia ETH");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
