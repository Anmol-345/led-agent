import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import type { TradingConfig } from "./config";
import type { TradeRepository } from "./repository";
import type { UniswapGateway } from "./uniswap";
import type { TradeFeeEventRecord, TradeReceiptRecord } from "./types";

export type ReconciliationSummary = {
  processedCount: number;
  reconciledCount: number;
};

export async function reconcilePendingOrders(
  repo: TradeRepository,
  gateway: UniswapGateway,
  config: TradingConfig
): Promise<ReconciliationSummary> {
  const pendingOrders = repo.getPendingOrders();
  let reconciledCount = 0;

  for (const order of pendingOrders) {
    try {
      const quote = repo.getQuote(order.quoteId);
      if (!quote) continue;

      if (order.kind === "classic" && order.transactionHash) {
        const rpcUrl = config.rpcUrls[order.chainId];
        if (!rpcUrl) continue;

        const publicClient = createPublicClient({
          transport: http(rpcUrl),
        });

        const receipt = await publicClient
          .getTransactionReceipt({ hash: order.transactionHash })
          .catch(() => null);

        if (!receipt) {
          // Still pending on-chain
          continue;
        }

        const isSuccess = receipt.status === "success";
        const terminalStatus = isSuccess ? "settled" : "reverted";

        const tradeReceipt: TradeReceiptRecord = {
          orderId: order.id,
          wallet: order.wallet,
          chainId: order.chainId,
          kind: "classic",
          status: terminalStatus,
          inputToken: quote.inputToken,
          inputAmount: quote.inputAmount,
          outputToken: quote.outputToken,
          outputAmount: quote.minimumOutput,
          feeBps: 10,
          feeToken: quote.fee.token,
          feeAmount: quote.fee.amount,
          feeRecipient: quote.fee.recipient,
          reference: order.transactionHash,
          settledAt: new Date(),
        };

        const feeEvent: TradeFeeEventRecord | undefined = isSuccess
          ? {
              orderId: order.id,
              wallet: order.wallet,
              chainId: order.chainId,
              feeBps: 10,
              token: quote.fee.token,
              amount: quote.fee.amount,
              recipient: quote.fee.recipient,
              reference: order.transactionHash,
              createdAt: new Date(),
            }
          : undefined;

        repo.recordTerminalReceiptAndFee(tradeReceipt, feeEvent);
        reconciledCount++;
      } else if (order.kind === "uniswapx" && order.providerOrderId) {
        const statusResult = await gateway.checkUniswapXOrderStatus(
          order.providerOrderId,
          config
        );

        if (statusResult.status === "open") {
          continue;
        }

        const reference = statusResult.txHash || (order.providerOrderId as Hex);

        const inputAmount = quote.kind === "classic" ? quote.inputAmount : quote.inputMaximum;
        const outputAmount = quote.kind === "classic" ? quote.minimumOutput : quote.outputMinimum;

        const tradeReceipt: TradeReceiptRecord = {
          orderId: order.id,
          wallet: order.wallet,
          chainId: order.chainId,
          kind: "uniswapx",
          status: statusResult.status,
          inputToken: quote.inputToken,
          inputAmount,
          outputToken: quote.outputToken,
          outputAmount: statusResult.filledOutputAmount || outputAmount,
          feeBps: 10,
          feeToken: quote.fee.token,
          feeAmount: quote.fee.amount,
          feeRecipient: quote.fee.recipient,
          reference,
          settledAt: new Date(),
        };

        const feeEvent: TradeFeeEventRecord | undefined =
          statusResult.status === "filled"
            ? {
                orderId: order.id,
                wallet: order.wallet,
                chainId: order.chainId,
                feeBps: 10,
                token: quote.fee.token,
                amount: quote.fee.amount,
                recipient: quote.fee.recipient,
                reference,
                createdAt: new Date(),
              }
            : undefined;

        repo.recordTerminalReceiptAndFee(tradeReceipt, feeEvent);
        reconciledCount++;
      }
    } catch {
      // Outage or parsing error preserves pending state
      continue;
    }
  }

  return {
    processedCount: pendingOrders.length,
    reconciledCount,
  };
}
