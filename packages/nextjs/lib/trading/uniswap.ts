import { getAddress, isAddress, isHex, parseUnits, type Address, type Hex } from "viem";
import type { TradingConfig } from "./config";
import type {
  ClassicQuote,
  DecimalAmount,
  IntegratorFee,
  UniswapXQuote,
  ValidatedTradeQuote,
  ValidatedTransaction,
} from "./types";

export type UniswapQuoteParams = {
  wallet: Address;
  chainId: number;
  inputToken: Address;
  outputToken: Address;
  amount: DecimalAmount;
  tradeType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageBps?: number;
  recommendationId: string;
  registryRevision: string;
  inputDecimals?: number;
};

/**
 * Who the Trading API says must be approved to pull the input token.
 *
 * Only the spender is taken from the API. The approval transaction itself is built
 * locally for an exact amount, so no externally supplied calldata, value or target is
 * ever handed to the wallet, and the allowance is never unbounded (the API's own
 * approval calldata requests max uint256).
 */
export type RequiredSpender = {
  spender: Address;
  chainId: number;
};

export interface UniswapGateway {
  fetchQuote(
    params: UniswapQuoteParams,
    config: TradingConfig
  ): Promise<ValidatedTradeQuote>;

  /**
   * Ask the API which approval (if any) the swapper still owes.
   *
   * The spender must never be hardcoded: it is version- and chain-dependent, and the
   * historically hardcoded proxy (0x0000000085E1…) is not the one current routes actually
   * pull from (0x02E5be68…), so a hand-built approve leaves the swap reverting on
   * insufficient allowance. Returns null when the existing allowance already covers it.
   */
  checkApproval(
    params: {
      wallet: Address;
      token: Address;
      /** Base units (wei), not a human-readable decimal: the API rejects "100.0". */
      amountBaseUnits: string;
      chainId: number;
    },
    config: TradingConfig
  ): Promise<RequiredSpender | null>;

  checkUniswapXOrderStatus(
    orderId: string,
    config: TradingConfig
  ): Promise<{
    status: "open" | "filled" | "expired" | "cancelled" | "failed";
    txHash?: Hex;
    filledOutputAmount?: DecimalAmount;
  }>;
}

/**
 * Shared headers for /quote and /swap.
 *
 * Deliberately does NOT pin `x-universal-router-version`. Pinning it to "2.0" makes the
 * gateway 404 ("No quotes available") on chains that do not serve that router version —
 * Robinhood Chain (4663) is the case we hit, where an otherwise identical request routes
 * CLASSIC once the header is dropped. Without it the API picks a supported version per
 * chain. `x-permit2-disabled` was verified harmless on every chain we quote.
 */
function uniswapHeaders(config: TradingConfig): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-api-key": config.uniswapApiKey,
    "x-permit2-disabled": "true",
  };
}

/** `approve(address,uint256)` */
const APPROVE_SELECTOR = "0x095ea7b3";

/** Pull the spender out of approve() calldata, rejecting anything else. */
function decodeApproveSpender(data: string): Address | null {
  if (!isHex(data)) return null;
  // selector (4 bytes) + spender (32) + amount (32) = 68 bytes => 138 hex chars with 0x
  if (data.length !== 138) return null;
  if (data.slice(0, 10).toLowerCase() !== APPROVE_SELECTOR) return null;
  const spenderWord = data.slice(10, 74);
  // The address must be left-padded with zeroes; anything else is not a clean address.
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(spenderWord)) return null;
  const candidate = `0x${spenderWord.slice(24)}`;
  return isAddress(candidate) ? getAddress(candidate) : null;
}

