import { getAddress, isAddress, type Address } from "viem";
import type { VerifiedCreditAction } from "../credits/auth";
import type { ValueInvestingRecommendation } from "../advisor/recommendation";
import type {
  NonTradeableReason,
  TradingWalletIdentity,
  ValueInvestingRecommendationV1,
} from "./types";

export type SessionResult =
  | { usable: true; identity: TradingWalletIdentity }
  | { usable: false; reason: NonTradeableReason };

export type RecommendationResult =
  | { usable: true; recommendation: ValueInvestingRecommendationV1 }
  | { usable: false; reason: NonTradeableReason };

function toDate(val: Date | string | number | undefined | null): Date {
  if (val instanceof Date) return val;
  if (!val) return new Date(0);
  return new Date(val);
}

export function adaptCreditWalletSession(
  action: VerifiedCreditAction | null | undefined,
  now: Date = new Date()
): SessionResult {
  if (!action) {
    return { usable: false, reason: "missing-session" };
  }
  if (action.action !== "read-account") {
    return { usable: false, reason: "wrong-session-action" };
  }
  if (!action.wallet || !isAddress(action.wallet)) {
    return { usable: false, reason: "missing-session" };
  }

  const expiresAt = toDate(action.expiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    return { usable: false, reason: "expired-session" };
  }

  return {
    usable: true,
    identity: {
      wallet: getAddress(action.wallet),
      action: "read-account",
      requestId: action.requestId,
      expiresAt,
    },
  };
}

export function adaptAdvisorRecommendation(
  rec: ValueInvestingRecommendation | null | undefined,
  targetWallet: Address,
  now: Date = new Date()
): RecommendationResult {
  if (!rec) {
    return { usable: false, reason: "missing-recommendation" };
  }
  if (rec.version !== "ValueInvestingRecommendation.v1") {
    return { usable: false, reason: "malformed-recommendation" };
  }
  if (!rec.wallet || !isAddress(rec.wallet)) {
    return { usable: false, reason: "malformed-recommendation" };
  }
  if (getAddress(rec.wallet) !== getAddress(targetWallet)) {
    return { usable: false, reason: "cross-wallet-recommendation" };
  }

  const expiresAt = toDate(rec.expiresAt);
  const generatedAt = toDate(rec.generatedAt);

  if (expiresAt.getTime() <= now.getTime()) {
    return { usable: false, reason: "expired-recommendation" };
  }

  return {
    usable: true,
    recommendation: {
      id: rec.id,
      version: "ValueInvestingRecommendation.v1",
      wallet: getAddress(rec.wallet),
      assetAddress: getAddress(rec.assetAddress),
      assetChainId: rec.assetChainId,
      assetSymbol: rec.assetSymbol,
      stance: rec.stance,
      thesis: rec.thesis,
      risks: rec.risks,
      generatedAt,
      expiresAt,
    },
  };
}
