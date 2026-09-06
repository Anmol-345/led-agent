import { encodeFunctionData, erc20Abi, getAddress, parseUnits, type Address, type Hex } from "viem";
import type { VerifiedCreditAction } from "../credits/auth";
import type { ValueInvestingRecommendation } from "../advisor/recommendation";
import type { TradingConfig } from "./config";
import { TradeGuard } from "./guard";
import type { TradeRepository } from "./repository";
import type { RequiredSpender, UniswapGateway } from "./uniswap";
import type {
  NonTradeableReason,
  TradeOrderRecord,
  TradeReceiptRecord,
  ValidatedTradeQuote,
} from "./types";
import {
  describeStandIn,
  standInEnabled,
  standInQuoteParams,
  type StandInExecution,
} from "./standin";
import { adaptCreditWalletSession } from "./upstream";

/**
 * The approval transaction, built here rather than forwarded from the API: the target,
 * value and amount are all ours, and the spender has been decoded and allowlisted.
 */
export type RequiredApproval = {
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
  spender: Address;
};

export type OrchestratorQuoteResult =
  | {
      success: true;
      /** The quote that will actually be signed. */
      quote: ValidatedTradeQuote;
      order: TradeOrderRecord;
      /** Approval the wallet still owes before the swap can settle, or null if none. */
      approval?: RequiredApproval | null;

      /** Testnet only: the real mainnet quote for the asset the customer asked about,
       *  shown in the UI while `quote` above is what gets executed. */
      displayQuote?: ValidatedTradeQuote;
      /** Present only when the executed swap is not the quoted asset. */
      standIn?: StandInExecution;
    }
  | {
      success: false;
      reason: NonTradeableReason | string;
    };

/** Settlement token per chain. Robinhood Chain prices equities in USDG, not USDC. */
const DEFAULT_INPUT_TOKENS: Readonly<
  Record<number, { address: string; decimals: number }>
> = {
  // Ethereum Mainnet USDC
  1: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  // Base Mainnet USDC
  8453: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  // Robinhood Chain USDG
  4663: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  // Ethereum Sepolia USDC (Circle)
  11155111: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
  // Base Sepolia USDC (Circle)
  84532: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
};

function getDefaultInputToken(chainId: number): { address: Address; decimals: number } {
  const token = DEFAULT_INPUT_TOKENS[chainId];
  // Never fall back to another chain's token: the swap would reference an address
  // that does not exist on `chainId` and fail late, after the user has signed.
  if (!token) {
    throw new Error(`No settlement token is configured for chain ID ${chainId}.`);
  }
  return { address: getAddress(token.address), decimals: token.decimals };
}

export class TradeOrchestrator {
  private readonly guard: TradeGuard;
  private readonly gateway: UniswapGateway;
  private readonly repo: TradeRepository;
  private readonly config: TradingConfig;

  constructor(
    guard: TradeGuard,
    gateway: UniswapGateway,
    repo: TradeRepository,
    config: TradingConfig
  ) {
    this.guard = guard;
    this.gateway = gateway;
    this.repo = repo;
    this.config = config;
  }