export class DefaultUniswapGateway implements UniswapGateway {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchQuote(
    params: UniswapQuoteParams,
    config: TradingConfig
  ): Promise<ValidatedTradeQuote> {
    if (!config.allowedChains.includes(params.chainId)) {
      throw new Error(`Chain ID ${params.chainId} is not allowed.`);
    }

    // No synthetic-quote fallback. This used to fabricate a plausible quote with dummy
    // calldata whenever USE_UNISWAP_API was unset, which produced a transaction that could
    // only revert — and looked like a working trade right up until the user signed it.
    if (!config.useUniswapApi) {
      throw new Error(
        "Trading is disabled: USE_UNISWAP_API is not enabled, so no executable quote can be produced."
      );
    }

    // Convert base-10 amount (e.g. "100.0") to atomic units string (e.g. "100000000000000000000")
    let rawAmount = params.amount;
    try {
      const decimals = params.inputDecimals ?? 18;
      rawAmount = parseUnits(params.amount, decimals).toString();
    } catch {
      rawAmount = params.amount;
    }

    const payload = {
      type: params.tradeType,
      amount: rawAmount,
      tokenIn: params.inputToken,
      tokenOut: params.outputToken,
      tokenInChainId: params.chainId,
      tokenOutChainId: params.chainId,
      swapper: params.wallet,
      recipient: params.wallet,
      slippageTolerance: (params.slippageBps ?? 50) / 100,
      integratorFees: [
        { bips: config.integratorFeeBps, recipient: config.feeRecipient },
      ],
      protocols: ["V2", "V3", "V4"],
      routingPreference: "BEST_PRICE",
    };

    const response = await this.fetchImpl(
      `${config.uniswapApiBaseUrl}/quote`,
      {
        method: "POST",
        headers: uniswapHeaders(config),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error(
          "Uniswap API authentication failed (401). UNISWAP_API_KEY is missing, expired, or invalid on the server."
        );
      }
      const detail = errorText.trim() ||
        (response.status === 404
          ? "No route was found for this token pair on the requested chain."
          : "The Uniswap API returned no error details.");
      throw new Error(
        `Uniswap API quote request failed (${response.status}): ${detail}`
      );
    }

    const json = await response.json();
    if (json.routing === "CLASSIC" && json.quote && typeof json.quote === "object") {
      const swapResponse = await this.fetchImpl(
        `${config.uniswapApiBaseUrl}/swap`,
        {
          method: "POST",
          headers: uniswapHeaders(config),
          body: JSON.stringify({ quote: json.quote }),
        },
      );
      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        if (swapResponse.status === 401) {
          throw new Error(
            "Uniswap API authentication failed (401). UNISWAP_API_KEY is missing, expired, or invalid on the server."
          );
        }
        const detail = errorText.trim() || "The Uniswap API returned no error details.";
        throw new Error(`Uniswap API swap request failed (${swapResponse.status}): ${detail}`);
      }
      const swapJson = await swapResponse.json();
      if (!swapJson || typeof swapJson.swap !== "object") {
        throw new Error("Uniswap API swap response did not include a transaction.");
      }
      return this.parseAndValidateQuoteResponse(
        {
          ...json,
          methodParameters: {
            calldata: swapJson.swap.data,
            to: swapJson.swap.to,
            value: swapJson.swap.value,
          },
        },
        params,
        config,
      );
    }
    return this.parseAndValidateQuoteResponse(json, params, config);
  }

  async checkApproval(
    params: {
      wallet: Address;
      token: Address;
      amountBaseUnits: string;
      chainId: number;
    },
    config: TradingConfig
  ): Promise<RequiredSpender | null> {
    if (!/^[0-9]+$/.test(params.amountBaseUnits)) {
      throw new Error(
        `Uniswap approval check requires base units; received "${params.amountBaseUnits}".`
      );
    }

    const response = await this.fetchImpl(`${config.uniswapApiBaseUrl}/check_approval`, {
      method: "POST",
      headers: uniswapHeaders(config),
      body: JSON.stringify({
        walletAddress: params.wallet,
        token: params.token,
        amount: params.amountBaseUnits,
        chainId: params.chainId,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(
        `Uniswap API approval check failed (${response.status}): ${detail || "no details"}`
      );
    }

    const json = await response.json();
    if (!json || typeof json !== "object" || !("approval" in json)) {
      throw new Error("Uniswap approval check response has no approval field.");
    }

    const approval = json.approval;
    // ONLY an explicit null means the existing allowance already covers the swap. Anything
    // else that merely looks falsy — a missing field, false, 0, "" — must not be read as
    // "no approval needed": that skips the approval and sends the customer into a swap
    // that can only revert, after gas. Verified against the live API, which returns the
    // key present and explicitly null when no approval is required.
    if (approval === null) return null;
    if (typeof approval !== "object" || Array.isArray(approval)) {
      throw new Error(
        `Uniswap approval check returned a malformed approval (${typeof approval}).`
      );
    }

    const chainId = Number(approval.chainId ?? params.chainId);
    if (chainId !== params.chainId) {
      throw new Error(
        `Uniswap approval targets chain ${chainId}, expected ${params.chainId}.`
      );
    }
    // The approval must be an approve() on the very token being spent.
    if (!isAddress(String(approval.to)) || getAddress(String(approval.to)) !== getAddress(params.token)) {
      throw new Error("Uniswap approval targets a contract other than the input token.");
    }

    const spender = decodeApproveSpender(String(approval.data));
    if (!spender) {
      throw new Error("Uniswap approval calldata is not a recognizable approve() call.");
    }
    return { spender, chainId };
  }

  async checkUniswapXOrderStatus(
    orderId: string,
    config: TradingConfig
  ): Promise<{
    status: "open" | "filled" | "expired" | "cancelled" | "failed";
    txHash?: Hex;
    filledOutputAmount?: DecimalAmount;
  }> {
    try {
      const response = await this.fetchImpl(
        `${config.uniswapApiBaseUrl}/orders/${orderId}`,
        {
          headers: {
            "x-api-key": config.uniswapApiKey,
          },
        }
      );

      if (!response.ok) {
        return { status: "open" };
      }

      const json = (await response.json()) as Record<string, any>;
      const orderStatusStr = String(
        json.orderStatus || json.status || ""
      ).toLowerCase();

      if (orderStatusStr === "filled") {
        return {
          status: "filled",
          txHash: json.txHash || json.hash,
          filledOutputAmount: json.filledOutputAmount || json.outputAmount,
        };
      } else if (orderStatusStr === "expired") {
        return { status: "expired" };
      } else if (orderStatusStr === "cancelled") {
        return { status: "cancelled" };
      } else if (
        orderStatusStr === "failed" ||
        orderStatusStr === "insufficient_funds"
      ) {
        return { status: "failed" };
      }

      return { status: "open" };
    } catch {
      return { status: "open" };
    }
  }

  public parseAndValidateQuoteResponse(
    json: any,
    params: UniswapQuoteParams,
    config: TradingConfig
  ): ValidatedTradeQuote {
    if (!json || typeof json !== "object") {
      throw new Error("Invalid Uniswap API quote response: not an object.");
    }

    const routing = String(
      json.routing || json.quote?.routing || "CLASSIC"
    ).toUpperCase();
    const isUniswapX =
      routing === "DUTCH_LIMIT" ||
      routing === "DUTCH_V2" ||
      routing === "DUTCH_V3" ||
      routing === "PRIORITY" ||
      routing === "UNISWAP_X" ||
      routing === "UNISWAP_X_V2";

    // 1. Validate Fee
    const feeRecipientRaw =
      json.feeRecipient || json.portionRecipient || json.quote?.portionRecipient || json.quote?.feeRecipient;

    if (
      feeRecipientRaw &&
      isAddress(feeRecipientRaw) &&
      getAddress(feeRecipientRaw) !== getAddress(config.feeRecipient)
    ) {
      throw new Error("Fee recipient mismatch in Uniswap quote response.");
    }

    const feeRecipient =
      feeRecipientRaw && isAddress(feeRecipientRaw)
        ? getAddress(feeRecipientRaw)
        : getAddress(config.feeRecipient);

    const feeBps = Number(
      json.feeBps ?? json.portionBps ?? json.quote?.portionBps ?? 10
    );
    if (feeBps !== config.integratorFeeBps) {
      throw new Error("Integrator fee mismatch in Uniswap quote response.");
    }

    const outputAmountRaw = String(
      json.quote?.output?.amount || json.quote?.outputAmount || json.outputAmount || "0"
    );

    let feeAmountRaw = String(
      json.feeAmount || json.portionAmount || json.quote?.portionAmount || "0"
    );

    if ((feeAmountRaw === "0" || !feeAmountRaw) && outputAmountRaw !== "0" && feeBps > 0) {
      try {
        const outBig = BigInt(outputAmountRaw);
        const feeBig = (outBig * BigInt(feeBps)) / 10000n;
        feeAmountRaw = feeBig.toString();
      } catch {
        feeAmountRaw = "0";
      }
    }

    const feeTokenRaw =
      json.feeToken ||
      json.portionToken ||
      json.quote?.portionToken ||
      params.outputToken;

    if (!isAddress(feeTokenRaw)) {
      throw new Error("Invalid fee token address in Uniswap quote response.");
    }

    const fee: IntegratorFee = {
      bps: config.integratorFeeBps,
      token: getAddress(feeTokenRaw),
      amount: feeAmountRaw,
      recipient: feeRecipient,
    };

    // 2. Validate Customer Recipient
    const recipientRaw = json.recipient || json.quote?.recipient || params.wallet;
    if (
      !recipientRaw ||
      !isAddress(recipientRaw) ||
      getAddress(recipientRaw) !== getAddress(params.wallet)
    ) {
      throw new Error("Customer recipient mismatch in Uniswap quote response.");
    }

    const quoteId = String(json.quoteId || json.requestId || `q_${Date.now()}`);
    const expiresAt = new Date(
      Date.now() + Math.min(config.quoteTtlSeconds, 30) * 1000
    );

    if (isUniswapX) {
      const orderId = String(
        json.orderId || json.quote?.orderId || `ord_x_${Date.now()}`
      );
      const minimumOutput = String(
        json.quote?.orderInfo?.outputs?.[0]?.startAmount ||
          json.quote?.outputAmount ||
          json.outputAmount ||
          "0"
      );

      const quote: UniswapXQuote = {
        kind: "uniswapx",
        quoteId,
        orderId,
        wallet: getAddress(params.wallet),
        chainId: params.chainId,
        recommendationId: params.recommendationId,
        registryRevision: params.registryRevision,
        deadline: expiresAt,
        inputToken: getAddress(params.inputToken),
        inputMaximum: params.amount,
        outputToken: getAddress(params.outputToken),
        outputMinimum: minimumOutput,
        recipient: getAddress(params.wallet),
        fee,
        expiresAt,
      };

      return quote;
    } else {
      // Classic
      const methodParameters = json.methodParameters || json.quote?.methodParameters;
      const calldata = String(methodParameters?.calldata || json.quote?.calldata || "");
      const toAddress = String(methodParameters?.to || json.quote?.to || "");
      const value = String(methodParameters?.value || json.quote?.value || "0");

      if (!isHex(calldata) || calldata === "0x") {
        throw new Error("Uniswap API returned an empty swap transaction.");
      }
      if (!isAddress(toAddress)) {
        throw new Error("Uniswap API returned an invalid swap destination.");
      }

      const minimumOutput = String(
        json.quote?.output?.amount || json.quote?.outputAmount || json.outputAmount || "0"
      );

      const transaction: ValidatedTransaction = {
        to: getAddress(toAddress),
        from: getAddress(params.wallet),
        data: calldata,
        value,
        chainId: params.chainId,
      };

      const quote: ClassicQuote = {
        kind: "classic",
        quoteId,
        wallet: getAddress(params.wallet),
        chainId: params.chainId,
        recommendationId: params.recommendationId,
        registryRevision: params.registryRevision,
        inputToken: getAddress(params.inputToken),
        inputAmount: params.amount,
        outputToken: getAddress(params.outputToken),
        minimumOutput,
        transaction,
        fee,
        expiresAt,
      };

      return quote;
    }
  }
}
