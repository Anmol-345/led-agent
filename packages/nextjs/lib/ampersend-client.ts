import {
  AccountWallet,
  wrapWithAmpersend,
  type X402Treasurer,
} from "@ampersend_ai/ampersend-sdk/x402";
import { createAmpersendTreasurer } from "@ampersend_ai/ampersend-sdk";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const AMPERSEND_BASE_URL =
  process.env.AMPERSEND_API_URL || "https://api.ampersend.ai";

const AMPERSEND_CHAIN_ID = Number(process.env.AMPERSEND_CHAIN_ID || "8453");

const X402_NETWORKS = (process.env.X402_NETWORKS || "base,base-sepolia").split(",").map(s => s.trim()).filter(Boolean);

async function resolveSigningKey(): Promise<string> {
  const fromEnv = (process.env.AMPERSEND_SIGNING_KEY || "").trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    "AMPERSEND_SIGNING_KEY is not set. Add it via: just enc AMPERSEND_SIGNING_KEY '0x...'",
  );
}

import { privateKeyToAccount } from "viem/accounts";

/**
 * Get an Ampersend wallet backed by AMPERSEND_SIGNING_KEY.
 * Resolves from env → error.
 */
export async function getAmpersendWallet(): Promise<AccountWallet> {
  const key = await resolveSigningKey();
  return new AccountWallet(privateKeyToAccount(key as `0x${string}`));
}

/**
 * Get a Treasurer that authorizes x402 payments via the Ampersend API.
 * Resolves signing key from env.
 *
 * Smart Account mode (preferred): set AMPERSEND_SMART_ACCOUNT_ADDRESS + signing key.
 * EOA mode: signing key only.
 */
export async function getAmpersendTreasurer(): Promise<X402Treasurer> {
  const key = await resolveSigningKey();

  const smartAccount = (process.env.AMPERSEND_SMART_ACCOUNT_ADDRESS || "").trim();
  if (smartAccount) {
    return createAmpersendTreasurer({
      smartAccountAddress: smartAccount as `0x${string}`,
      sessionKeyPrivateKey: key as `0x${string}`,
      apiUrl: AMPERSEND_BASE_URL,
      chainId: AMPERSEND_CHAIN_ID,
    });
  }

  return createAmpersendTreasurer({
    apiUrl: AMPERSEND_BASE_URL,
    walletConfig: { type: "eoa", privateKey: key as `0x${string}` },
  });
}

let _cachedPayFetch: typeof globalThis.fetch | null = null;

/**
 * Returns a fetch function that automatically handles x402 402-Payment-Required
 * responses by signing and attaching payment headers via the Ampersend wallet.
 */
export async function getPaymentFetch(): Promise<typeof globalThis.fetch> {
  if (_cachedPayFetch) return _cachedPayFetch;

  const treasurer = await getAmpersendTreasurer();
  const client = wrapWithAmpersend(new x402Client(), treasurer, X402_NETWORKS);
  _cachedPayFetch = wrapFetchWithPayment(fetch, client);
  return _cachedPayFetch;
}

export { AMPERSEND_BASE_URL };
