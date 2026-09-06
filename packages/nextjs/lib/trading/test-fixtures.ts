/**
 * Stable asset fixtures for trading tests.
 *
 * Policy and orchestration tests must not depend on which real-world assets happen to be
 * in the registry: issuers delist tokens, move them between chains, and drain pools. When
 * that happened to Dinari's AAPL.d and Backed's bCSPX it took five unrelated guard tests
 * down with it. These fixtures are test-only and are never exported from the registry.
 */
import { getAddress } from "viem";
import { APPROVED_ROUTE_DESTINATIONS, CURRENT_REGISTRY_REVISION } from "./registry";
import type { EligibleAsset } from "./types";
import type { AssetLookup } from "./guard";

export const FIXTURE_CHAIN_ID = 8453;

/** A plain, tradeable asset. */
export const FIXTURE_ASSET: EligibleAsset = {
  issuerId: "fixture",
  assetReference: "FIXT",
  researchSymbol: "FIXT",
  registryRevision: CURRENT_REGISTRY_REVISION,
  chainId: FIXTURE_CHAIN_ID,
  token: getAddress("0x2aE403F54F9D1c9B9e90E0d6aA3F7f2E59bF3B90"),
  symbol: "FIXT",
  decimals: 18,
  eligibility: "public",
  enabled: true,
  approvedDestinations: APPROVED_ROUTE_DESTINATIONS,
};

/** Exercises the `issuer-step-required` rejection path. */
export const FIXTURE_RESTRICTED_ASSET: EligibleAsset = {
  ...FIXTURE_ASSET,
  issuerId: "fixture-restricted",
  assetReference: "FIXT-restricted",
  symbol: "FIXT-restricted",
  token: getAddress("0x2aE403F54F9D1c9B9e90E0d6aA3F7f2E59bF3B91"),
  eligibility: "issuer-step-required",
  requiredCondition: "fixture-kyc-check",
};

const FIXTURES: readonly EligibleAsset[] = [FIXTURE_ASSET, FIXTURE_RESTRICTED_ASSET];

export const fixtureLookup: AssetLookup = (assetReference, chainId) => {
  const normalized = assetReference.trim().toUpperCase();
  return FIXTURES.find(
    asset =>
      asset.chainId === chainId &&
      (asset.assetReference.toUpperCase() === normalized ||
        asset.symbol.toUpperCase() === normalized ||
        asset.token.toLowerCase() === assetReference.trim().toLowerCase())
  );
};
