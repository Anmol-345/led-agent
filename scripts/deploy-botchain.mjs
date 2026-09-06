#!/usr/bin/env node
/**
 * Deploy AgentWallet + mock USDC + CustomerCreditVault to BOT Chain.
 * Usage: node scripts/deploy-botchain.mjs testnet|mainnet [--broadcast]
 * Default: dry-run (no --broadcast).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(join(root, ".env"));

const foundry = join(root, "packages", "foundry");
const NETWORKS = {
  mainnet: {
    chainId: 677,
    rpc: process.env.BOTCHAIN_RPC || "https://rpc.botchain.ai",
    explorer: "https://scan.botchain.ai",
    name: "BOT Chain Mainnet",
  },
  testnet: {
    chainId: 968,
    rpc: process.env.BOTCHAIN_TESTNET_RPC || "https://rpc.bohr.life",
    explorer: "https://scan.bohr.life",
    name: "BOT Chain Testnet",
  },
};

const args = process.argv.slice(2);
const networkArg = (args.find((a) => !a.startsWith("-")) || "testnet").toLowerCase();
const broadcast = args.includes("--broadcast");
const net = NETWORKS[networkArg];
if (!net) {
  console.error('Use: node scripts/deploy-botchain.mjs testnet|mainnet [--broadcast]');
  process.exit(1);
}

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  console.error("DEPLOYER_PRIVATE_KEY missing in .env");
  process.exit(1);
}

function runForge(forgeArgs) {
  const r = spawnSync("forge", forgeArgs, {
    stdio: "pipe",
    encoding: "utf8",
    cwd: foundry,
    env: process.env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) process.exit(r.status ?? 1);
  return (r.stdout || "") + (r.stderr || "");
}

const forgeStd = join(foundry, "lib", "forge-std", "src", "Script.sol");
if (!existsSync(forgeStd)) {
  console.log("Installing forge-std...");
  runForge(["install", "foundry-rs/forge-std", "--no-git"]);
}

console.log(`BOT Chain deploy: ${net.name} (chainId ${net.chainId})`);
console.log(`RPC: ${net.rpc}`);
console.log(broadcast ? "MODE: broadcast" : "MODE: dry-run (simulation only)");

runForge(["build"]);

const forgeArgs = [
  "script",
  "script/DeployBotchain.s.sol:DeployBotchain",
  "--rpc-url",
  net.rpc,
  "-vvvv",
];
if (broadcast) forgeArgs.push("--broadcast", "--slow");

const out = runForge(forgeArgs);

function pick(re) {
  const m = out.match(re);
  return m ? m[1] : null;
}

const usdc = pick(/CREDIT_USDC_ADDRESS=(0x[0-9a-fA-F]{40})/);
const vault = pick(/CREDIT_VAULT_ADDRESS=(0x[0-9a-fA-F]{40})/);
const wallet = pick(/AGENT_WALLET_ADDRESS=(0x[0-9a-fA-F]{40})/);
const deployer = process.env.DEPLOYER_ADDRESS || pick(/deployer:\s+(0x[0-9a-fA-F]{40})/);

if (broadcast && usdc && vault && wallet) {
  const dir = join(root, "deployments");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `botchain-${net.chainId}.json`);

  // Best-effort: pull run-latest broadcast for tx hashes
  const broadcastPath = join(
    foundry,
    "broadcast",
    "DeployBotchain.s.sol",
    String(net.chainId),
    "run-latest.json",
  );
  let txs = {};
  if (existsSync(broadcastPath)) {
    try {
      const run = JSON.parse(readFileSync(broadcastPath, "utf8"));
      for (const t of run.transactions || []) {
        if (t.contractName && t.contractAddress) {
          txs[t.contractName] = {
            address: t.contractAddress,
            txHash: t.hash,
            block: t.receipt?.blockNumber ?? null,
          };
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }

  const record = {
    chainId: net.chainId,
    network: net.name,
    rpc: net.rpc,
    explorer: net.explorer,
    deployedAt: new Date().toISOString(),
    deployer,
    contracts: {
      BotchainCreditUSDC: {
        address: usdc,
        ...(txs.BotchainCreditUSDC || {}),
        constructorArgs: [],
        verified: false,
      },
      CustomerCreditVault: {
        address: vault,
        ...(txs.CustomerCreditVault || {}),
        constructorArgs: [usdc, deployer, deployer, deployer],
        verified: false,
      },
      AgentWallet: {
        address: wallet,
        ...(txs.AgentWallet || {}),
        constructorArgs: [process.env.AGENT_ADDRESS || "0x0000000000000000000000000000000000000000"],
        verified: false,
      },
    },
  };
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
  console.log(`Wrote ${path}`);
  console.log(`CREDIT_USDC_ADDRESS=${usdc}`);
  console.log(`CREDIT_VAULT_ADDRESS=${vault}`);
}
