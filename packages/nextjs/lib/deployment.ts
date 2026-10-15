/**
 * The deployment target: `mainnet`, `testnet`, `botchain`, or `botchain-testnet`.
 *
 * Single source of truth for which chains the app uses. Safe to import from server and
 * client — reads only `NEXT_PUBLIC_DEPLOY_TARGET`, no secrets.
 *
 * - `mainnet` — vault on Base + native USDC, real Uniswap fills on asset chains
 * - `testnet` — vault on Sepolia + mock USDC, stand-in swaps
 * - `botchain` — vault on BOT Chain mainnet (677) + mock/deployed USDC (no Circle USDC yet)
 * - `botchain-testnet` — vault on BOT testnet (968) + mock USDC
 *
 * Tokenized equities are not on BOT Chain; quotes still come from Ethereum/Base/Robinhood.
 * On BOT targets, signed swaps stay stand-in (Sepolia) until Uniswap lands on BOT.
 */

import {
  BOTCHAIN_MAINNET_ID,
  BOTCHAIN_TESTNET_ID,
} from "./config/chain";

export type DeployTarget = "mainnet" | "testnet" | "botchain" | "botchain-testnet";

export type DeploymentConfig = {
  target: DeployTarget;
  vaultChainId: number;
  vaultChainName: string;
  vaultUsdcAddress?: `0x${string}`;
  quoteChainIds: readonly number[];
  executionChainId: number | "asset-chain";
  zeroGBaseUrl: string;
  faucetEnabled: boolean;
  usesStandInExecution: boolean;
};

export const BASE_CHAIN_ID = 8453;
export const SEPOLIA_CHAIN_ID = 11155111;
export const ROBINHOOD_CHAIN_ID = 4663;
export const ETHEREUM_CHAIN_ID = 1;
export { BOTCHAIN_MAINNET_ID, BOTCHAIN_TESTNET_ID };

export const BASE_NATIVE_USDC: `0x${string}` =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const QUOTE_CHAIN_IDS = [
  ETHEREUM_CHAIN_ID,
  BASE_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
] as const;

const MAINNET: DeploymentConfig = {
  target: "mainnet",
  vaultChainId: BASE_CHAIN_ID,
  vaultChainName: "Base",
  vaultUsdcAddress: BASE_NATIVE_USDC,
  quoteChainIds: QUOTE_CHAIN_IDS,
  executionChainId: "asset-chain",
  zeroGBaseUrl: "https://router-api.0g.ai/v1",
  faucetEnabled: false,
  usesStandInExecution: false,
};

const TESTNET: DeploymentConfig = {
  target: "testnet",
  vaultChainId: SEPOLIA_CHAIN_ID,
  vaultChainName: "Sepolia",
  vaultUsdcAddress: undefined,
  quoteChainIds: QUOTE_CHAIN_IDS,
  executionChainId: SEPOLIA_CHAIN_ID,
  zeroGBaseUrl: "https://router-api-testnet.integratenetwork.work/v1",
  faucetEnabled: true,
  usesStandInExecution: true,
};

const BOTCHAIN: DeploymentConfig = {
  target: "botchain",
  vaultChainId: BOTCHAIN_MAINNET_ID,
  vaultChainName: "BOT Chain",
  vaultUsdcAddress: "0x33F96427BfE3ec9Db7424DB99759373D5cC9eDf8",
  quoteChainIds: QUOTE_CHAIN_IDS,
  executionChainId: BOTCHAIN_MAINNET_ID,
  zeroGBaseUrl: "https://router-api.0g.ai/v1",
  faucetEnabled: true,
  usesStandInExecution: false,
};

const BOTCHAIN_TESTNET: DeploymentConfig = {
  target: "botchain-testnet",
  vaultChainId: BOTCHAIN_TESTNET_ID,
  vaultChainName: "BOT Chain Testnet",
  vaultUsdcAddress: "0x33F96427BfE3ec9Db7424DB99759373D5cC9eDf8",
  quoteChainIds: QUOTE_CHAIN_IDS,
  executionChainId: BOTCHAIN_TESTNET_ID,
  zeroGBaseUrl: "https://router-api-testnet.integratenetwork.work/v1",
  faucetEnabled: true,
  usesStandInExecution: false,
};

const BY_TARGET: Record<DeployTarget, DeploymentConfig> = {
  mainnet: MAINNET,
  testnet: TESTNET,
  botchain: BOTCHAIN,
  "botchain-testnet": BOTCHAIN_TESTNET,
};

export function parseDeployTarget(raw: string | undefined): DeployTarget {
  const value = (raw || "").trim().toLowerCase();
  if (value === "mainnet") return "mainnet";
  if (value === "testnet") return "testnet";
  if (value === "botchain") return "botchain";
  if (value === "botchain-testnet" || value === "botchain_testnet") return "botchain-testnet";
  return "botchain";
}

export function deploymentFor(target: DeployTarget): DeploymentConfig {
  return BY_TARGET[target];
}

export const DEPLOYMENT: DeploymentConfig = deploymentFor(
  parseDeployTarget(process.env.NEXT_PUBLIC_DEPLOY_TARGET)
);

export const isMainnet = DEPLOYMENT.target === "mainnet" || DEPLOYMENT.target === "botchain";
export const isTestnet =
  DEPLOYMENT.target === "testnet" || DEPLOYMENT.target === "botchain-testnet";
export const isBotchain =
  DEPLOYMENT.target === "botchain" || DEPLOYMENT.target === "botchain-testnet";

export function executionChainFor(assetChainId: number): number {
  return DEPLOYMENT.executionChainId === "asset-chain"
    ? assetChainId
    : DEPLOYMENT.executionChainId;
}

const CHAIN_NAMES: Readonly<Record<number, string>> = {
  [ETHEREUM_CHAIN_ID]: "Ethereum",
  [BASE_CHAIN_ID]: "Base",
  [ROBINHOOD_CHAIN_ID]: "Robinhood Chain",
  [SEPOLIA_CHAIN_ID]: "Sepolia",
  [BOTCHAIN_MAINNET_ID]: "BOT Chain",
  [BOTCHAIN_TESTNET_ID]: "BOT Chain Testnet",
};

export function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] || `chain ${chainId}`;
}

const EXPLORERS: Readonly<Record<number, string>> = {
  [ETHEREUM_CHAIN_ID]: "https://etherscan.io",
  [BASE_CHAIN_ID]: "https://basescan.org",
  [ROBINHOOD_CHAIN_ID]: "https://robinhoodchain.blockscout.com",
  [SEPOLIA_CHAIN_ID]: "https://sepolia.etherscan.io",
  [BOTCHAIN_MAINNET_ID]: "https://scan.botchain.ai",
  [BOTCHAIN_TESTNET_ID]: "https://scan.bohr.life",
};

export function explorerBaseUrl(chainId: number): string | null {
  return EXPLORERS[chainId] ?? null;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = explorerBaseUrl(chainId);
  return base ? `${base}/address/${address}` : null;
}

export function explorerTxUrl(chainId: number, hash: string): string | null {
  const base = explorerBaseUrl(chainId);
  return base ? `${base}/tx/${hash}` : null;
}

export const SETTLEMENT_TOKEN_LABEL = DEPLOYMENT.vaultUsdcAddress
  ? "native USDC"
  : "test USDC";
