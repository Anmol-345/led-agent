#!/usr/bin/env node
/**
 * Validates that the vault contract is deployed on the chain the current deployment target
 * expects. Run before `just start`.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Keep in sync with packages/nextjs/lib/deployment.ts. */
const VAULT_CHAIN_BY_TARGET = {
  mainnet: { chainId: 8453, name: "Base" },
  testnet: { chainId: 11155111, name: "Sepolia" },
};

function readDeployTarget() {
  if (process.env.NEXT_PUBLIC_DEPLOY_TARGET) {
    return process.env.NEXT_PUBLIC_DEPLOY_TARGET.trim();
  }
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf8").match(
      /^NEXT_PUBLIC_DEPLOY_TARGET\s*=\s*(.+)$/m
    );
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function loadDeployedChainIds() {
  const path = join(ROOT, "packages/nextjs/contracts/deployedContracts.ts");
  if (!existsSync(path)) return { path: null, chainIds: [] };
  const raw = readFileSync(path, "utf8");
  const chainIds = [];
  const re = /^\s*"?(\d+)"?\s*:/gm;
  let match;
  while ((match = re.exec(raw)) !== null) chainIds.push(Number(match[1]));
  return { path, chainIds };
}

function main() {
  const target = readDeployTarget();
  const vault = VAULT_CHAIN_BY_TARGET[target];
  if (!vault) {
    console.error("");
    console.error(
      target
        ? `  ✗  NEXT_PUBLIC_DEPLOY_TARGET is "${target}" — expected "mainnet" or "testnet".`
        : "  ✗  NEXT_PUBLIC_DEPLOY_TARGET is not set."
    );
    console.error("     Set it with: just use-target testnet");
    console.error("");
    process.exit(1);
  }

  const { path: contractsPath, chainIds } = loadDeployedChainIds();
  if (!contractsPath) {
    console.warn(
      "⚠  No deployedContracts.ts found — deploy contracts first (just deploy)."
    );
    process.exit(0);
  }

  if (!chainIds.includes(vault.chainId)) {
    console.error("");
    console.error(
      `  ✗  target "${target}" expects the vault on ${vault.name} (chainId ${vault.chainId}), ` +
        "but deployedContracts has no contracts for that chain."
    );
    console.error(
      `     Deploy it: just deploy ${target === "mainnet" ? "base" : "sepolia"}`
    );
    console.error("");
    process.exit(1);
  }

  console.log(
    `  ✔  target="${target}" — vault contracts deployed on ${vault.name} (chainId ${vault.chainId}).`
  );
}

main();