  async requestQuote(input: {
    sessionAction: VerifiedCreditAction | null | undefined;
    recommendation: ValueInvestingRecommendation | null | undefined;
    assetReference: string;
    chainId: number;
    amount: string;
    inputTokenAddress?: Address;
  }): Promise<OrchestratorQuoteResult> {
    const validation = this.guard.validateQuoteRequest({
      sessionAction: input.sessionAction,
      recommendation: input.recommendation,
      assetReference: input.assetReference,
      chainId: input.chainId,
      amount: input.amount,
      config: this.config,
    });

    if (!validation.usable) {
      return { success: false, reason: validation.reason };
    }

    const { identity, recommendation, asset } = validation;
    const defaultInput = getDefaultInputToken(asset.chainId);
    const inputToken = input.inputTokenAddress || defaultInput.address;
    const inputDecimals = getAddress(inputToken) === defaultInput.address ? defaultInput.decimals : 18;

    try {
      // The real, live quote for the asset the customer actually asked about. On mainnet
      // this is also what gets signed; on testnet it is shown but not executed.
      const displayQuote = await this.gateway.fetchQuote(
        {
          wallet: identity.wallet,
          chainId: asset.chainId,
          inputToken: getAddress(inputToken),
          outputToken: getAddress(asset.token),
          amount: input.amount,
          tradeType: "EXACT_INPUT",
          recommendationId: recommendation.id,
          registryRevision: asset.registryRevision,
          inputDecimals,
        },
        this.config
      );

      if (!standInEnabled()) {
        this.assertApprovedDestination(displayQuote, asset);
        this.repo.saveQuote(displayQuote);
        return {
          success: true,
          quote: displayQuote,
          order: this.repo.createOrderFromQuote(displayQuote.quoteId),
          approval: await this.approvalFor(
            displayQuote,
            identity.wallet,
            inputDecimals,
            asset.approvedDestinations,
          ),
        };
      }

      // Testnet: sign a same-sized stand-in swap on Sepolia instead. The persisted quote is
      // the executable one so order tracking follows the transaction that actually exists.
      const standIn = standInQuoteParams();
      const executionQuote = await this.gateway.fetchQuote(
        {
          wallet: identity.wallet,
          chainId: standIn.chainId,
          inputToken: standIn.inputToken,
          outputToken: standIn.outputToken,
          amount: input.amount,
          tradeType: "EXACT_INPUT",
          recommendationId: recommendation.id,
          registryRevision: asset.registryRevision,
          inputDecimals: standIn.inputDecimals,
        },
        this.config
      );

      // The stand-in swap is signed by the customer just like a real one, so it gets the
      // same destination allowlisting rather than being trusted because it is "only" a demo.
      this.assertApprovedDestination(executionQuote, asset);
      this.repo.saveQuote(executionQuote);
      return {
        success: true,
        quote: executionQuote,
        order: this.repo.createOrderFromQuote(executionQuote.quoteId),
        approval: await this.approvalFor(
          executionQuote,
          identity.wallet,
          standIn.inputDecimals,
          asset.approvedDestinations,
        ),
        displayQuote,
        standIn: describeStandIn(asset),
      };
    } catch (err: any) {
      return {
        success: false,
        reason: err.message || "Failed to fetch quote from Uniswap",
      };
    }
  }

  /**
   * Refuse a quote whose transaction targets something outside the asset's reviewed
   * destinations. The registry has always carried `approvedDestinations` but nothing
   * consumed it, so a compromised or changed API response could have directed the user's
   * signature at an arbitrary contract.
   */
  private assertApprovedDestination(
    quote: ValidatedTradeQuote,
    asset: { symbol: string; approvedDestinations: readonly Address[] },
  ): void {
    if (quote.kind !== "classic") return;
    const destination = getAddress(quote.transaction.to);
    const approved = asset.approvedDestinations.some(
      candidate => getAddress(candidate) === destination,
    );
    if (!approved) {
      throw new Error(
        `Uniswap API routed ${asset.symbol} to an unreviewed destination (${destination}).`,
      );
    }
  }

