import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toHex, type Address, type Hex } from "viem";

import { parseCreditBillingConfig, type CreditRuntimeEnvironment } from "./config";
import { createCreditPrismaClient, migrateCreditDatabase } from "./db";
import {
  CreditLedgerService,
  type AuthorizationInput,
  type CreditAuthorizationSnapshotProvider,
  type PriceSnapshot,
} from "./ledger";
import type { CreditVaultGateway } from "./vault";

export const wallet: Address = "0x2222222222222222222222222222222222222222";
const vaultAddress: Address = "0x1111111111111111111111111111111111111111";
const baseEnvironment: CreditRuntimeEnvironment = {
  CREDIT_APP_ORIGIN: "https://app.leg.investments",
  CREDIT_BASE_RPC_URL: "https://base.example.test",
  CREDIT_BILLING_SIGNER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  CREDIT_CONFIRMATIONS: "6",
  CREDIT_DEPLOYMENT_BLOCK: "100",
  CREDIT_VAULT_ADDRESS: vaultAddress,
  CREDIT_USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  FMP_PRODUCTION_LICENSE_CONFIRMED: "true",
};

export class FakeVault implements CreditVaultGateway {
  available = 100_000_000n;
  reserved = 0n;
  blockNumber = 500n;
  operations: string[] = [];
  confirmationFailures = 0;
  reserveSubmissionFailures = 0;
  reserveReceiptReverts = 0;
  settleSubmissionFailures = 0;
  settleReceiptReverts = 0;
  reservationSignatureValid = true;
  reservationVerificationCalls = 0;
  /** Standing session-grant budget. Zero means no live grant. */
  sessionAllowance = 0n;
  sessionAllowanceCalls = 0;
  reserveSignatures: Hex[] = [];
  settledChargeOverride: bigint | undefined;
  hiddenReservationReads = 0;
  private transaction = 0;
  private revertedHashes = new Set<Hex>();
  private reservationStatus = new Map<Hex, number>();
  private reservationMaximum = new Map<Hex, bigint>();
  private reservationCustomer = new Map<Hex, Address>();
  private reservationExpiry = new Map<Hex, number>();
  private reservationFinalCharge = new Map<Hex, bigint>();
  private reservationTermsHash = new Map<Hex, Hex>();

  async getAccountSnapshot(
    _customer: Address,
    blockNumber = this.blockNumber,
  ): Promise<{ available: bigint; reserved: bigint; blockNumber: bigint }> {
    return { available: this.available, reserved: this.reserved, blockNumber };
  }

  async availableCreditOf(_customer: Address): Promise<bigint> {
    return this.available;
  }

  async remainingSessionAllowance(): Promise<bigint> {
    this.sessionAllowanceCalls += 1;
    return this.sessionAllowance;
  }

  async reservedCreditOf(_customer: Address): Promise<bigint> {
    return this.reserved;
  }

  async verifyReservationAuthorization(): Promise<boolean> {
    this.reservationVerificationCalls += 1;
    return this.reservationSignatureValid;
  }

  async submitReserve(input: {
    reservationId: Hex;
    customer: Address;
    maximumCharge: bigint;
    expiresAt: number;
    termsHash: Hex;
    customerSignature: Hex;
  }): Promise<Hex> {
    this.operations.push(`reserve:${input.reservationId}`);
    this.reserveSignatures.push(input.customerSignature);
    if (this.reservationStatus.get(input.reservationId) === 1) {
      const revertedHash = this.nextHash();
      this.revertedHashes.add(revertedHash);
      return revertedHash;
    }
    if (this.reserveReceiptReverts > 0) {
      this.reserveReceiptReverts -= 1;
      const revertedHash = this.nextHash();
      this.revertedHashes.add(revertedHash);
      return revertedHash;
    }
    if (input.maximumCharge > this.available) {
      throw new Error("vault insufficient available credit");
    }
    this.available -= input.maximumCharge;
    this.reserved += input.maximumCharge;
    this.reservationMaximum.set(input.reservationId, input.maximumCharge);
    this.reservationCustomer.set(input.reservationId, input.customer);
    this.reservationExpiry.set(input.reservationId, input.expiresAt);
    this.reservationFinalCharge.set(input.reservationId, 0n);
    this.reservationTermsHash.set(input.reservationId, input.termsHash);
    this.reservationStatus.set(input.reservationId, 1);
    if (this.reserveSubmissionFailures > 0) {
      this.reserveSubmissionFailures -= 1;
      throw new Error("simulated process interruption after reserve broadcast");
    }
    return this.nextHash();
  }

  async submitSettle(reservationId: Hex, finalCharge: bigint): Promise<Hex> {
    this.operations.push(`settle:${reservationId}:${finalCharge}`);
    if (this.reservationStatus.get(reservationId) !== 1) {
      throw new Error("reservation is not active");
    }
    if (this.settleReceiptReverts > 0) {
      this.settleReceiptReverts -= 1;
      const revertedHash = this.nextHash();
      this.revertedHashes.add(revertedHash);
      return revertedHash;
    }
    const maximum = this.reservationMaximum.get(reservationId) ?? 0n;
    this.reserved -= maximum;
    this.available += maximum - finalCharge;
    this.reservationStatus.set(reservationId, 2);
    this.reservationFinalCharge.set(
      reservationId,
      this.settledChargeOverride ?? finalCharge,
    );
    if (this.settleSubmissionFailures > 0) {
      this.settleSubmissionFailures -= 1;
      throw new Error("simulated process interruption after settle broadcast");
    }
    return this.nextHash();
  }

