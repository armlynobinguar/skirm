/**
 * Smoke test of a live deployment: claims the cSKIRM faucet once from the deployer (an encrypted
 * mint through the Zama coprocessor) and prints the resulting encrypted balance handle.
 *
 *   npx hardhat run scripts/smoke-faucet.ts --network sepolia
 */
import { ethers, network } from "hardhat";

import { readDeployments } from "./lib/deployments";

async function main(): Promise<void> {
  const addr = readDeployments(network.name)?.contracts.ConfidentialSkirmCredits?.address;
  if (!addr) throw new Error(`cSKIRM is not in deployments/${network.name}.json`);
  const [me] = await ethers.getSigners();
  if (!me) throw new Error("No signer: set DEPLOYER_PRIVATE_KEY");
  const c = await ethers.getContractAt("ConfidentialSkirmCredits", addr, me);
  const gwei = Number(process.env.SEPOLIA_GAS_PRICE_GWEI);
  const wei = gwei > 0 ? BigInt(Math.round(gwei * 1e9)) : 0n;
  const fee = wei ? { maxFeePerGas: wei, maxPriorityFeePerGas: wei } : {};
  const tx = await c.claimFaucet(fee);
  console.log(`claimFaucet sent ${tx.hash}`);
  const r = await tx.wait();
  console.log(`status ${r?.status} gas ${r?.gasUsed}`);
  console.log(`balance handle ${await c.confidentialBalanceOf(me.address)}`);
  console.log(`next claim at ${new Date(Number(await c.nextFaucetClaimAt(me.address)) * 1000).toISOString()}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
