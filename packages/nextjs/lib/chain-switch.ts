"use client";

import type { Chain } from "viem";
import { base, mainnet, sepolia } from "wagmi/chains";
import { robinhoodChain } from "./wagmi-config";
import { ROBINHOOD_CHAIN_ID, chainName } from "./deployment";

/**
 * Switching the wallet to whichever chain a trade settles on.
 *
 * We switch rather than bridge: the Trading API's cross-chain BRIDGE routing only moves
 * *matched* assets (Base USDC to Robinhood USDG works; Base USDC to Robinhood NVDA returns
 * 404), so buying a foreign-chain asset without switching would take two transactions plus
 * a bridge fee and leave a partial-failure state when the second leg fails. Switching is
 * one transaction and strictly cheaper.
 */

const KNOWN_CHAINS: Readonly<Record<number, Chain>> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [sepolia.id]: sepolia,
  [ROBINHOOD_CHAIN_ID]: robinhoodChain,
};

/** MetaMask returns 4902 when the chain is not in the wallet yet. */
const CHAIN_NOT_ADDED = 4902;

type ProviderError = { code?: number; message?: string };

function errorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as ProviderError & { cause?: ProviderError };
  return typeof candidate.code === "number"
    ? candidate.code
    : typeof candidate.cause?.code === "number"
      ? candidate.cause.code
      : undefined;
}

export type SwitchChainFn = (args: { chainId: number }) => Promise<unknown>;

export type AddChainFn = (args: {
  method: "wallet_addEthereumChain";
  params: [
    {
      chainId: string;
      chainName: string;
      nativeCurrency: { name: string; symbol: string; decimals: number };
      rpcUrls: string[];
      blockExplorerUrls?: string[];
    },
  ];
}) => Promise<unknown>;

/**
 * Move the wallet to `chainId`, adding the network first if the wallet does not know it.
 * Robinhood Chain is absent from most wallets, so the add path is the common case there.
 */
export async function ensureWalletOnChain(input: {
  chainId: number;
  currentChainId: number | undefined;
  switchChain: SwitchChainFn;
  addChain?: AddChainFn;
}): Promise<void> {
  const { chainId, currentChainId, switchChain, addChain } = input;
  if (currentChainId === chainId) return;

  try {
    await switchChain({ chainId });
    return;
  } catch (error) {
    if (errorCode(error) !== CHAIN_NOT_ADDED || !addChain) throw error;
  }

  const chain = KNOWN_CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Wallet does not have ${chainName(chainId)} and no network definition is available to add it.`
    );
  }

  await addChain({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: `0x${chainId.toString(16)}`,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [...chain.rpcUrls.default.http],
        ...(chain.blockExplorers?.default
          ? { blockExplorerUrls: [chain.blockExplorers.default.url] }
          : {}),
      },
    ],
  });

  // Adding does not always select it.
  await switchChain({ chainId });
}
