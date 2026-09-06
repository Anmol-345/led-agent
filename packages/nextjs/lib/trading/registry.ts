import { getAddress, isAddress, type Address } from "viem";
import type {
  AddressString,
  EligibleAsset,
  NonTradeableReason,
  TradingWalletIdentity,
} from "./types";

export const CURRENT_REGISTRY_REVISION = "leg-trade-registry-v1.1.0";

// Default approved destinations: Universal Router, Permit2, UniswapX Reactor on Base / Ethereum / Mainnet
export const APPROVED_ROUTE_DESTINATIONS: readonly Address[] = [
  // Uniswap Universal Router v1.2 Base / Mainnet
  "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
  // Uniswap Universal Router v1.2 Ethereum Mainnet
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  // The proxy current no-permit2 routes actually pull funds from. Verified by POST
  // /check_approval, whose approve() calldata names this spender, and by POST /swap, which
  // returns it as the transaction target — on Ethereum and Robinhood Chain alike.
  // Uniswap documents 0x0000000085E1… as the deterministic proxy, but live routes use this
  // one, so it must be allowlisted or every real swap is rejected here.
  "0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9",
  // Permit2
  "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  // Uniswap API proxy-approval flow
  "0x0000000085E102724e78eCd2F45DC9cA239Affad",
  // UniswapX Dutch Order Reactor
  "0x0000000000100fA8E71A19A62c76EAE825f385c5",
];

/**
 * Robinhood Chain (4663) prices tokenized equities against USDG, not USDC.
 * Every entry below was verified against POST /quote before being listed.
 */
export const ROBINHOOD_CHAIN_ID = 4663 as const;
export const ROBINHOOD_USDG = getAddress(
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
);

