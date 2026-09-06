/**
 * Active network for the scaffold demo pages (identity, balances, debug, agent0).
 *
 * Derived from NEXT_PUBLIC_DEPLOY_TARGET so there is one switch for the whole repo rather
 * than a second one that can drift out of sync. The product flow does not read this — it
 * uses `packages/nextjs/lib/deployment.ts`, which is the source of truth for chains.
 *
 * Optional `rpcOverrides`: keys are chainId as string (e.g. "8453") or network id.
 */
export const targetNetwork =
  process.env.NEXT_PUBLIC_DEPLOY_TARGET === "mainnet" ? "base" : "sepolia";

export type TargetNetwork = "base" | "sepolia";

export const rpcOverrides: Record<string, string> = {};
