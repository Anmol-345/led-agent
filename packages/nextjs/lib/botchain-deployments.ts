import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type BotchainContractRecord = {
  address: string;
  txHash?: string;
  block?: number | string | null;
  constructorArgs?: unknown[];
  verified?: boolean;
};

export type BotchainDeployment = {
  chainId: number;
  network: string;
  rpc: string;
  explorer: string;
  deployedAt: string;
  deployer: string;
  contracts: Record<string, BotchainContractRecord>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDeployment(raw: unknown): BotchainDeployment | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.chainId !== "number") return null;
  if (typeof raw.network !== "string") return null;
  if (typeof raw.rpc !== "string") return null;
  if (typeof raw.explorer !== "string") return null;
  if (typeof raw.deployedAt !== "string") return null;
  if (typeof raw.deployer !== "string") return null;
  if (!isRecord(raw.contracts)) return null;
  const contracts: Record<string, BotchainContractRecord> = {};
  for (const [name, entry] of Object.entries(raw.contracts)) {
    if (!isRecord(entry) || typeof entry.address !== "string") return null;
    contracts[name] = {
      address: entry.address,
      txHash: typeof entry.txHash === "string" ? entry.txHash : undefined,
      block:
        typeof entry.block === "number" || typeof entry.block === "string" || entry.block === null
          ? entry.block
          : undefined,
      constructorArgs: Array.isArray(entry.constructorArgs) ? entry.constructorArgs : undefined,
      verified: typeof entry.verified === "boolean" ? entry.verified : undefined,
    };
  }
  return {
    chainId: raw.chainId,
    network: raw.network,
    rpc: raw.rpc,
    explorer: raw.explorer,
    deployedAt: raw.deployedAt,
    deployer: raw.deployer,
    contracts,
  };
}

export function loadBotchainDeployment(chainId: 677 | 968): BotchainDeployment | null {
  const candidates = [
    join(process.cwd(), "deployments", `botchain-${chainId}.json`),
    join(process.cwd(), "..", "..", "deployments", `botchain-${chainId}.json`),
  ];
  const file = candidates.find(existsSync);
  if (!file) return null;
  try {
    return parseDeployment(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}