  /**
   * Approval the wallet still owes for this quote's input token, or null if the existing
   * allowance already covers it.
   *
   * Only the spender comes from the API; the transaction is built here for exactly the
   * amount being spent. A failure is not swallowed into "no approval needed" — doing that
   * sent the customer straight to a swap that could only revert on allowance.
   */
  private async approvalFor(
    quote: ValidatedTradeQuote,
    wallet: Address,
    inputDecimals: number,
    approvedDestinations: readonly Address[],
  ): Promise<RequiredApproval | null> {
    const humanAmount = quote.kind === "classic" ? quote.inputAmount : quote.inputMaximum;
    // The API validates `amount` against /^[0-9]+$/ and reads it as base units, so a
    // human-readable "100.0" is a 400 and a bare "100" silently means 100 wei.
    const amountBaseUnits = parseUnits(humanAmount, inputDecimals);

    const required = await this.gateway.checkApproval(
      {
        wallet,
        token: quote.inputToken,
        amountBaseUnits: amountBaseUnits.toString(),
        chainId: quote.chainId,
      },
      this.config,
    );
    if (!required) return null;

    const spender = getAddress(required.spender);
    if (!approvedDestinations.some(candidate => getAddress(candidate) === spender)) {
      throw new Error(
        `Uniswap API asked to approve an unreviewed spender (${spender}).`,
      );
    }

    return {
      to: quote.inputToken,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        // Exactly what this swap spends — never an unbounded allowance.
        args: [spender, amountBaseUnits],
      }),
      value: "0",
      chainId: quote.chainId,
      spender,
    };
  }

  async prepareAction(input: {
    quoteId: string;
    wallet?: Address;
    sessionAction?: VerifiedCreditAction | null;
    now?: Date;
  }): Promise<{ success: true; quote: ValidatedTradeQuote } | { success: false; reason: string }> {
    const sessionRes = adaptCreditWalletSession(input.sessionAction, input.now);
    if (!sessionRes.usable) {
      return { success: false, reason: sessionRes.reason };
    }

    const quote = this.repo.getQuote(input.quoteId);
    if (!quote) {
      return { success: false, reason: "quote-not-found" };
    }

    const targetWallet = input.wallet || sessionRes.identity.wallet;
    const validRes = this.guard.validatePreparedAction(quote, targetWallet, input.now);
    if (!validRes.valid) {
      return { success: false, reason: validRes.reason };
    }

    return { success: true, quote };
  }

  async recordOrderSubmission(input: {
    orderId: string;
    sessionAction?: VerifiedCreditAction | null;
    transactionHash?: Hex;
    providerOrderId?: string;
    now?: Date;
  }): Promise<{ success: true; order: TradeOrderRecord } | { success: false; reason: string }> {
    const sessionRes = adaptCreditWalletSession(input.sessionAction, input.now);
    if (!sessionRes.usable) {
      return { success: false, reason: sessionRes.reason };
    }

    const existingOrder = this.repo.getOrder(input.orderId);
    if (!existingOrder) {
      return { success: false, reason: "order-not-found" };
    }

    const updated = this.repo.acknowledgeSubmission(input.orderId, existingOrder.wallet, {
      transactionHash: input.transactionHash,
      providerOrderId: input.providerOrderId,
    });

    return { success: true, order: updated };
  }

  async submitOrder(input: {
    orderId: string;
    sessionAction?: VerifiedCreditAction | null;
    transactionHash?: Hex;
    providerOrderId?: string;
    now?: Date;
  }) {
    return this.recordOrderSubmission(input);
  }

  async getOrderStatus(input: {
    orderId: string;
    sessionAction?: VerifiedCreditAction | null;
    wallet?: Address;
    now?: Date;
  }): Promise<{ success: true; order: TradeOrderRecord; receipt?: TradeReceiptRecord } | { success: false; reason: string }> {
    const targetWallet = input.wallet || (input.sessionAction?.wallet ? getAddress(input.sessionAction.wallet) : undefined);
    const order = this.repo.getOrder(input.orderId, targetWallet);
    if (!order) {
      return { success: false, reason: "order-not-found" };
    }
    const receipt = this.repo.getReceipt(input.orderId, targetWallet);
    return {
      success: true,
      order,
      receipt: receipt || undefined,
    };
  }

  async reconcileOrder(input: {
    orderId: string;
    now?: Date;
    receiptOverride?: { txHash: Hex; filledOutputAmount: string };
  }): Promise<{ success: true; order: TradeOrderRecord; receipt?: TradeReceiptRecord } | { success: false; reason: string }> {
    const order = this.repo.getOrder(input.orderId);
    if (!order) {
      return { success: false, reason: "order-not-found" };
    }

    const quote = this.repo.getQuote(order.quoteId);
    if (!quote) {
      return { success: false, reason: "quote-not-found" };
    }

    if (order.status === "FILLED") {
      const receipt = this.repo.getReceipt(order.id);
      return { success: true, order, receipt: receipt || undefined };
    }

    if (quote.kind === "uniswapx") {
      const check = await this.gateway.checkUniswapXOrderStatus(quote.orderId, this.config);
      if (check.status === "filled" && check.txHash) {
        const outputAmount = check.filledOutputAmount || quote.outputMinimum;
        const receipt = this.repo.recordTerminalReceipt({
          orderId: order.id,
          quoteId: quote.quoteId,
          transactionHash: check.txHash,
          filledInputAmount: quote.inputMaximum,
          filledOutputAmount: outputAmount,
          feeRecipient: quote.fee.recipient,
          feeAmount: quote.fee.amount,
          feeToken: quote.fee.token,
          status: "FILLED",
        });
        const updatedOrder = this.repo.getOrder(order.id)!;
        return { success: true, order: updatedOrder, receipt };
      }
    } else if (quote.kind === "classic") {
      if (input.receiptOverride) {
        const receipt = this.repo.recordTerminalReceipt({
          orderId: order.id,
          quoteId: quote.quoteId,
          transactionHash: input.receiptOverride.txHash,
          filledInputAmount: quote.inputAmount,
          filledOutputAmount: input.receiptOverride.filledOutputAmount,
          feeRecipient: quote.fee.recipient,
          feeAmount: quote.fee.amount,
          feeToken: quote.fee.token,
          status: "FILLED",
        });
        const updatedOrder = this.repo.getOrder(order.id)!;
        return { success: true, order: updatedOrder, receipt };
      }
    }

    return { success: true, order };
  }
}
