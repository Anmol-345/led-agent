import { isHex, parseUnits, type Address, type Hex } from "viem";
import { z } from "zod";

const USDC_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const persistedTransactionSchema = z.object({
  kind: z.enum(["approval", "deposit", "withdrawal"]),
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  operationId: z.string().min(1).max(128).optional(),
});

export type CreditReceiptOutcome = "confirmed" | "reverted" | "unknown";
export type CreditTransactionKind = "approval" | "deposit" | "withdrawal";
export type CreditTransactionState = {
  kind: CreditTransactionKind;
  operationId: string;
  hash?: Hex;
  outcome?: "waiting" | "unknown";
};

export function creditTransactionStorageKey(
  chainId: number,
  vault: Address,
  wallet: Address,
): string {
  return `leg-credit-transaction:${chainId}:${vault.toLowerCase()}:${wallet.toLowerCase()}`;
}

export function parsePersistedCreditTransaction(
  stored: string | null,
): CreditTransactionState | null {
  if (stored === null) return null;
  try {
    const parsed = persistedTransactionSchema.safeParse(JSON.parse(stored));
    if (!parsed.success || !isHex(parsed.data.hash)) return null;
    return {
      kind: parsed.data.kind,
      hash: parsed.data.hash,
      operationId: parsed.data.operationId ?? parsed.data.hash,
      outcome: "unknown",
    };
  } catch {
    return null;
  }
}

export function creditTransactionScopeMatches(
  activeStorageKey: string | null,
  activeOperationId: string | null,
  updateStorageKey: string | null,
  expectedOperationId: string,
): boolean {
  return (
    activeStorageKey === updateStorageKey &&
    activeOperationId === expectedOperationId
  );
}

export function createSerialTaskQueue() {
  let tail = Promise.resolve();
  return function enqueue<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = tail.then(work, work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export async function checkCreditTransactionReceipt(
  loadStatus: () => Promise<"success" | "reverted">,
): Promise<CreditReceiptOutcome> {
  try {
    return (await loadStatus()) === "success" ? "confirmed" : "reverted";
  } catch {
    return "unknown";
  }
}

export function parseUsdcAmount(value: string): bigint {
  const normalized = value.trim();
  if (!USDC_AMOUNT_PATTERN.test(normalized)) {
    throw new Error("Enter a positive USDC amount with at most 6 decimal places.");
  }

  const amount = parseUnits(normalized, 6);
  if (amount <= 0n) {
    throw new Error("Enter a USDC amount greater than zero.");
  }
  return amount;
}
