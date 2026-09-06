import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import {
  loadTradingConfig,
  QUOTE_TTL_SECONDS,
  INTEGRATOR_FEE_BPS,
} from "./config";
import {
  findEligibleAsset,
  getEligibleAssets,
  validateAssetEligibility,
  CURRENT_REGISTRY_REVISION,
} from "./registry";
import { FIXTURE_RESTRICTED_ASSET } from "./test-fixtures";
import { adaptAdvisorRecommendation, adaptCreditWalletSession } from "./upstream";
import {
  validateCanonicalBase10Amount,
  validateNormalizedAddress,
} from "./types";

describe("Task 1.1 Foundation & Registry", () => {
  const dummyWallet = getAddress("0x1111111111111111111111111111111111111111");
  const feeRecipient = getAddress("0x2222222222222222222222222222222222222222");

  describe("Types & Validation", () => {
    it("validates canonical base 10 amounts", () => {
      assert.equal(validateCanonicalBase10Amount("100.50"), true);
      assert.equal(validateCanonicalBase10Amount("0"), true);
      assert.equal(validateCanonicalBase10Amount("12345678901234567890"), true);
      assert.equal(validateCanonicalBase10Amount("-5"), false);
      assert.equal(validateCanonicalBase10Amount(" 100 "), false);
      assert.equal(validateCanonicalBase10Amount("abc"), false);
    });

    it("validates normalized addresses", () => {
      assert.equal(validateNormalizedAddress(dummyWallet), true);
      assert.equal(validateNormalizedAddress("0x1111111111111111111111111111111111111111"), true);
      assert.equal(validateNormalizedAddress("0x1111"), false);
    });
  });

  describe("Config", () => {
    it("loads configuration successfully with required secrets", () => {
      const config = loadTradingConfig({
        LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
        UNISWAP_API_KEY: "test-key",
        ALLOWED_TRADING_CHAINS: "8453",
        TRADING_RPC_URL_8453: "https://mainnet.base.org",
      });

      assert.equal(config.quoteTtlSeconds, QUOTE_TTL_SECONDS);
      assert.equal(config.integratorFeeBps, INTEGRATOR_FEE_BPS);
      assert.equal(config.feeRecipient, feeRecipient);
      assert.equal(config.uniswapApiKey, "test-key");
    });

    it("fails configuration if LEG_INTEGRATOR_FEE_RECIPIENT is invalid", () => {
      assert.throws(
        () =>
          loadTradingConfig({
            LEG_INTEGRATOR_FEE_RECIPIENT: "invalid-address",
          }),
        /LEG_INTEGRATOR_FEE_RECIPIENT must be a valid EVM address/
      );
    });

    it("fails configuration if UNISWAP_API_KEY is missing in strict mode", () => {
      assert.throws(
        () =>
          loadTradingConfig(
            { LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient },
            { strictKeyCheck: true }
          ),
        /UNISWAP_API_KEY must be provided/
      );
    });

    it("requires a key when the live Uniswap API is enabled", () => {
      assert.throws(
        () =>
          loadTradingConfig({
            LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
            USE_UNISWAP_API: "true",
          }),
        /USE_UNISWAP_API is enabled but UNISWAP_API_KEY is missing/
      );
    });
  });

  describe("Registry", () => {
    it("retrieves public eligible assets for a chain", () => {
      // Robinhood Chain carries the tokenized equities; Base currently has none enabled.
      const assets = getEligibleAssets(4663);
      assert.ok(assets.length > 0);
      assert.equal(assets.every(a => a.chainId === 4663), true);
      assert.equal(assets.every(a => a.enabled), true);
    });

    it("finds eligible asset by reference", () => {
      const asset = findEligibleAsset("NVDA", 4663);
      assert.ok(asset);
      assert.equal(asset?.symbol, "NVDA");
    });

    it("omits disabled assets from the eligible list", () => {
      // AAPL.d exists in the registry but is disabled (no Uniswap liquidity on Base).
      assert.ok(findEligibleAsset("AAPL.d", 8453));
      assert.equal(
        getEligibleAssets(8453).some(a => a.symbol === "AAPL.d"),
        false
      );
    });

    it("rejects asset requiring unavailable issuer step", () => {
      // Uses a fixture, not a live listing: no real asset currently carries this flag,
      // but the rejection path must stay covered.
      const result = validateAssetEligibility(FIXTURE_RESTRICTED_ASSET);
      assert.equal(result.usable, false);
      if (!result.usable) {
        assert.equal(result.reason, "issuer-step-required");
      }
    });
  });

  describe("Upstream Adapters", () => {
    const futureDate = new Date(Date.now() + 600000);
    const pastDate = new Date(Date.now() - 60000);

    it("accepts valid read-account credit session", () => {
      const session = adaptCreditWalletSession({
        challengeId: "ch-1",
        wallet: dummyWallet,
        action: "read-account",
        requestId: "req-1",
        expiresAt: futureDate,
      });

      assert.equal(session.usable, true);
      if (session.usable) {
        assert.equal(session.identity.wallet, dummyWallet);
      }
    });

    it("rejects expired credit session", () => {
      const session = adaptCreditWalletSession({
        challengeId: "ch-1",
        wallet: dummyWallet,
        action: "read-account",
        requestId: "req-1",
        expiresAt: pastDate,
      });

      assert.equal(session.usable, false);
      if (!session.usable) {
        assert.equal(session.reason, "expired-session");
      }
    });

    it("accepts matching advisor recommendation", () => {
      const rec = adaptAdvisorRecommendation(
        {
          id: "rec-1",
          version: "ValueInvestingRecommendation.v1",
          wallet: dummyWallet,
          assetAddress: getAddress("0x3333333333333333333333333333333333333333"),
          assetChainId: 8453,
          assetSymbol: "AAPL.d",
          calculations: [],
          disclaimer: "test",
          evidence: [],
          expiresAt: futureDate,
          generatedAt: new Date(),
          philosophyVersion: "1.0",
          risks: "low risk",
          runId: "run-1",
          stance: "undervalued",
          thesis: "strong fundamentals",
        },
        dummyWallet
      );

      assert.equal(rec.usable, true);
      if (rec.usable) {
        assert.equal(rec.recommendation.id, "rec-1");
      }
    });

    it("rejects cross-wallet recommendation", () => {
      const otherWallet = getAddress("0x9999999999999999999999999999999999999999");
      const rec = adaptAdvisorRecommendation(
        {
          id: "rec-1",
          version: "ValueInvestingRecommendation.v1",
          wallet: otherWallet,
          assetAddress: getAddress("0x3333333333333333333333333333333333333333"),
          assetChainId: 8453,
          assetSymbol: "AAPL.d",
          calculations: [],
          disclaimer: "test",
          evidence: [],
          expiresAt: futureDate,
          generatedAt: new Date(),
          philosophyVersion: "1.0",
          risks: "low risk",
          runId: "run-1",
          stance: "undervalued",
          thesis: "strong fundamentals",
        },
        dummyWallet
      );

      assert.equal(rec.usable, false);
      if (!rec.usable) {
        assert.equal(rec.reason, "cross-wallet-recommendation");
      }
    });
  });
});
