import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import { loadTradingConfig } from "./config";
import { getEligibleAssets } from "./registry";

describe("Task 1.3 Chain & Trading Prerequisites", () => {
  const validFeeRecipient = getAddress("0x2222222222222222222222222222222222222222");

  it("verifies all registered issuer asset chains exist in allowed chains", () => {
    const assets = getEligibleAssets();
    // Deliberately omits ALLOWED_TRADING_CHAINS so this exercises the shipped default.
    // Adding an asset on a chain the default does not cover must fail here, not in prod.
    const config = loadTradingConfig({
      LEG_INTEGRATOR_FEE_RECIPIENT: validFeeRecipient,
      UNISWAP_API_KEY: "test-key",
    });

    for (const asset of assets) {
      assert.ok(
        config.allowedChains.includes(asset.chainId),
        `Asset chain ID ${asset.chainId} must be in allowedChains`
      );
    }
  });

  it("fails startup if RPC configuration for an allowed chain is invalid or missing", () => {
    assert.throws(
      () =>
        loadTradingConfig({
          LEG_INTEGRATOR_FEE_RECIPIENT: validFeeRecipient,
          UNISWAP_API_KEY: "test-key",
          ALLOWED_TRADING_CHAINS: "999999", // unconfigured chain
        }),
      /Missing RPC URL for chain ID 999999/
    );
  });
});
