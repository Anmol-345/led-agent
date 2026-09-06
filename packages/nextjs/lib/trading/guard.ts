import { getAddress, type Address } from "viem";
import type { VerifiedCreditAction } from "../credits/auth";
import type { ValueInvestingRecommendation } from "../advisor/recommendation";
import type { TradingConfig } from "./config";
import {
  findEligibleAsset,
  validateAssetEligibility,
  CURRENT_REGISTRY_REVISION,
} from "./registry";
import type {
  EligibleAsset,
  NonTradeableReason,
  TradingWalletIdentity,
  ValidatedTradeQuote,
  ValueInvestingRecommendationV1,
} from "./types";
import { validateCanonicalBase10Amount } from "./types";
import { adaptAdvisorRecommendation, adaptCreditWalletSession } from "./upstream";

export type GuardQuoteValidationResult =
  | {
      usable: true;
      identity: TradingWalletIdentity;
      recommendation: ValueInvestingRecommendationV1;
      asset: EligibleAsset;
    }
  | { usable: false; reason: NonTradeableReason };

/** Resolves an asset reference on a chain. Injectable so policy tests do not depend on
 *  which real-world assets happen to be listed — issuers delist and move chains, and a
 *  dead registry entry should never take the guard's test suite down with it. */
export type AssetLookup = (
  assetReference: string,
  chainId: number
) => EligibleAsset | undefined;

export class TradeGuard {
  private readonly lookupAsset: AssetLookup;

  constructor(lookupAsset: AssetLookup = findEligibleAsset) {
    this.lookupAsset = lookupAsset;
  }

  validateQuoteRequest(input: {
    sessionAction: VerifiedCreditAction | null | undefined;
    recommendation: ValueInvestingRecommendation | null | undefined;
    assetReference: string;
    chainId: number;
    amount: string;
    config: TradingConfig;
    now?: Date;
  }): GuardQuoteValidationResult {
    const now = input.now || new Date();

    // 1. Session check
    const sessionRes = adaptCreditWalletSession(input.sessionAction, now);
    if (!sessionRes.usable) {
      return { usable: false, reason: sessionRes.reason };
    }
    const identity = sessionRes.identity;

    // 2. Recommendation check
    const recRes = adaptAdvisorRecommendation(
      input.recommendation,
      identity.wallet,
      now
    );
    if (!recRes.usable) {
      return { usable: false, reason: recRes.reason };
    }
    const rec = recRes.recommendation;

    // 3. Amount check
    if (!validateCanonicalBase10Amount(input.amount)) {
      return { usable: false, reason: "malformed-recommendation" };
    }

    // 4. Asset lookup & registry check
    const asset = this.lookupAsset(input.assetReference, input.chainId);
    if (!asset) {
      return { usable: false, reason: "asset-not-found" };
    }

    const assetCheck = validateAssetEligibility(asset, identity);
    if (!assetCheck.usable) {
      return { usable: false, reason: assetCheck.reason };
    }

    return {
      usable: true,
      identity,
      recommendation: rec,
      asset,
    };
  }

  validatePreparedAction(
    quote: ValidatedTradeQuote,
    wallet: Address,
    now: Date = new Date()
  ): { valid: true } | { valid: false; reason: NonTradeableReason } {
    const quoteWallet = quote.wallet || (quote as any).recipient;
    if (!quoteWallet || getAddress(quoteWallet) !== getAddress(wallet)) {
      return { valid: false, reason: "cross-wallet-recommendation" };
    }
    const expiresTime = (
      quote.expiresAt instanceof Date
        ? quote.expiresAt
        : new Date(quote.expiresAt)
    ).getTime();
    if (expiresTime <= now.getTime()) {
      return { valid: false, reason: "expired-recommendation" }; // quote expired
    }
    if (quote.registryRevision !== CURRENT_REGISTRY_REVISION) {
      return { valid: false, reason: "registry-changed" };
    }
    return { valid: true };
  }
}
