"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import { http, type Chain } from "viem";
import { base, mainnet, sepolia } from "wagmi/chains";
import { botchain, botchainTestnet } from "./config/chain";
import {
  BASE_CHAIN_ID,
  DEPLOYMENT,
  ETHEREUM_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  BOTCHAIN_MAINNET_ID,
  BOTCHAIN_TESTNET_ID,
  isBotchain,
} from "./deployment";

const DEFAULT_REOWN_PROJECT_ID = "ef4aa705a4612c41fc51003cc1f6d387" as const;

const projectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

/**
 * Robinhood Chain is not in viem/wagmi's bundled chain list.
 */
export const robinhoodChain = {
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
} as const satisfies Chain;

const CHAINS_BY_ID: Readonly<Record<number, Chain>> = {
  [ETHEREUM_CHAIN_ID]: mainnet,
  [BASE_CHAIN_ID]: base,
  [ROBINHOOD_CHAIN_ID]: robinhoodChain,
  [SEPOLIA_CHAIN_ID]: sepolia,
  [BOTCHAIN_MAINNET_ID]: botchain,
  [BOTCHAIN_TESTNET_ID]: botchainTestnet,
};

const RPC_OVERRIDES: Readonly<Record<number, string>> = {
  [ETHEREUM_CHAIN_ID]: "https://ethereum.publicnode.com",
  [ROBINHOOD_CHAIN_ID]: "https://rpc.mainnet.chain.robinhood.com",
  [SEPOLIA_CHAIN_ID]: "https://ethereum-sepolia-rpc.publicnode.com",
  [BOTCHAIN_MAINNET_ID]: "https://rpc.botchain.ai",
  [BOTCHAIN_TESTNET_ID]: "https://rpc.bohr.life",
};

/** BOT Chain port: wallet connects to vault chain only. Quotes stay server-side. */
const activeChainIds = isBotchain
  ? [DEPLOYMENT.vaultChainId]
  : Array.from(
      new Set<number>([
        DEPLOYMENT.vaultChainId,
        ...DEPLOYMENT.quoteChainIds,
        ...(DEPLOYMENT.executionChainId === "asset-chain"
          ? []
          : [DEPLOYMENT.executionChainId]),
      ])
    );

const wagmiChains = activeChainIds.map(id => {
  const chain = CHAINS_BY_ID[id];
  if (!chain) {
    throw new Error(`No wagmi chain definition for chain ID ${id}.`);
  }
  return chain;
}) as [Chain, ...Chain[]];

const wagmiTransports = Object.fromEntries(
  wagmiChains.map(chain => [
    chain.id,
    RPC_OVERRIDES[chain.id] ? http(RPC_OVERRIDES[chain.id]) : http(),
  ])
);

export const wagmiConfig = getDefaultConfig({
  appName: "leg-agent",
  projectId: projectId || DEFAULT_REOWN_PROJECT_ID,
  chains: wagmiChains,
  ssr: false,
  transports: wagmiTransports,
  wallets: [
    {
      groupName: "Connect Wallet",
      wallets: [metaMaskWallet],
    },
  ],
});
