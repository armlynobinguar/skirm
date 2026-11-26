/**
 * Checks a recorded deployment on chain: each contract has code, and every zero-argument address
 * getter (owner, operator, token, match, ...) is printed so the wiring can be checked.
 *
 *   npx hardhat run scripts/verify-deploy.ts --network sepolia
 */
import { ethers, network } from "hardhat";

import { readDeployments } from "./lib/deployments";

async function main(): Promise<void> {
  const d = readDeployments(network.name);
  if (!d) throw new Error(`No deployments/${network.name}.json`);
  const names = new Map(Object.entries(d.contracts).map(([n, r]) => [r.address.toLowerCase(), n]));
  let bad = 0;
  for (const [name, rec] of Object.entries(d.contracts)) {
    const code = await ethers.provider.getCode(rec.address);
    const ok = code !== "0x";
    if (!ok) bad++;
    console.log(`${ok ? "OK " : "NO CODE"} ${name} ${rec.address} (${(code.length - 2) / 2} bytes)`);
    const c = await ethers.getContractAt(name, rec.address);
    for (const f of c.interface.fragments) {
      if (f.type !== "function") continue;
      const fn = f as import("ethers").FunctionFragment;
      if (fn.inputs.length || fn.stateMutability !== "view" || fn.outputs.length !== 1) continue;
      const t = fn.outputs[0]!.type;
      if (t !== "address" && !/^u?int(8|16|32|64)?$/.test(t) && t !== "uint256" && t !== "string") continue;
      try {
        const v = await c.getFunction(fn.name).staticCall();
        const label = typeof v === "string" ? names.get(v.toLowerCase()) ?? (v.toLowerCase() === (await (await ethers.getSigners())[0]!.getAddress()).toLowerCase() ? "deployer" : "") : "";
        console.log(`      ${fn.name} = ${v}${label ? ` (${label})` : ""}`);
      } catch {
        /* getters that revert are skipped */
      }
    }
  }
  if (bad) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
