import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import { DefaultUniswapGateway } from "./uniswap";
import { loadTradingConfig } from "./config";

describe("Task 2.1 Uniswap Gateway", () => {
  const dummyWallet = getAddress("0x1111111111111111111111111111111111111111");
  const feeRecipient = getAddress("0x2222222222222222222222222222222222222222");
  const routerAddress = getAddress("0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD");
  const tokenIn = getAddress("0x0000000000000000000000000000000000000001");
  const tokenOut = getAddress("0x0000000000000000000000000000000000000002");

  const config = loadTradingConfig({
    LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
    UNISWAP_API_KEY: "test-key",
    ALLOWED_TRADING_CHAINS: "8453",
    USE_UNISWAP_API: "true",
  });

  const gateway = new DefaultUniswapGateway();

  it("parses valid Classic quote response", () => {
    const json = {
      routing: "CLASSIC",
      quoteId: "q_123",
      recipient: dummyWallet,
      portionRecipient: feeRecipient,
      portionBps: 10,
      portionAmount: "0.1",
      portionToken: tokenOut,
      outputAmount: "99.5",
      methodParameters: {
        to: routerAddress,
        calldata: "0x12345678",
        value: "0",
      },
    };

    const result = gateway.parseAndValidateQuoteResponse(
      json,
      {
        wallet: dummyWallet,
        chainId: 8453,
        inputToken: tokenIn,
        outputToken: tokenOut,
        amount: "100.0",
        tradeType: "EXACT_INPUT",
        recommendationId: "rec_1",
        registryRevision: "leg-trade-registry-v1.0.0",
      },
      config
    );

    assert.equal(result.kind, "classic");
    if (result.kind === "classic") {
      assert.equal(result.transaction.to, routerAddress);
      assert.equal(result.fee.amount, "0.1");
      assert.equal(result.fee.recipient, feeRecipient);
    }
  });

  it("parses valid UniswapX quote response", () => {
    const json = {
      routing: "DUTCH_LIMIT",
      quoteId: "q_x_123",
      orderId: "ord_x_999",
      recipient: dummyWallet,
      portionRecipient: feeRecipient,
      portionBps: 10,
      portionAmount: "0.1",
      portionToken: tokenOut,
      outputAmount: "99.5",
    };

    const result = gateway.parseAndValidateQuoteResponse(
      json,
      {
        wallet: dummyWallet,
        chainId: 8453,
        inputToken: tokenIn,
        outputToken: tokenOut,
        amount: "100.0",
        tradeType: "EXACT_INPUT",
        recommendationId: "rec_1",
        registryRevision: "leg-trade-registry-v1.0.0",
      },
      config
    );

    assert.equal(result.kind, "uniswapx");
    if (result.kind === "uniswapx") {
      assert.equal(result.orderId, "ord_x_999");
      assert.equal(result.fee.recipient, feeRecipient);
    }
  });

  it("handles USE_UNISWAP_API=true API fetch with mock response", async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const bodyStr = String(init?.body || "");
      assert.ok(bodyStr.includes('"tokenInChainId":8453'));
      assert.ok(bodyStr.includes('"tokenOutChainId":8453'));
      assert.ok(bodyStr.includes('"slippageTolerance":0.5'));
      assert.ok(bodyStr.includes('"integratorFees":[{"bips":10,"recipient":"' + feeRecipient));
      assert.ok(!bodyStr.includes('"feeBps"'));
      assert.equal(new Headers(init?.headers).get("x-permit2-disabled"), "true");
      // Regression: pinning the Universal Router version makes the gateway 404 on chains
      // that do not serve it (Robinhood Chain 4663 returns "No quotes available" with the
      // header and routes CLASSIC without it). It must never be sent.
      assert.equal(
        new Headers(init?.headers).get("x-universal-router-version"),
        null
      );

      return {
        ok: true,
        json: async () => ({
          routing: "CLASSIC",
          quoteId: "q_api_test",
          recipient: dummyWallet,
          portionRecipient: feeRecipient,
          portionBps: 10,
          portionAmount: "0.1",
          portionToken: tokenOut,
          outputAmount: "99.5",
          methodParameters: {
            to: routerAddress,
            calldata: "0x12345678",
            value: "0",
          },
        }),
      } as Response;
    };

    const mockGateway = new DefaultUniswapGateway(mockFetch as any);
    const quote = await mockGateway.fetchQuote(
      {
        wallet: dummyWallet,
        chainId: 8453,
        inputToken: tokenIn,
        outputToken: tokenOut,
        amount: "100.0",
        tradeType: "EXACT_INPUT",
        recommendationId: "rec_1",
        registryRevision: "leg-trade-registry-v1.0.0",
      },
      config
    );

    assert.equal(quote.kind, "classic");
    assert.equal(quote.fee.bps, 10);
    assert.equal(quote.fee.recipient, feeRecipient);
  });

  it("refuses to invent a quote when USE_UNISWAP_API is disabled", async () => {
    const offConfig = loadTradingConfig({
      LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
      ALLOWED_TRADING_CHAINS: "8453",
      USE_UNISWAP_API: "false",
    });

    // Regression: this used to return a synthetic quote carrying dummy calldata, which
    // could only ever revert once signed. Disabled trading must fail loudly instead.
    await assert.rejects(
      () =>
        gateway.fetchQuote(
          {
            wallet: dummyWallet,
            chainId: 8453,
            inputToken: tokenIn,
            outputToken: tokenOut,
            amount: "100.0",
            tradeType: "EXACT_INPUT",
            recommendationId: "rec_1",
            registryRevision: "leg-trade-registry-v1.0.0",
          },
          offConfig
        ),
      /USE_UNISWAP_API/
    );
  });

  it("explains an invalid live API key", async () => {
    const unauthorizedFetch: typeof fetch = async () =>
      new Response(null, { status: 401 });
    const unauthorizedGateway = new DefaultUniswapGateway(unauthorizedFetch);

    await assert.rejects(
      unauthorizedGateway.fetchQuote(
        {
          wallet: dummyWallet,
          chainId: 8453,
          inputToken: tokenIn,
          outputToken: tokenOut,
          amount: "100.0",
          tradeType: "EXACT_INPUT",
          recommendationId: "rec_1",
          registryRevision: "leg-trade-registry-v1.0.0",
        },
        config,
      ),
      /Uniswap API authentication failed \(401\)/,
    );
  });

  it("rejects response with mismatched fee recipient", () => {
    const wrongRecipient = getAddress("0x9999999999999999999999999999999999999999");
    const json = {
      routing: "CLASSIC",
      portionRecipient: wrongRecipient,
      portionBps: 10,
      portionAmount: "0.1",
      methodParameters: { to: routerAddress, calldata: "0x123" },
    };

    assert.throws(
      () =>
        gateway.parseAndValidateQuoteResponse(
          json,
          {
            wallet: dummyWallet,
            chainId: 8453,
            inputToken: tokenIn,
            outputToken: tokenOut,
            amount: "100.0",
            tradeType: "EXACT_INPUT",
            recommendationId: "rec_1",
            registryRevision: "leg-trade-registry-v1.0.0",
          },
          config
        ),
      /Fee recipient mismatch/
    );
  });

  it("only treats an explicit null approval as a sufficient allowance", async () => {
    // Regression: anything falsy — a missing field, false, 0, "" — was read as "no
    // approval needed", skipping the approval and sending the customer into a swap that
    // could only revert. The live API returns the key present and explicitly null when
    // none is required, so everything else is malformed and must fail closed.
    const liveConfig = loadTradingConfig({
      LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
      UNISWAP_API_KEY: "test-key",
      USE_UNISWAP_API: "true",
      ALLOWED_TRADING_CHAINS: "1",
    });
    const params = {
      wallet: dummyWallet,
      token: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
      amountBaseUnits: "100000000",
      chainId: 1,
    } as const;
    const gatewayFor = (body: unknown) =>
      new DefaultUniswapGateway(
        (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch,
      );

    // The one shape that legitimately means "already approved".
    assert.equal(await gatewayFor({ approval: null }).checkApproval(params, liveConfig), null);

    for (const malformed of [
      { requestId: "no-approval-key" },
      { approval: false },
      { approval: 0 },
      { approval: "" },
      { approval: "nope" },
      { approval: [] },
    ]) {
      await assert.rejects(
        () => gatewayFor(malformed).checkApproval(params, liveConfig),
        /approval/i,
        `expected rejection for ${JSON.stringify(malformed)}`,
      );
    }
  });

  it("rejects a human-readable amount before calling the API", async () => {
    const liveConfig = loadTradingConfig({
      LEG_INTEGRATOR_FEE_RECIPIENT: feeRecipient,
      UNISWAP_API_KEY: "test-key",
      USE_UNISWAP_API: "true",
      ALLOWED_TRADING_CHAINS: "1",
    });
    let called = false;
    const gateway = new DefaultUniswapGateway(
      (async () => {
        called = true;
        return { ok: true, json: async () => ({ approval: null }) };
      }) as unknown as typeof fetch,
    );
    await assert.rejects(
      () =>
        gateway.checkApproval(
          {
            wallet: dummyWallet,
            token: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
            amountBaseUnits: "100.0",
            chainId: 1,
          },
          liveConfig,
        ),
      /base units/,
    );
    assert.equal(called, false, "must not reach the API with a decimal amount");
  });
});