  async submitRelease(reservationId: Hex): Promise<Hex> {
    this.operations.push(`release:${reservationId}`);
    if (this.reservationStatus.get(reservationId) !== 1) {
      throw new Error("reservation is not active");
    }
    const maximum = this.reservationMaximum.get(reservationId) ?? 0n;
    this.reserved -= maximum;
    this.available += maximum;
    this.reservationStatus.set(reservationId, 3);
    this.reservationFinalCharge.set(reservationId, 0n);
    return this.nextHash();
  }

  async transactionOutcome(
    hash: Hex,
  ): Promise<"confirmed" | "reverted" | "unknown"> {
    this.operations.push(`confirm:${hash}`);
    if (this.revertedHashes.has(hash)) {
      return "reverted";
    }
    if (this.confirmationFailures > 0) {
      this.confirmationFailures -= 1;
      return "unknown";
    }
    return "confirmed";
  }

  async getReservation(
    reservationId: Hex,
  ): Promise<{
    customer: Address;
    maximumCharge: bigint;
    expiresAt: number;
    status: number;
    finalCharge: bigint;
    termsHash: Hex;
  }> {
    if (this.hiddenReservationReads > 0) {
      this.hiddenReservationReads -= 1;
      return {
        customer: "0x0000000000000000000000000000000000000000",
        maximumCharge: 0n,
        expiresAt: 0,
        status: 0,
        finalCharge: 0n,
        termsHash: toHex(0, { size: 32 }),
      };
    }
    return {
      customer:
        this.reservationCustomer.get(reservationId) ??
        "0x0000000000000000000000000000000000000000",
      maximumCharge: this.reservationMaximum.get(reservationId) ?? 0n,
      expiresAt: this.reservationExpiry.get(reservationId) ?? 0,
      status: this.reservationStatus.get(reservationId) ?? 0,
      finalCharge: this.reservationFinalCharge.get(reservationId) ?? 0n,
      termsHash:
        this.reservationTermsHash.get(reservationId) ?? toHex(0, { size: 32 }),
    };
  }

  setReservationExpiry(reservationId: Hex, expiresAt: number): void {
    this.reservationExpiry.set(reservationId, expiresAt);
  }

  private nextHash(): Hex {
    this.transaction += 1;
    return toHex(this.transaction, { size: 32 });
  }
}

class FakeAuthorizationSnapshotProvider
  implements CreditAuthorizationSnapshotProvider
{
  pendingDeposits = 0n;
  calls = 0;
  failures = 0;

  constructor(private readonly vault: CreditVaultGateway) {}

  async prepareAuthorizationSnapshot(
    customer: Address,
  ): Promise<{
    available: bigint;
    reserved: bigint;
    pendingDeposits: bigint;
    blockNumber: bigint;
  }> {
    this.calls += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("simulated snapshot interruption");
    }
    const snapshot = await this.vault.getAccountSnapshot(customer);
    return { ...snapshot, pendingDeposits: this.pendingDeposits };
  }
}

export async function setupTest(
  options: { fmpLicensed?: boolean; pendingDeposits?: bigint } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "leg-ledger-test-"));
  const config = parseCreditBillingConfig({
    ...baseEnvironment,
    CREDIT_DATABASE_PATH: join(directory, "credits.sqlite"),
    FMP_PRODUCTION_LICENSE_CONFIRMED:
      options.fmpLicensed === false ? "false" : "true",
  });
  await migrateCreditDatabase(config);
  const prisma = createCreditPrismaClient(config);
  const vault = new FakeVault();
  const snapshotProvider = new FakeAuthorizationSnapshotProvider(vault);
  snapshotProvider.pendingDeposits = options.pendingDeposits ?? 0n;
  const ledger = new CreditLedgerService({
    config,
    prisma,
    vaultClient: vault,
    authorizationSnapshotProvider: snapshotProvider,
  });
  return { config, directory, ledger, prisma, snapshotProvider, vault };
}

export function advisorPricing(
  maximumCharge = 20_000_000n,
  fmp = 5_000_000n,
): PriceSnapshot {
  return {
    version: "advisor-2026-07",
    components: {
      "0g": maximumCharge - fmp - 2_000_000n,
      fmp,
      legService: 2_000_000n,
    },
    maximumCharge,
  };
}

export async function authorizationInput(
  _prisma: Awaited<ReturnType<typeof setupTest>>["prisma"],
  correlationId: string,
  pricing = advisorPricing(),
  options: {
    serviceType?: "advisor" | "trading-platform";
  } = {},
): Promise<AuthorizationInput> {
  const serviceType = options.serviceType ?? "advisor";
  const reservationExpiresAt = new Date(Date.now() + 60 * 60_000);
  return {
    wallet,
    correlationId,
    serviceType,
    pricing,
    expiresAt: reservationExpiresAt,
  };
}

export async function authorizeInput(
  ledger: CreditLedgerService,
  input: AuthorizationInput,
  customerSignature: Hex = toHex(1, { size: 65 }),
) {
  const prepared = await ledger.prepareAuthorization(input);
  return ledger.authorize({
    authorizationId: prepared.authorizationId,
    customerSignature,
  });
}
