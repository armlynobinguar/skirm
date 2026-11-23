import fs from "node:fs";
import path from "node:path";

/** One deployed contract, as recorded in `deployments/<network>.json`. */
export interface DeploymentRecord {
  address: string;
  txHash: string;
  blockNumber: number | null;
  deployedAt: string;
  args: unknown[];
}

/** Shape of `deployments/<network>.json`. Later contracts are merged into the same file. */
export interface NetworkDeployments {
  network: string;
  chainId: number;
  contracts: Record<string, DeploymentRecord>;
}

/** Contracts whose ABI is exported to the web, in the order they appear in the generated module. */
export const EXPORTED_CONTRACTS = ["ConfidentialSkirmCredits", "SkirmMatch", "FogSkirm", "SkillAuction", "BenchmarkSeeds", "MatchPredictions", "PrivateLadder"] as const;

/** Networks whose deployment file feeds the generated module. */
export const EXPORTED_NETWORKS = ["sepolia"] as const;

export const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
export const DEPLOYMENTS_DIR = path.join(PACKAGE_ROOT, "deployments");

export function deploymentsPath(network: string): string {
  return path.join(DEPLOYMENTS_DIR, `${network}.json`);
}

export function readDeployments(network: string): NetworkDeployments | null {
  const file = deploymentsPath(network);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as NetworkDeployments;
}

export function writeDeployments(deployments: NetworkDeployments): string {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const file = deploymentsPath(deployments.network);
  fs.writeFileSync(file, `${JSON.stringify(deployments, null, 2)}\n`);
  return file;
}
