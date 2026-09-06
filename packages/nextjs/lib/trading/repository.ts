import Database from "better-sqlite3";
import { getAddress, type Address, type Hex } from "viem";
import type {
  ClassicQuote,
  OrderStatus,
  TradeFeeEventRecord,
  TradeOrderRecord,
  TradeReceiptRecord,
  UniswapXQuote,
  ValidatedTradeQuote,
  ValidatedTransaction,
} from "./types";
import { runTradeMigrations } from "./migrations";

export class TradeRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    runTradeMigrations(this.db);
  }

  saveQuote(quote: ValidatedTradeQuote): void {
    const stmt = this.db.prepare(`
      INSERT INTO trade_quotes (
        id, wallet, recommendation_id, registry_revision, chain_id, kind,
        input_token, input_amount, output_token, minimum_output, recipient,
        fee_bps, fee_token, fee_amount, fee_recipient, transaction_data,
        provider_order_id, expires_at, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    const createdAt = new Date().toISOString();

    if (quote.kind === "classic") {
      stmt.run(
        quote.quoteId,
        quote.wallet,
        quote.recommendationId,
        quote.registryRevision,
        quote.chainId,
        quote.kind,
        quote.inputToken,
        quote.inputAmount,
        quote.outputToken,
        quote.minimumOutput,
        quote.wallet,
        quote.fee.bps,
        quote.fee.token,
        quote.fee.amount,
        quote.fee.recipient,
        JSON.stringify(quote.transaction),
        null,
        quote.expiresAt.toISOString(),
        createdAt
      );
    } else {
      stmt.run(
        quote.quoteId,
        quote.wallet,
        quote.recommendationId,
        quote.registryRevision,
        quote.chainId,
        quote.kind,
        quote.inputToken,
        quote.inputMaximum,
        quote.outputToken,
        quote.outputMinimum,
        quote.recipient,
        quote.fee.bps,
        quote.fee.token,
        quote.fee.amount,
        quote.fee.recipient,
        null,
        quote.orderId,
        quote.expiresAt.toISOString(),
        createdAt
      );
    }
  }

  getQuote(quoteId: string): ValidatedTradeQuote | null {
    const row = this.db
      .prepare(`SELECT * FROM trade_quotes WHERE id = ?`)
      .get(quoteId) as Record<string, any> | undefined;

    if (!row) return null;

    const fee = {
      bps: 10 as const,
      token: getAddress(row.fee_token),
      amount: row.fee_amount,
      recipient: getAddress(row.fee_recipient),
    };

    if (row.kind === "classic") {
      const transaction: ValidatedTransaction = JSON.parse(
        row.transaction_data
      );
      return {
        kind: "classic",
        quoteId: row.id,
        wallet: getAddress(row.wallet),
        chainId: row.chain_id,
        recommendationId: row.recommendation_id,
        registryRevision: row.registry_revision,
        inputToken: getAddress(row.input_token),
        inputAmount: row.input_amount,
        outputToken: getAddress(row.output_token),
        minimumOutput: row.minimum_output,
        transaction,
        fee,
        expiresAt: new Date(row.expires_at),
      };
    } else {
      return {
        kind: "uniswapx",
        quoteId: row.id,
        orderId: row.provider_order_id,
        wallet: getAddress(row.wallet),
        chainId: row.chain_id,
        recommendationId: row.recommendation_id,
        registryRevision: row.registry_revision,
        deadline: new Date(row.expires_at),
        inputToken: getAddress(row.input_token),
        inputMaximum: row.input_amount,
        outputToken: getAddress(row.output_token),
        outputMinimum: row.minimum_output,
        recipient: getAddress(row.recipient),
        fee,
        expiresAt: new Date(row.expires_at),
      };
    }
  }

  createOrderFromQuote(quoteId: string): TradeOrderRecord {
    const quote = this.getQuote(quoteId);
    if (!quote) {
      throw new Error(`Quote not found: ${quoteId}`);
    }

    // Check if order already exists for this quote
    const existing = this.db
      .prepare(`SELECT * FROM trade_orders WHERE quote_id = ?`)
      .get(quoteId) as Record<string, any> | undefined;

    if (existing) {
      return this.mapOrderRow(existing);
    }

    const orderId = `ord_${quoteId.replace(/^q_/, "")}`;
    const now = new Date().toISOString();
    const initialStatus: OrderStatus = "quoted";

    this.db
      .prepare(
        `
      INSERT INTO trade_orders (
        id, quote_id, wallet, chain_id, kind, recommendation_id,
        registry_revision, provider_order_id, transaction_hash, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        orderId,
        quote.quoteId,
        quote.wallet,
        quote.chainId,
        quote.kind,
        quote.recommendationId,
        quote.registryRevision,
        quote.kind === "uniswapx" ? quote.orderId : null,
        null,
        initialStatus,
        now,
        now
      );

    return {
      id: orderId,
      quoteId: quote.quoteId,
      wallet: quote.wallet,
      chainId: quote.chainId,
      kind: quote.kind,
      recommendationId: quote.recommendationId,
      registryRevision: quote.registryRevision,
      providerOrderId: quote.kind === "uniswapx" ? quote.orderId : null,
      transactionHash: null,
      status: initialStatus,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  acknowledgeSubmission(
    orderId: string,
    wallet: Address,
    data: { transactionHash?: Hex; providerOrderId?: string }
  ): TradeOrderRecord {
    const order = this.getOrder(orderId, wallet);
    if (!order) {
      throw new Error(`Order not found or wallet mismatch: ${orderId}`);
    }

    const now = new Date().toISOString();
    const nextStatus: OrderStatus =
      order.kind === "classic" ? "submitted" : "accepted";

    this.db
      .prepare(
        `
      UPDATE trade_orders
      SET transaction_hash = COALESCE(?, transaction_hash),
          provider_order_id = COALESCE(?, provider_order_id),
          status = ?,
          updated_at = ?
      WHERE id = ? AND wallet = ?
    `
      )
      .run(
        data.transactionHash || null,
        data.providerOrderId || null,
        nextStatus,
        now,
        orderId,
        getAddress(wallet)
      );

    const updated = this.getOrder(orderId, wallet);
    if (!updated) {
      throw new Error(`Failed to update order ${orderId}`);
    }
    return updated;
  }

  updateOrderStatus(orderId: string, status: OrderStatus): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE trade_orders SET status = ?, updated_at = ? WHERE id = ?`
      )
      .run(status, now, orderId);
  }

  recordTerminalReceiptAndFee(
    receipt: TradeReceiptRecord,
    feeEvent?: TradeFeeEventRecord
  ): void {
    const transaction = this.db.transaction(() => {
      // 1. Insert receipt
      this.db
        .prepare(
          `
        INSERT INTO trade_receipts (
          order_id, wallet, chain_id, kind, status,
          input_token, input_amount, output_token, output_amount,
          fee_bps, fee_token, fee_amount, fee_recipient,
          reference, settled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET
          status = excluded.status,
          output_amount = excluded.output_amount,
          settled_at = excluded.settled_at
      `
        )
        .run(
          receipt.orderId,
          receipt.wallet,
          receipt.chainId,
          receipt.kind,
          receipt.status,
          receipt.inputToken,
          receipt.inputAmount,
          receipt.outputToken,
          receipt.outputAmount,
          receipt.feeBps,
          receipt.feeToken,
          receipt.feeAmount,
          receipt.feeRecipient,
          receipt.reference,
          receipt.settledAt.toISOString()
        );

      // 2. Insert fee event if provided
      if (feeEvent) {
        this.db
          .prepare(
            `
          INSERT INTO trade_fee_events (
            order_id, wallet, chain_id, fee_bps, token, amount, recipient, reference, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(order_id) DO NOTHING
        `
          )
          .run(
            feeEvent.orderId,
            feeEvent.wallet,
            feeEvent.chainId,
            feeEvent.feeBps,
            feeEvent.token,
            feeEvent.amount,
            feeEvent.recipient,
            feeEvent.reference,
            feeEvent.createdAt.toISOString()
          );
      }

      // 3. Update order status
      const orderStatus: OrderStatus = receipt.status;
      this.db
        .prepare(
          `UPDATE trade_orders SET status = ?, updated_at = ? WHERE id = ?`
        )
        .run(orderStatus, new Date().toISOString(), receipt.orderId);
    });

    transaction();
  }

  getOrder(orderId: string, wallet?: Address): TradeOrderRecord | null {
    const row = wallet
      ? (this.db
          .prepare(`SELECT * FROM trade_orders WHERE id = ? AND wallet = ?`)
          .get(orderId, getAddress(wallet)) as Record<string, any> | undefined)
      : (this.db
          .prepare(`SELECT * FROM trade_orders WHERE id = ?`)
          .get(orderId) as Record<string, any> | undefined);

    if (!row) return null;
    return this.mapOrderRow(row);
  }

  getReceipt(orderId: string, wallet?: Address): TradeReceiptRecord | null {
    const row = wallet
      ? (this.db
          .prepare(`SELECT * FROM trade_receipts WHERE order_id = ? AND wallet = ?`)
          .get(orderId, getAddress(wallet)) as Record<string, any> | undefined)
      : (this.db
          .prepare(`SELECT * FROM trade_receipts WHERE order_id = ?`)
          .get(orderId) as Record<string, any> | undefined);

    if (!row) return null;
    return {
      orderId: row.order_id,
      wallet: getAddress(row.wallet),
      chainId: row.chain_id,
      kind: row.kind,
      status: row.status,
      inputToken: getAddress(row.input_token),
      inputAmount: row.input_amount,
      outputToken: getAddress(row.output_token),
      outputAmount: row.output_amount,
      feeBps: 10,
      feeToken: getAddress(row.fee_token),
      feeAmount: row.fee_amount,
      feeRecipient: getAddress(row.fee_recipient),
      reference: row.reference,
      settledAt: new Date(row.settled_at),
    };
  }

  getFeeEvent(orderId: string): TradeFeeEventRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM trade_fee_events WHERE order_id = ?`)
      .get(orderId) as Record<string, any> | undefined;

    if (!row) return null;
    return {
      orderId: row.order_id,
      wallet: getAddress(row.wallet),
      chainId: row.chain_id,
      feeBps: 10,
      token: getAddress(row.token),
      amount: row.amount,
      recipient: getAddress(row.recipient),
      reference: row.reference,
      createdAt: new Date(row.created_at),
    };
  }

  getPendingOrders(): readonly TradeOrderRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM trade_orders WHERE status IN ('submitted', 'accepted', 'pending', 'open')`
      )
      .all() as Record<string, any>[];

    return rows.map(r => this.mapOrderRow(r));
  }

  private mapOrderRow(row: Record<string, any>): TradeOrderRecord {
    return {
      id: row.id,
      quoteId: row.quote_id,
      wallet: getAddress(row.wallet),
      chainId: row.chain_id,
      kind: row.kind,
      recommendationId: row.recommendation_id,
      registryRevision: row.registry_revision,
      providerOrderId: row.provider_order_id,
      transactionHash: row.transaction_hash,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
