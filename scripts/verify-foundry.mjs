#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseVerifyNetwork,
  getChainId,
  getForgeChain,
  isLocalNetwork,
  getExplorerApiKey,
} from "./deploy-networks.mjs";

const root = process.cwd();
const foundry = join(root, "packages", "foundry");

const network = parseVerifyNetwork(process.argv.slice(2));

if (isLocalNetwork(network)) {
  console.log("Skipping explorer verification for localhost (chain 31337).");
  process.exit(0);
}

const chainId = getChainId(network);
const broadcastDir = join(
  foundry,
  "broadcast",
  "Deploy.s.sol",
  String(chainId),
);
const runLatest = join(broadcastDir, "run-latest.json");
if (!existsSync(runLatest)) {
  console.error("Missing", runLatest);
  console.error("Deploy first: just deploy " + network);
  process.exit(1);
}

const run = JSON.parse(readFileSync(runLatest, "utf8"));
const txs = run.transactions || [];
const findCreatedContract = (name) =>
  txs.find(
    (transaction) =>
      transaction.transactionType === "CREATE" &&
      (transaction.contractName === name ||
        transaction.contractName?.includes(name)),
  );
const agentWallet = findCreatedContract("AgentWallet");
if (!agentWallet?.contractAddress) {
  console.error("Could not find AgentWallet CREATE in run-latest.json");
  process.exit(1);
}

const agentRaw =
  (process.env.AGENT_ADDRESS || "").trim() ||
  "0x0000000000000000000000000000000000000000";
const agentAddr = agentRaw.startsWith("0x") ? agentRaw : "0x" + agentRaw;

function roleAddress(name) {
  const value = (process.env[name] || "").trim();
  if (value) return value;
  if (network === "base") return requiredEnvironment(name);
  const deployer = (process.env.DEPLOYER_ADDRESS || "").trim();
  if (!deployer) {
    console.error(
      "Set " + name + " or DEPLOYER_ADDRESS to verify CustomerCreditVault.",
    );
    process.exit(1);
  }
  return deployer;
}

function requiredEnvironment(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    console.error("Set " + name + " to verify CustomerCreditVault.");
    process.exit(1);
  }
  return value;
}

const apiKey = getExplorerApiKey(network);
const forgeChain = getForgeChain(network);

function verifyContract({ address, contract, signature, arguments: values }) {
  const encoded = spawnSync("cast", ["abi-encode", signature, ...values], {
    cwd: foundry,
    encoding: "utf8",
  });
  if (encoded.status !== 0) {
    console.error(encoded.stderr || "cast abi-encode failed");
    process.exit(1);
  }
  const constructorArgs = encoded.stdout.trim().replace(/^0x/i, "");
  console.log(
    "Verifying",
    contract,
    "at",
    address,
    "on",
    network,
    "(forge --chain",
    forgeChain + ")",
  );
  const result = spawnSync(
    "forge",
    [
      "verify-contract",
      address,
      "src/" + contract + ".sol:" + contract,
      "--chain",
      forgeChain,
      "--constructor-args",
      constructorArgs,
      "--etherscan-api-key",
      apiKey,
      "--watch",
    ],
    { stdio: "inherit", cwd: foundry, env: process.env },
  );
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

verifyContract({
  address: agentWallet.contractAddress,
  contract: "AgentWallet",
  signature: "constructor(address)",
  arguments: [agentAddr],
});

const customerCreditVault = findCreatedContract("CustomerCreditVault");
if (customerCreditVault?.contractAddress) {
  // On Base the vault is pinned to native USDC. Elsewhere the deploy either used a
  // supplied token (CREDIT_REHEARSAL_USDC_ADDRESS) or created the LocalCreditUSDC mock —
  // read that back from the broadcast rather than making the operator restate it.
  const deployedMock = findCreatedContract("LocalCreditUSDC")?.contractAddress;
  const usdc =
    network === "base"
      ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      : (process.env.CREDIT_REHEARSAL_USDC_ADDRESS || "").trim() ||
        deployedMock ||
        requiredEnvironment("CREDIT_REHEARSAL_USDC_ADDRESS");
  verifyContract({
    address: customerCreditVault.contractAddress,
    contract: "CustomerCreditVault",
    signature: "constructor(address,address,address,address)",
    arguments: [
      usdc,
      // Deploy.s.sol falls back to the deployer for every role off Base; mirror that so
      // verifying a testnet deployment does not demand three addresses nobody set.
      roleAddress("CREDIT_ADMIN_ADDRESS"),
      roleAddress("CREDIT_BILLING_ADDRESS"),
      roleAddress("CREDIT_TREASURY_ADDRESS"),
    ],
  });
} else {
  // The vault is deployed on every network now, not just Base and rehearsal chains.
  const vaultExpected = true;
  if (vaultExpected) {
    console.error(
      "Could not find expected CustomerCreditVault CREATE in run-latest.json",
    );
    process.exit(1);
  }
  console.log("No CustomerCreditVault deployment expected; skipping vault verification.");
}
