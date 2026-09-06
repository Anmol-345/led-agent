import { defineChain, type Chain } from "viem";
import {
  bsc,
  base,
  baseSepolia,
  hardhat,
  mainnet,
  polygon,
  sepolia,
} from "viem/chains";
import type { NetworkDefinition } from "./network-definitions";

/** Universal Multicall3 (same address on most EVM chains). */
const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const KNOWN_BY_CHAIN_ID: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [sepolia.id]: sepolia,
  [baseSepolia.id]: baseSepolia,
  [polygon.id]: polygon,
  [bsc.id]: bsc,
  [hardhat.id]: hardhat,
};

/**
 * Build a viem Chain for server-side clients (multicall, etc.): use viem's built-in
 * contracts (multicall3, …) and override RPC with getActiveNetwork().rpcUrl.
 */
export function viemChainForNetwork(net: NetworkDefinition): Chain {
  const known = KNOWN_BY_CHAIN_ID[net.chainId];
  if (known) {
    return defineChain({
      ...known,
      rpcUrls: {
        ...known.rpcUrls,
        default: { http: [net.rpcUrl] },
      },
    });
  }
  return defineChain({
    id: net.chainId,
    name: net.name,
    nativeCurrency: net.nativeCurrency,
    rpcUrls: { default: { http: [net.rpcUrl] } },
    contracts: {
      multicall3: {
        address: MULTICALL3_ADDRESS,
        blockCreated: 0,
      },
    },
  });
}
