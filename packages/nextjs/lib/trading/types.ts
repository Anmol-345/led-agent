import { getAddress, isAddress, type Address, type Hex } from "viem";

export type AddressString = Address;

export type TradingWalletIdentity = {
  wallet: Address;
  action: "read-account";
  requestId: string;
  expiresAt: Date;
};

export type ValueInvestingRecommendationV1 = {
  id: string;
  version: "ValueInvestingRecommendation.v1";
  wallet: Address;
  assetAddress: Address;
  assetChainId: number;
  assetSymbol: string | null;
  stance: string;
  thesis: string;
  risks: string;
  generatedAt: Date;
  expiresAt: Date;
};

export type EligibilityMode = "public" | "issuer-step-required";

export type EligibleAsset = {
  issuerId: string;
  assetReference: string;
  /** The underlying market ticker used by research providers. */
  researchSymbol?: string;
  registryRevision: string;
  chainId: number;
  token: Address;
  symbol: string;
  decimals: number;
  eligibility: EligibilityMode;
  requiredCondition?: string;
  enabled: boolean;
  approvedDestinations: readonly Address[];
};

export type DecimalAmount = string;

export type NonTradeableReason =
  | "missing-session"
  | "expired-session"
  | "wrong-session-action"
  | "missing-recommendation"
  | "expired-recommendation"
  | "cross-wallet-recommendation"
  | "malformed-recommendation"
  | "asset-not-found"
  | "asset-disabled"
  | "issuer-step-required"
  | "registry-changed";

export type IntegratorFee = {
  bps: 10;
  token: Address;
  amount: DecimalAmount;
  recipient: Address;
};

export type ValidatedTransaction = {
  to: Address;
  from: Address;
  data: Hex;
  value: DecimalAmount;
  chainId: number;
};

export type ClassicQuote = {
  kind: "classic";
  quoteId: string;
  wallet: Address;
  chainId: number;
  recommendationId: string;
  registryRevision: string;
  inputToken: Address;
  inputAmount: DecimalAmount;
  outputToken: Address;
  minimumOutput: DecimalAmount;
  transaction: ValidatedTransaction;
  fee: IntegratorFee;
  expiresAt: Date;
};

export type UniswapXQuote = {
  kind: "uniswapx";
  quoteId: string;
  orderId: string;
  wallet: Address;
  chainId: number;
  recommendationId: string;
  registryRevision: string;
  deadline: Date;
  inputToken: Address;
  inputMaximum: DecimalAmount;
  outputToken: Address;
  outputMinimum: DecimalAmount;
  recipient: Address;
  fee: IntegratorFee;
  expiresAt: Date;
};

export type ValidatedTradeQuote = ClassicQuote | UniswapXQuote;

export type OrderStatus =
  | "quoted"
  | "awaiting-approval"
  | "awaiting-action"
  | "submitted"
  | "accepted"
  | "pending"
  | "settled"
  | "reverted"
  | "open"
  | "filled"
  | "expired"
  | "cancelled"
  | "failed";

export type TradeOrderRecord = {
  id: string;
  quoteId: string;
  wallet: Address;
  chainId: number;
  kind: "classic" | "uniswapx";
  recommendationId: string;
  registryRevision: string;
  providerOrderId: string | null;
  transactionHash: Hex | null;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type TradeReceiptRecord = {
  orderId: string;
  wallet: Address;
  chainId: number;
  kind: "classic" | "uniswapx";
  status: "settled" | "reverted" | "filled" | "expired" | "cancelled" | "failed";
  inputToken: Address;
  inputAmount: DecimalAmount;
  outputToken: Address;
  outputAmount: DecimalAmount;
  feeBps: 10;
  feeToken: Address;
  feeAmount: DecimalAmount;
  feeRecipient: Address;
  reference: string;
  settledAt: Date;
};

export type TradeFeeEventRecord = {
  orderId: string;
  wallet: Address;
  chainId: number;
  feeBps: 10;
  token: Address;
  amount: DecimalAmount;
  recipient: Address;
  reference: string;
  createdAt: Date;
};

export function validateCanonicalBase10Amount(amount: string): boolean {
  if (typeof amount !== "string") return false;
  const trimmed = amount.trim();
  if (trimmed === "" || trimmed !== amount) return false;
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount);
}

export function validateNormalizedAddress(address: string): address is Address {
  if (typeof address !== "string" || !isAddress(address)) return false;
  return address === getAddress(address);
}
