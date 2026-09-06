import { getAddress, type Address } from "viem";
import { DEPLOYMENT, SEPOLIA_CHAIN_ID, chainName } from "../deployment";
import type { EligibleAsset } from "./types";

/**
 * Stand-in execution for the testnet deployment.
 *
 * No tokenized stock exists on any testnet the Uniswap Trading API supports — verified by
 * `eth_getCode` against every Ondo, xStocks and Dinari address on Sepolia and Base Sepolia,
 * and by a census of the ~9,500 tokens with Uniswap pools there. Robinhood's own testnet
 * does host stock tokens, but the API rejects chain 46630 and no Uniswap is deployed on it.
 *
 * So on testnet the price shown to the user is a real, live mainnet quote for the real
 * asset, while the transaction they actually sign is a *different* swap on Sepolia, sized
 * to the same notional. That puts a genuine transaction in their wallet at zero cost and
 * keeps the whole pipeline exercised end to end.
 *
 * This is a demonstration device. Anything built on top of it MUST surface
 * `StandInExecution` to the user — see the banner in `app/page.tsx`.
 */

/** Sepolia is the only Trading-API testnet that actually routes. USDC -> WETH is verified
 *  working there, including with integrator fees attached. */
const SEPOLIA_USDC = getAddress("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
const SEPOLIA_WETH = getAddress("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");

export type StandInExecution = {
  /** Always true; present so clients can branch on its existence. */
  isStandIn: true;
  /** What the user actually asked for. */
  quotedSymbol: string;
  quotedChainId: number;
  quotedChainName: string;
  /** What is actually swapped on-chain. */
  executedChainId: number;
  executedChainName: string;
  executedInputToken: Address;
  executedOutputToken: Address;
  reason: string;
};

export type StandInQuoteParams = {
  chainId: number;
  inputToken: Address;
  outputToken: Address;
  inputDecimals: number;
};

export function standInEnabled(): boolean {
  return DEPLOYMENT.usesStandInExecution;
}

/** Swap parameters actually signed on testnet, replacing the real asset's. */
export function standInQuoteParams(): StandInQuoteParams {
  return {
    chainId: SEPOLIA_CHAIN_ID,
    inputToken: SEPOLIA_USDC,
    outputToken: SEPOLIA_WETH,
    inputDecimals: 6,
  };
}

export function describeStandIn(asset: EligibleAsset): StandInExecution {
  const params = standInQuoteParams();
  return {
    isStandIn: true,
    quotedSymbol: asset.symbol,
    quotedChainId: asset.chainId,
    quotedChainName: chainName(asset.chainId),
    executedChainId: params.chainId,
    executedChainName: chainName(params.chainId),
    executedInputToken: params.inputToken,
    executedOutputToken: params.outputToken,
    reason:
      `${asset.symbol} exists only on ${chainName(asset.chainId)} and cannot be traded on a ` +
      `testnet. The price shown is a live ${chainName(asset.chainId)} quote; the transaction ` +
      `you sign is a stand-in USDC swap on ${chainName(params.chainId)} of the same size.`,
  };
}