const ROBINHOOD_EQUITIES: readonly (readonly [string, string])[] = [
  ["NVDA", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"],
  ["TSLA", "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"],
  ["AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"],
  ["MSFT", "0xe93237C50D904957Cf27E7B1133b510C669c2e74"],
  ["AMZN", "0x12f190a9F9d7D37a250758b26824B97CE941bF54"],
  ["GOOGL", "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3"],
  ["META", "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35"],
  ["SPY", "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"],
  ["QQQ", "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"],
  ["AMD", "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC"],
  ["PLTR", "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A"],
  ["NFLX", "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8"],
  ["MSTR", "0xec262a75e413fAfD0dF80480274532C79D42da09"],
  ["COIN", "0x6330D8C3178a418788dF01a47479c0ce7CCF450b"],
];

const ROBINHOOD_ASSETS: readonly EligibleAsset[] = ROBINHOOD_EQUITIES.map(
  ([symbol, token]) => ({
    issuerId: "robinhood",
    assetReference: symbol,
    researchSymbol: symbol,
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: ROBINHOOD_CHAIN_ID,
    token: getAddress(token),
    symbol,
    decimals: 18,
    eligibility: "public",
    enabled: true,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  })
);

const INITIAL_REVIEWED_ASSETS: readonly EligibleAsset[] = [
  // Ondo Tokenized Stocks ("...on" series) - Live on Uniswap Trading API (Ethereum Chain ID 1 & Base 8453)
  {
    issuerId: "ondo",
    assetReference: "NVDAon",
    researchSymbol: "NVDA",
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: 1,
    token: getAddress("0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"),
    symbol: "NVDAon",
    decimals: 18,
    eligibility: "public",
    enabled: true,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  },
  {
    issuerId: "ondo",
    assetReference: "TSLAon",
    researchSymbol: "TSLA",
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: 1,
    token: getAddress("0xf6b1117ec07684d3958cad8beb1b302bfd21103f"),
    symbol: "TSLAon",
    decimals: 18,
    eligibility: "public",
    enabled: true,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  },
  {
    issuerId: "ondo",
    assetReference: "SPYon",
    researchSymbol: "SPY",
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: 1,
    token: getAddress("0xfedc5f4a6c38211c1338aa411018dfaf26612c08"),
    symbol: "SPYon",
    decimals: 18,
    eligibility: "public",
    enabled: true,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  },
  {
    issuerId: "ondo",
    assetReference: "QQQon",
    researchSymbol: "QQQ",
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: 1,
    token: getAddress("0x0e397938c1aa0680954093495b70a9f5e2249aba"),
    symbol: "QQQon",
    decimals: 18,
    eligibility: "public",
    enabled: true,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  },
  {
    issuerId: "ondo",
    assetReference: "MSFTon",
    researchSymbol: "MSFT",
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: 1,
    token: getAddress("0xb812837b81a3a6b81d7cd74cfb19a7f2784555e5"),
    symbol: "MSFTon",
    decimals: 18,
    eligibility: "public",
    enabled: true,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  },
  // AMZNon removed: eth_getCode on Ethereum returns no contract at
  // 0xbb8774fb9322cfd317042a1293c6f4460775a6f2. Re-add with a verified address if Ondo
  // publishes one.
  //
  // Ondo governance token. Previously listed on chain 8453, which was wrong — the address
  // has no code on Base. It lives on Ethereum, where it has real routable liquidity.
  {
    issuerId: "ondo",
    assetReference: "ONDO",
    researchSymbol: "ONDO",
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: 1,
    token: getAddress("0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3"),
    symbol: "ONDO",
    decimals: 18,
    eligibility: "public",
    enabled: true,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  },
  // Base Mainnet Assets
  //
  // Dinari AAPL.d / TSLA.d: the contracts do exist on Base (they report symbols "AAPL" and
  // "TSLA"), but they have no Uniswap liquidity — every quote returns 404 and no pool is
  // indexed. Disabled rather than deleted so they can be switched back on if pools appear.
  {
    issuerId: "dinari",
    assetReference: "AAPL.d",
    researchSymbol: "AAPL",
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: 8453,
    token: getAddress("0x41f7a63713e76c0ab800be03bae9f17b8a356348"),
    symbol: "AAPL.d",
    decimals: 18,
    eligibility: "public",
    enabled: false,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  },
  {
    issuerId: "dinari",
    assetReference: "TSLA.d",
    researchSymbol: "TSLA",
    registryRevision: CURRENT_REGISTRY_REVISION,
    chainId: 8453,
    token: getAddress("0x74ed07d83999bc5db0ffd850da0a6bd782abd39c"),
    symbol: "TSLA.d",
    decimals: 18,
    eligibility: "public",
    enabled: false,
    approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
  },
  // Backed bCSPX (…B92) and bCSPX-restricted (…B99) removed: neither address has any code
  // on Base, so they could never have traded.
  // Robinhood Chain (4663) tokenized equities — appended below.
  ...ROBINHOOD_ASSETS,
];

export function getEligibleAssets(chainId?: number): readonly EligibleAsset[] {
  return INITIAL_REVIEWED_ASSETS.filter(asset => {
    if (!asset.enabled) return false;
    if (chainId !== undefined && asset.chainId !== chainId) return false;
    return true;
  });
}

export function findEligibleAsset(
  assetReference: string,
  chainId: number
): EligibleAsset | undefined {
  const normRef = assetReference.trim().toUpperCase();
  return INITIAL_REVIEWED_ASSETS.find(
    asset =>
      asset.chainId === chainId &&
      (asset.assetReference.toUpperCase() === normRef ||
        asset.symbol.toUpperCase() === normRef ||
        asset.token.toLowerCase() === assetReference.trim().toLowerCase())
  );
}

export function validateAssetEligibility(
  asset: EligibleAsset,
  identity?: TradingWalletIdentity
): { usable: true } | { usable: false; reason: NonTradeableReason } {
  if (!asset.enabled) {
    return { usable: false, reason: "asset-disabled" };
  }
  if (asset.registryRevision !== CURRENT_REGISTRY_REVISION) {
    return { usable: false, reason: "registry-changed" };
  }
  if (asset.eligibility === "issuer-step-required") {
    // In current release, issuer-step-required entries have no verified bypass path
    return { usable: false, reason: "issuer-step-required" };
  }
  return { usable: true };
}
