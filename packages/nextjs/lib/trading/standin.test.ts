import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { getAddress } from "viem";

import { loadTradingConfig } from "./config";
import { DEPLOYMENT, SEPOLIA_CHAIN_ID } from "../deployment";
import { TradeGuard } from "./guard";
import { TradeOrchestrator } from "./orchestrator";
import { TradeRepository } from "./repository";
import { FIXTURE_ASSET, FIXTURE_CHAIN_ID, fixtureLookup } from "./test-fixtures";
import { describeStandIn, standInQuoteParams } from "./standin";
import type { UniswapGateway } from "./uniswap";

describe("Testnet stand-in execution", () => {
  const wallet = getAddress("0x1111111111111111111111111111111111111111");
  const feeRecipient = getAddress("0x2222222222222222222222222222222222222222");
  const router = getAddress("0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD");

  const config = loadTradingConfig({
    LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
    UNISWAP_API_KEY: "test-key",
    ALLOWED_TRADING_CHAINS: `${FIXTURE_CHAIN_ID},${SEPOLIA_CHAIN_ID}`,
  });

  const session = {
    challengeId: "ch-1",
    wallet,
    action: "read-account" as const,
    requestId: "req-1",
    expiresAt: new Date(Date.now() + 600_000),
  };

  const recommendation = {
    id: "rec_1",
    version: "ValueInvestingRecommendation.v1" as const,
    wallet,
    assetAddress: FIXTURE_ASSET.token,
    assetChainId: FIXTURE_CHAIN_ID,
    assetSymbol: FIXTURE_ASSET.symbol,
    calculations: [],
    disclaimer: "test",
    evidence: [],
    expiresAt: new Date(Date.now() + 600_000),
    generatedAt: new Date(),
    philosophyVersion: "1.0",
    risks: "low risk",
    runId: "run-1",
    stance: "undervalued" as const,
    thesis: "test thesis",
  };

  /** Records every chain a quote was requested for, and returns a usable classic quote. */
  function recordingGateway(seen: number[]): UniswapGateway {
    let counter = 0;
    return {
      fetchQuote: async params => {
        seen.push(params.chainId);
        counter += 1;
        return {
          kind: "classic" as const,
          quoteId: `q_${counter}`,
          wallet,
          chainId: params.chainId,
          recommendationId: recommendation.id,
          registryRevision: FIXTURE_ASSET.registryRevision,
          inputToken: params.inputToken,
          inputAmount: "100",
          outputToken: params.outputToken,
          minimumOutput: "1000000000000000000",
          transaction: {
            to: router,
            from: wallet,
            data: "0x1234" as const,
            value: "0",
            chainId: params.chainId,
          },
          fee: {
            bps: 10 as const,
            token: params.outputToken,
            amount: "1000",
            recipient: feeRecipient,
          },
          expiresAt: new Date(Date.now() + 30_000),
        };
      },
      checkApproval: async () => null,
      checkUniswapXOrderStatus: async () => ({ status: "open" as const }),
    };
  }

  function orchestrator(seen: number[]) {
    return new TradeOrchestrator(
      new TradeGuard(fixtureLookup),
      recordingGateway(seen),
      new TradeRepository(new Database(":memory:")),
      config,
    );
  }

  it("prices the real asset and signs a same-sized stand-in on testnet", async t => {
    if (!DEPLOYMENT.usesStandInExecution) {
      t.skip("mainnet deployment executes the quoted asset directly");
      return;
    }
    const seen: number[] = [];
    const result = await orchestrator(seen).requestQuote({
      sessionAction: session,
      recommendation,
      assetReference: FIXTURE_ASSET.symbol,
      chainId: FIXTURE_CHAIN_ID,
      amount: "100",
    });

    assert.equal(result.success, true, result.success ? "" : String(result.reason));
    if (!result.success) return;

    // Two quotes: the real asset for display, the stand-in for signing.
    assert.deepEqual(seen, [FIXTURE_CHAIN_ID, SEPOLIA_CHAIN_ID]);

    const standIn = standInQuoteParams();
    assert.equal(result.quote.chainId, standIn.chainId);
    assert.equal(result.quote.inputToken, standIn.inputToken);
    assert.equal(result.quote.outputToken, standIn.outputToken);

    // The displayed quote is the real asset on its own chain.
    assert.ok(result.displayQuote);
    assert.equal(result.displayQuote?.chainId, FIXTURE_CHAIN_ID);
    assert.equal(result.displayQuote?.outputToken, FIXTURE_ASSET.token);

    // The disclosure must be present and name both sides.
    assert.ok(result.standIn);
    assert.equal(result.standIn?.isStandIn, true);
    assert.equal(result.standIn?.quotedSymbol, FIXTURE_ASSET.symbol);
    assert.equal(result.standIn?.executedChainId, SEPOLIA_CHAIN_ID);

    // The persisted order must track the transaction that actually exists.
    assert.equal(result.order.quoteId, result.quote.quoteId);
  });

  it("executes the quoted asset directly on mainnet", async t => {
    if (DEPLOYMENT.usesStandInExecution) {
      t.skip("testnet deployment substitutes a stand-in swap");
      return;
    }
    const seen: number[] = [];
    const result = await orchestrator(seen).requestQuote({
      sessionAction: session,
      recommendation,
      assetReference: FIXTURE_ASSET.symbol,
      chainId: FIXTURE_CHAIN_ID,
      amount: "100",
    });

    assert.equal(result.success, true, result.success ? "" : String(result.reason));
    if (!result.success) return;

    assert.deepEqual(seen, [FIXTURE_CHAIN_ID]);
    assert.equal(result.quote.chainId, FIXTURE_CHAIN_ID);
    assert.equal(result.standIn, undefined);
    assert.equal(result.displayQuote, undefined);
  });

  it("always discloses both the quoted asset and the chain actually signed on", () => {
    const disclosure = describeStandIn(FIXTURE_ASSET);
    assert.equal(disclosure.isStandIn, true);
    assert.match(disclosure.reason, new RegExp(FIXTURE_ASSET.symbol));
    assert.match(disclosure.reason, /stand-in/i);
    assert.equal(disclosure.executedChainId, SEPOLIA_CHAIN_ID);
    assert.notEqual(disclosure.quotedChainId, disclosure.executedChainId);
  });

  it("rejects a quote routed to an unreviewed destination", async () => {
    // approvedDestinations previously had no enforcement consumer, so a changed or
    // compromised API response could aim the user's signature at any contract. The
    // stand-in swap is signed by the customer too, so it is checked on both targets.
    const rogue = getAddress("0x000000000000000000000000000000000000dEaD");
    const gateway: UniswapGateway = {
      fetchQuote: async params => ({
        kind: "classic" as const,
        quoteId: "q_rogue",
        wallet,
        chainId: params.chainId,
        recommendationId: recommendation.id,
        registryRevision: FIXTURE_ASSET.registryRevision,
        inputToken: params.inputToken,
        inputAmount: "100",
        outputToken: params.outputToken,
        minimumOutput: "1",
        transaction: { to: rogue, from: wallet, data: "0x1234" as const, value: "0", chainId: params.chainId },
        fee: { bps: 10 as const, token: params.outputToken, amount: "1", recipient: feeRecipient },
        expiresAt: new Date(Date.now() + 30_000),
      }),
      checkApproval: async () => null,
      checkUniswapXOrderStatus: async () => ({ status: "open" as const }),
    };
    const orch = new TradeOrchestrator(
      new TradeGuard(fixtureLookup),
      gateway,
      new TradeRepository(new Database(":memory:")),
      config,
    );

    const result = await orch.requestQuote({
      sessionAction: session,
      recommendation,
      assetReference: FIXTURE_ASSET.symbol,
      chainId: FIXTURE_CHAIN_ID,
      amount: "100",
    });

    assert.equal(result.success, false);
    if (!result.success) assert.match(String(result.reason), /unreviewed destination/);
  });

  it("asks for approval in base units and builds a bounded approve itself", async () => {
    // Regression: the human-readable amount was sent straight through. "100.0" is a 400
    // from the API, and a bare "100" is read as 100 wei — either way the swap reverts on
    // allowance. The approval is also built here, never forwarded from the API, so the
    // wallet is not handed arbitrary calldata or an unbounded allowance.
    const seenAmounts: string[] = [];
    const spender = getAddress("0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9");
    const gateway: UniswapGateway = {
      ...recordingGateway([]),
      checkApproval: async params => {
        seenAmounts.push(params.amountBaseUnits);
        return { spender, chainId: params.chainId };
      },
    };
    const orch = new TradeOrchestrator(
      new TradeGuard(fixtureLookup),
      gateway,
      new TradeRepository(new Database(":memory:")),
      config,
    );

    const result = await orch.requestQuote({
      sessionAction: session,
      recommendation,
      assetReference: FIXTURE_ASSET.symbol,
      chainId: FIXTURE_CHAIN_ID,
      amount: "100",
    });

    assert.equal(result.success, true, result.success ? "" : String(result.reason));
    if (!result.success) return;

    // 100 USDC at 6 decimals, as an integer string.
    assert.ok(seenAmounts.length > 0);
    for (const amount of seenAmounts) {
      assert.match(amount, /^[0-9]+$/, "amount must be base units");
      assert.equal(amount, "100000000");
    }

    const approval = result.approval;
    assert.ok(approval);
    assert.equal(approval?.spender, spender);
    assert.equal(approval?.value, "0");
    // Targets the token being spent, not whatever the API might name.
    assert.equal(approval?.to, result.quote.inputToken);
    // approve(spender, 100000000) — selector + exactly two words, and not max uint256.
    assert.equal(approval?.data.slice(0, 10), "0x095ea7b3");
    assert.equal(approval?.data.length, 138);
    assert.ok(!approval?.data.toLowerCase().endsWith("f".repeat(64)), "allowance must be bounded");
  });

  it("refuses an approval whose spender is not reviewed", async () => {
    const gateway: UniswapGateway = {
      ...recordingGateway([]),
      checkApproval: async params => ({
        spender: getAddress("0x000000000000000000000000000000000000dEaD"),
        chainId: params.chainId,
      }),
    };
    const orch = new TradeOrchestrator(
      new TradeGuard(fixtureLookup),
      gateway,
      new TradeRepository(new Database(":memory:")),
      config,
    );

    const result = await orch.requestQuote({
      sessionAction: session,
      recommendation,
      assetReference: FIXTURE_ASSET.symbol,
      chainId: FIXTURE_CHAIN_ID,
      amount: "100",
    });

    assert.equal(result.success, false);
    if (!result.success) assert.match(String(result.reason), /unreviewed spender/);
  });
});
