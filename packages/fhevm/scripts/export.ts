/**
 * Regenerates generated/index.ts (addresses from deployments/*.json + ABIs from the compiled
 * artifacts) without deploying anything.
 *
 *   npm run export -w @skirm/fhevm
 */
import { run } from "hardhat";

import { writeGeneratedModule } from "./lib/generate";

async function main(): Promise<void> {
  await run("compile", { quiet: true });
  console.log(`Wrote ${await writeGeneratedModule()}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
