import crypto from "node:crypto";

import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  size,
  toHex,
  toBytes,
  type Address,
  type Hex,
} from "viem";

import type {
  CreditAccountConfig,
  CreditBillingConfig,
} from "./config";
import {
  validateMicroUsdc,
  type CreditPrismaClient,
} from "./db";
import {
  CreditAuthorizationStatus,
  CreditEventFinality,
  CreditServiceType,
  CreditUsageStatus,
  type CreditAuthorization,
  type CreditUsageRecord,
} from "./generated/prisma/client";
import {
  BaseVaultClient,
  createReservationTypedData,
  type CreditVaultGateway,
} from "./vault";

export type MicroUsdc = bigint;
export type CreditComponent = "0g" | "fmp" | "legService";
export type ServiceType = "advisor" | "trading-platform";

export type PriceSnapshot = {
  version: string;
  components: Readonly<Record<CreditComponent, MicroUsdc>>;
  maximumCharge: MicroUsdc;
};

export type AuthorizationInput = {
  wallet: Address;
  correlationId: string;
  serviceType: ServiceType;
  pricing: PriceSnapshot;
  expiresAt: Date;
};

export type ReservationAuthorizationInput = {
  authorizationId: string;
  /**
   * Per-reservation signature. Omit to authorize from the customer's standing session
   * grant instead, which is what lets repeat inference run without a wallet prompt.
   */
  customerSignature?: Hex;
};

export type PreparedAuthorization = {
  authorizationId: string;
  reservationId: Hex;
  expiresAt: Date;
  chargePurpose: string;
  typedData: ReturnType<typeof createReservationTypedData>;
};

export type CompletionInput = {
  authorizationId: string;
  outcome: "succeeded" | "failed";
  components: Readonly<Record<CreditComponent, MicroUsdc>> | null;
  providerReference: string | null;
};

export type CreditAuthorizationSnapshotProvider = {
  prepareAuthorizationSnapshot(wallet: Address): Promise<{
    available: bigint;
    reserved: bigint;
    pendingDeposits: bigint;
    blockNumber: bigint;
  }>;
};

type FinalizationStatus =
  | "settled"
  | "released"
  | "provisional"
  | "failed"
  | "expired";

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_PRICE_VERSION_LENGTH = 64;
const MAX_CHARGE_PURPOSE_LENGTH = 1_024;
const MAX_UINT48 = (1n << 48n) - 1n;

function isBillingConfig(
  config: CreditAccountConfig | CreditBillingConfig,
): config is CreditBillingConfig {
  return (
    "billingSignerPrivateKey" in config &&
    "fmpProductionLicenseConfirmed" in config
  );
}

function canonicalText(value: string, maximumLength: number, label: string): string {
  if (
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function checkedComponents(
  components: Readonly<Record<CreditComponent, MicroUsdc>>,
): Readonly<Record<CreditComponent, MicroUsdc>> & { total: bigint } {
  const zeroG = validateMicroUsdc(components["0g"]);
  const fmp = validateMicroUsdc(components.fmp);
  const legService = validateMicroUsdc(components.legService);
  const total = validateMicroUsdc(zeroG + fmp + legService);
  return { "0g": zeroG, fmp, legService, total };
}

function checkedPricing(pricing: PriceSnapshot): PriceSnapshot {
  const version = canonicalText(
    pricing.version,
    MAX_PRICE_VERSION_LENGTH,
    "Price version",
  );
  const components = checkedComponents(pricing.components);
  const maximumCharge = validateMicroUsdc(pricing.maximumCharge);
  if (maximumCharge === 0n || components.total !== maximumCharge) {
    throw new Error("Price components must equal a positive maximum charge.");
  }
  return {
    version,
    components: {
      "0g": components["0g"],
      fmp: components.fmp,
      legService: components.legService,
    },
    maximumCharge,
  };
}

export function createCreditChargePurpose(input: {
  correlationId: string;
  expiresAt: Date;
  serviceType: ServiceType;
  pricing: PriceSnapshot;
}): string {
  const correlationId = canonicalText(
    input.correlationId,
    MAX_IDENTIFIER_LENGTH,
    "Correlation identifier",
  );
  if (input.serviceType !== "advisor" && input.serviceType !== "trading-platform") {
    throw new Error("Credit service type is invalid.");
  }
  const pricing = checkedPricing(input.pricing);
  const expiresAtMilliseconds = input.expiresAt.getTime();
  if (!Number.isFinite(expiresAtMilliseconds)) {
    throw new Error("Authorization expiry is invalid.");
  }
  const expiresAtSeconds = Math.floor(expiresAtMilliseconds / 1_000);
  const expiresAtIso = new Date(expiresAtSeconds * 1_000).toISOString();
  const purpose =
    input.serviceType === "trading-platform"
      ? "leg-platform-service"
      : "provider-backed-advice";
  const result = [
    "leg-credit-v1",
    `correlation=${encodeURIComponent(correlationId)}`,
    `service=${input.serviceType}`,
    `purpose=${purpose}`,
    `price-version=${encodeURIComponent(pricing.version)}`,
    `reservation-expires=${expiresAtSeconds}`,
    `reservation-expires-at=${expiresAtIso}`,
    `0g=${displayMicroUsdc(pricing.components["0g"])}`,
    `fmp=${displayMicroUsdc(pricing.components.fmp)}`,
    `leg-service=${displayMicroUsdc(pricing.components.legService)}`,
    `maximum=${displayMicroUsdc(pricing.maximumCharge)}`,
  ].join(";");
  return canonicalText(result, MAX_CHARGE_PURPOSE_LENGTH, "Charge purpose");
}

export function creditReservationId(authorizationId: string): Hex {
  const id = canonicalText(
    authorizationId,
    MAX_IDENTIFIER_LENGTH,
    "Authorization identifier",
  );
  return toHex(crypto.createHash("sha256").update(id).digest());
}

export function createCreditReservationTypedData(input: {
  authorizationId: string;
  chainId: number;
  wallet: Address;
  correlationId: string;
  serviceType: ServiceType;
  pricing: PriceSnapshot;
  expiresAt: Date;
  vaultAddress: Address;
}) {
  const expiresAtMilliseconds = input.expiresAt.getTime();
  if (!Number.isFinite(expiresAtMilliseconds)) {
    throw new Error("Authorization expiry is invalid.");
  }
  const chargePurpose = createCreditChargePurpose(input);
  const pricing = checkedPricing(input.pricing);
  return createReservationTypedData({
    chainId: input.chainId,
    vaultAddress: input.vaultAddress,
    reservationId: creditReservationId(input.authorizationId),
    customer: input.wallet,
    maximumCharge: pricing.maximumCharge,
    expiresAt: Math.floor(expiresAtMilliseconds / 1_000),
    termsHash: keccak256(toBytes(chargePurpose)),
  });
}

function reservationId(value: string): Hex {
  if (!isHex(value) || size(value) !== 32) {
    throw new Error("Stored vault reservation identifier is invalid.");
  }
  return value;
}

function reservationSignature(value: string | null): Hex {
  // "0x" is the session-grant marker: the vault reads it as "no per-charge signature, draw
  // on the standing grant". Every other empty or malformed value is still rejected.
  if (value === "0x") return "0x";
  if (
    value === null ||
    !isHex(value) ||
    size(value) === 0 ||
    value.length > 4_098
  ) {
    throw new Error("Stored reservation signature is invalid.");
  }
  return value;
}

function authorizationResult(authorization: CreditAuthorization): {
  authorizationId: string;
  reservationId: Hex;
  expiresAt: Date;
} {
  return {
    authorizationId: authorization.id,
    reservationId: reservationId(authorization.reservationId),
    expiresAt: authorization.expiresAt,
  };
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function displayMicroUsdc(value: MicroUsdc): string {
  const whole = value / 1_000_000n;
  const fractional = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fractional} USDC (${value} micro-USDC)`;
}

function finalizationStatus(status: CreditAuthorizationStatus): FinalizationStatus {
  switch (status) {
    case CreditAuthorizationStatus.SETTLED:
      return "settled";
    case CreditAuthorizationStatus.RELEASED:
      return "released";
    case CreditAuthorizationStatus.PROVISIONAL:
      return "provisional";
    case CreditAuthorizationStatus.FAILED:
      return "failed";
    case CreditAuthorizationStatus.EXPIRED:
      return "expired";
    default:
      throw new Error(`Authorization is not finalized (status: ${status}).`);
  }
}

function isFinalStatus(status: CreditAuthorizationStatus): boolean {
  return (
    status === CreditAuthorizationStatus.SETTLED ||
    status === CreditAuthorizationStatus.RELEASED ||
    status === CreditAuthorizationStatus.FAILED ||
    status === CreditAuthorizationStatus.EXPIRED
  );
}

export class CreditLedgerService {
  private readonly config: CreditAccountConfig | CreditBillingConfig;
  private readonly vaultClient: CreditVaultGateway;
  private readonly authorizationSnapshotProvider:
    | CreditAuthorizationSnapshotProvider
    | undefined;

  constructor(options: {
    prisma: CreditPrismaClient;
    config: CreditAccountConfig | CreditBillingConfig;
    vaultClient?: CreditVaultGateway;
    authorizationSnapshotProvider?: CreditAuthorizationSnapshotProvider;
  }) {
    this.prisma = options.prisma;
    this.config = options.config;
    this.authorizationSnapshotProvider = options.authorizationSnapshotProvider;
    this.vaultClient =
      options.vaultClient ??
      new BaseVaultClient({
        vaultAddress: options.config.vaultAddress,
        rpcUrl: options.config.baseRpcUrl,
        confirmations: options.config.confirmations,
        billingSignerPrivateKey: isBillingConfig(options.config)
          ? options.config.billingSignerPrivateKey
          : undefined,
      });
  }

  private readonly prisma: CreditPrismaClient;

  async getAccount(wallet: Address): Promise<{
    available: MicroUsdc;
    providerEligible: MicroUsdc;
    reserved: MicroUsdc;
    pendingDeposits: MicroUsdc;
    blockNumber: bigint;
  }> {
    const normalizedWallet = getAddress(wallet);
    if (this.authorizationSnapshotProvider) {
      const snapshot =
        await this.authorizationSnapshotProvider.prepareAuthorizationSnapshot(
          normalizedWallet,
        );
      return {
        ...snapshot,
        providerEligible:
          snapshot.available > snapshot.pendingDeposits
            ? snapshot.available - snapshot.pendingDeposits
            : 0n,
      };
    }

    const snapshot = await this.vaultClient.getAccountSnapshot(normalizedWallet);
    const pendingEvents = await this.prisma.creditChainEvent.findMany({
      where: {
        chainId: BigInt(this.config.baseChainId),
        wallet: normalizedWallet.toLowerCase(),
        eventName: "Deposited",
        finality: CreditEventFinality.PENDING,
        blockNumber: { lte: snapshot.blockNumber },
      },
    });
    const pendingDeposits = pendingEvents.reduce(
      (total, event) => total + event.amountMicroUsdc,
      0n,
    );
    return {
      ...snapshot,
      pendingDeposits,
      providerEligible:
        snapshot.available > pendingDeposits
          ? snapshot.available - pendingDeposits
          : 0n,
    };
  }

  async prepareAuthorization(
    input: AuthorizationInput,
  ): Promise<PreparedAuthorization> {
    const checked = this.checkedAuthorizationInput(input);
    const existing = await this.prisma.creditAuthorization.findUnique({
      where: { correlationId: checked.correlationId },
    });
    if (existing) {
      this.assertCompatibleAuthorization(existing, checked);
      if (existing.status === CreditAuthorizationStatus.REJECTED) {
        throw new Error(existing.rejectionReason ?? "Authorization was rejected.");
      }
      if (
        existing.status !== CreditAuthorizationStatus.PENDING &&
        existing.status !== CreditAuthorizationStatus.RESERVED
      ) {
        throw new Error(
          `Authorization correlation is not reusable (status: ${existing.status}).`,
        );
      }
      return this.preparedAuthorization(existing);
    }

    let pending: CreditAuthorization;
    try {
      pending = await this.createPendingAuthorization(checked);
    } catch (error) {
      const concurrent = await this.prisma.creditAuthorization.findUnique({
        where: { correlationId: checked.correlationId },
      });
      if (!concurrent) throw error;
      this.assertCompatibleAuthorization(concurrent, checked);
      return this.preparedAuthorization(concurrent);
    }
    return this.preparedAuthorization(pending);
  }

  async authorize(input: ReservationAuthorizationInput): Promise<{
    authorizationId: string;
    reservationId: Hex;
    expiresAt: Date;
  }> {
    const authorizationId = canonicalText(
      input.authorizationId,
      MAX_IDENTIFIER_LENGTH,
      "Authorization identifier",
    );
    // "0x" (or omitted) means "draw on the session grant"; the vault enforces the cap and
    // expiry on-chain, and we re-check here so an uncovered charge fails before submission.
    const viaSessionGrant =
      input.customerSignature === undefined ||
      input.customerSignature === "0x";
    if (
      !viaSessionGrant &&
      (!isHex(input.customerSignature) ||
        size(input.customerSignature) === 0 ||
        input.customerSignature.length > 4_098)
    ) {
      throw new Error("Reservation signature is invalid.");
    }
    const storedSignature: Hex = viaSessionGrant
      ? "0x"
      : (input.customerSignature as Hex);
    let authorization = await this.prisma.creditAuthorization.findUnique({
      where: { id: authorizationId },
    });
    if (!authorization) {
      throw new Error("Authorization not found.");
    }
    if (authorization.status === CreditAuthorizationStatus.RESERVED) {
      return authorizationResult(authorization);
    }
    if (authorization.status === CreditAuthorizationStatus.REJECTED) {
      throw new Error(
        authorization.rejectionReason ?? "Authorization was rejected.",
      );
    }
    if (authorization.status !== CreditAuthorizationStatus.PENDING) {
      throw new Error(
        `Authorization cannot be reserved (status: ${authorization.status}).`,
      );
    }
    if (authorization.expiresAt.getTime() <= Date.now()) {
      return this.rejectAuthorization(
        authorization,
        "Authorization expired before reservation.",
      );
    }
    let signatureStoredNow = false;
    if (authorization.reservationSignature === null) {
      const terms = this.authorizationTerms(authorization);
      if (viaSessionGrant) {
        const remaining = await this.vaultClient.remainingSessionAllowance(terms.wallet);
        if (remaining < terms.pricing.maximumCharge) {
          throw new Error(
            "Session allowance does not cover this charge; deposit again to renew it.",
          );
        }
      } else {
        const valid = await this.vaultClient.verifyReservationAuthorization({
          reservationId: reservationId(authorization.reservationId),
          customer: terms.wallet,
          maximumCharge: terms.pricing.maximumCharge,
          expiresAt: Math.floor(terms.expiresAt.getTime() / 1_000),
          termsHash: terms.termsHash,
          customerSignature: storedSignature,
        });
        if (!valid) {
          throw new Error("Reservation signature is invalid.");
        }
      }
      const stored = await this.prisma.creditAuthorization.updateMany({
        where: {
          id: authorization.id,
          status: CreditAuthorizationStatus.PENDING,
          reservationSignature: null,
        },
        data: { reservationSignature: storedSignature },
      });
      signatureStoredNow = stored.count === 1;
      const persisted = await this.prisma.creditAuthorization.findUnique({
        where: { id: authorization.id },
      });
      if (!persisted) {
        throw new Error("Authorization disappeared while storing its signature.");
      }
      authorization = persisted;
    }
    if (
      signatureStoredNow &&
      authorization.status === CreditAuthorizationStatus.PENDING
    ) {
      return this.reservePendingAuthorization(authorization);
    }
    return this.resumeOrReturnAuthorization(authorization);
  }

  private async reservePendingAuthorization(
    pending: CreditAuthorization,
  ): Promise<{
    authorizationId: string;
    reservationId: Hex;
    expiresAt: Date;
  }> {
    if (!isBillingConfig(this.config)) {
      throw new Error("Credit billing configuration is required for authorization.");
    }
    const checked = this.authorizationTerms(pending);
    if (
      checked.pricing.components.fmp > 0n &&
      !this.config.fmpProductionLicenseConfirmed
    ) {
      return this.rejectAuthorization(
        pending,
        "FMP production licence is not confirmed for this price snapshot.",
      );
    }
    if (!this.authorizationSnapshotProvider) {
      return this.rejectAuthorization(
        pending,
        "Authorization snapshot service is unavailable.",
      );
    }

    let snapshot: Awaited<
      ReturnType<CreditAuthorizationSnapshotProvider["prepareAuthorizationSnapshot"]>
    >;
    try {
      snapshot =
        await this.authorizationSnapshotProvider.prepareAuthorizationSnapshot(
          checked.wallet,
        );
    } catch {
      throw new Error("Authorization snapshot is temporarily unavailable.");
    }
    const providerEligible =
      snapshot.available > snapshot.pendingDeposits
        ? snapshot.available - snapshot.pendingDeposits
        : 0n;
    if (providerEligible < checked.pricing.maximumCharge) {
      return this.rejectAuthorization(
        pending,
        "Insufficient provider-eligible credit.",
      );
    }

    let hash: Hex;
    try {
      hash = await this.vaultClient.submitReserve({
        reservationId: reservationId(pending.reservationId),
        customer: checked.wallet,
        maximumCharge: checked.pricing.maximumCharge,
        expiresAt: Math.floor(checked.expiresAt.getTime() / 1_000),
        termsHash: checked.termsHash,
        customerSignature: reservationSignature(pending.reservationSignature),
      });
    } catch {
      throw new Error("Vault reservation submission outcome is unknown.");
    }

    await this.prisma.creditAuthorization.update({
      where: { id: pending.id },
      data: { vaultTransactionHash: hash },
    });
    const outcome = await this.vaultClient.transactionOutcome(hash);
    if (outcome !== "confirmed") {
      const recovered = await this.recoverPendingAuthorization(pending);
      if (recovered) return recovered;
      if (outcome === "reverted") {
        await this.prisma.creditAuthorization.update({
          where: { id: pending.id },
          data: { vaultTransactionHash: null },
        });
        throw new Error("Authorization reserve reverted before creating a reservation.");
      }
      throw new Error("Authorization reserve is pending confirmation.");
    }
    const reserved = await this.recoverPendingAuthorization(pending);
    if (!reserved) {
      throw new Error(
        "Confirmed authorization reserve is unavailable for canonical reconciliation.",
      );
    }
    return reserved;
  }

  async finalize(input: CompletionInput): Promise<{ status: FinalizationStatus }> {
    canonicalText(input.authorizationId, MAX_IDENTIFIER_LENGTH, "Authorization identifier");
    const authorization = await this.prisma.creditAuthorization.findUnique({
      where: { id: input.authorizationId },
      include: { usageRecord: true },
    });
    if (!authorization) {
      throw new Error("Authorization not found.");
    }
    if (isFinalStatus(authorization.status)) {
      this.assertIdempotentFinalization(
        authorization.status,
        input.outcome,
        authorization.usageRecord,
        input.components,
        input.providerReference,
      );
      return { status: finalizationStatus(authorization.status) };
    }
    if (
      authorization.status !== CreditAuthorizationStatus.RESERVED &&
      authorization.status !== CreditAuthorizationStatus.PROVISIONAL
    ) {
      throw new Error(`Authorization cannot be finalized (status: ${authorization.status}).`);
    }
    if (input.components === null) {
      if (input.providerReference !== null) {
        throw new Error("Provisional usage cannot include a provider reference.");
      }
      if (authorization.status === CreditAuthorizationStatus.PROVISIONAL) {
        return { status: "provisional" };
      }
      await this.prisma.$transaction(async transaction => {
        await transaction.creditUsageRecord.create({
          data: {
            id: crypto.randomUUID(),
            authorizationId: authorization.id,
            status: CreditUsageStatus.PROVISIONAL,
            zeroGMicroUsdc: 0n,
            fmpMicroUsdc: 0n,
            legServiceMicroUsdc: 0n,
            totalMicroUsdc: 0n,
            customerChargeMicroUsdc: 0n,
            providerReferenceHash: this.provisionalProviderReferenceHash(),
            createdAt: new Date(),
          },
        });
        await transaction.creditAuthorization.update({
          where: { id: authorization.id },
          data: { status: CreditAuthorizationStatus.PROVISIONAL },
        });
      });
      return { status: "provisional" };
    }

    const components = checkedComponents(input.components);
    const providerReferenceHash = this.checkedProviderReferenceHash(
      input.providerReference,
      components.total,
    );
    if (
      authorization.serviceType === CreditServiceType.TRADING_PLATFORM &&
      (components["0g"] !== 0n || components.fmp !== 0n)
    ) {
      throw new Error(
        "Trading platform handoff permits only disclosed Leg platform-service usage.",
      );
    }
    const customerCharge = validateMicroUsdc(
      minimum(components["0g"], authorization.priceZeroGMicroUsdc) +
        minimum(components.fmp, authorization.priceFmpMicroUsdc) +
        minimum(components.legService, authorization.priceLegServiceMicroUsdc),
    );
    const expired = authorization.expiresAt.getTime() <= Date.now();
    const targetAuthorizationStatus = expired
      ? CreditAuthorizationStatus.EXPIRED
      : input.outcome === "failed" && components.total === 0n
        ? CreditAuthorizationStatus.RELEASED
        : input.outcome === "failed"
          ? CreditAuthorizationStatus.FAILED
          : CreditAuthorizationStatus.SETTLED;
    const targetUsageStatus = expired
      ? CreditUsageStatus.FAILED
      : input.outcome === "failed" && components.total === 0n
        ? CreditUsageStatus.RELEASED
        : input.outcome === "failed"
          ? CreditUsageStatus.FAILED
          : CreditUsageStatus.SETTLED;
    const actualCustomerCharge = expired ? 0n : customerCharge;
    const finalizationWasPrepared =
      authorization.usageRecord !== null &&
      authorization.usageRecord.providerReferenceHash !==
        this.provisionalProviderReferenceHash();

    await this.prepareFinalUsage(
      authorization,
      components,
      providerReferenceHash,
    );
    const id = reservationId(authorization.reservationId);
    let reservation = await this.vaultClient.getReservation(id);
    if (!this.reservationMatchesAuthorization(reservation, authorization)) {
      throw new Error("Onchain reservation does not match authorization.");
    }
    const releaseExpected =
      targetAuthorizationStatus === CreditAuthorizationStatus.RELEASED ||
      targetAuthorizationStatus === CreditAuthorizationStatus.EXPIRED;
    if (
      reservation.status === 1 &&
      authorization.vaultTransactionHash &&
      finalizationWasPrepared
    ) {
      const hash = reservationId(authorization.vaultTransactionHash);
      const outcome = await this.vaultClient.transactionOutcome(hash);
      if (outcome === "unknown") {
        throw new Error("Vault finalization is pending confirmation.");
      }
      if (outcome === "reverted") {
        await this.prisma.creditAuthorization.update({
          where: { id: authorization.id },
          data: { vaultTransactionHash: null },
        });
      }
      reservation = await this.vaultClient.getReservation(id);
      if (!this.reservationMatchesAuthorization(reservation, authorization)) {
        throw new Error("Onchain reservation changed during finalization.");
      }
    }
    if (reservation.status === 1) {
      let hash: Hex;
      try {
        hash = releaseExpected
          ? await this.vaultClient.submitRelease(id)
          : await this.vaultClient.submitSettle(id, actualCustomerCharge);
      } catch {
        throw new Error("Vault finalization submission outcome is unknown.");
      }
      await this.prisma.creditAuthorization.update({
        where: { id: authorization.id },
        data: { vaultTransactionHash: hash },
      });
      const outcome = await this.vaultClient.transactionOutcome(hash);
      if (outcome === "unknown") {
        throw new Error("Vault finalization is pending confirmation.");
      }
      if (outcome === "reverted") {
        await this.prisma.creditAuthorization.update({
          where: { id: authorization.id },
          data: { vaultTransactionHash: null },
        });
        throw new Error("Vault finalization reverted before changing the reservation.");
      }
      reservation = await this.vaultClient.getReservation(id);
      if (!this.reservationMatchesAuthorization(reservation, authorization)) {
        throw new Error("Onchain reservation changed during finalization.");
      }
    }
    if (
      (releaseExpected &&
        (reservation.status !== 3 || reservation.finalCharge !== 0n)) ||
      (!releaseExpected &&
        (reservation.status !== 2 ||
          reservation.finalCharge !== actualCustomerCharge))
    ) {
      throw new Error("Onchain reservation finalization does not match prepared usage.");
    }
    await this.prisma.$transaction(async transaction => {
      await transaction.creditUsageRecord.update({
        where: { authorizationId: authorization.id },
        data: {
          status: targetUsageStatus,
          customerChargeMicroUsdc: actualCustomerCharge,
          providerReferenceHash,
        },
      });
      await transaction.creditAuthorization.update({
        where: { id: authorization.id },
        data: { status: targetAuthorizationStatus },
      });
    });
    return { status: finalizationStatus(targetAuthorizationStatus) };
  }

  async addCorrection(input: {
    usageRecordId: string;
    reason: string;
    components: Readonly<Record<CreditComponent, MicroUsdc>>;
  }): Promise<void> {
    const reason = canonicalText(input.reason, 512, "Correction reason");
    const components = checkedComponents(input.components);
    const usage = await this.prisma.creditUsageRecord.findUnique({
      where: { id: input.usageRecordId },
    });
    if (!usage) throw new Error("Usage record not found.");
    await this.prisma.creditUsageCorrection.create({
      data: {
        id: crypto.randomUUID(),
        usageRecordId: usage.id,
        reason,
        zeroGMicroUsdc: components["0g"],
        fmpMicroUsdc: components.fmp,
        legServiceMicroUsdc: components.legService,
        totalMicroUsdc: components.total,
        createdAt: new Date(),
      },
    });
  }

  private checkedAuthorizationInput(input: AuthorizationInput) {
    if (!isBillingConfig(this.config)) {
      throw new Error("Credit billing configuration is required for authorization.");
    }
    if (!isAddress(input.wallet)) throw new Error("Authorization wallet is invalid.");
    const wallet = getAddress(input.wallet);
    const correlationId = canonicalText(
      input.correlationId,
      MAX_IDENTIFIER_LENGTH,
      "Correlation identifier",
    );
    const pricing = checkedPricing(input.pricing);
    const expiresSeconds = BigInt(Math.floor(input.expiresAt.getTime() / 1_000));
    if (
      !Number.isFinite(input.expiresAt.getTime()) ||
      input.expiresAt.getTime() <= Date.now() ||
      expiresSeconds > MAX_UINT48
    ) {
      throw new Error("Authorization expiry is invalid.");
    }
    const expiresAt = new Date(Number(expiresSeconds) * 1_000);
    const chargePurpose = createCreditChargePurpose({
      correlationId,
      expiresAt,
      serviceType: input.serviceType,
      pricing,
    });
    if (
      input.serviceType === "trading-platform" &&
      (pricing.components["0g"] !== 0n || pricing.components.fmp !== 0n)
    ) {
      throw new Error(
        "Trading platform authorization permits only a disclosed Leg platform-service price.",
      );
    }
    if (
      pricing.components.fmp > 0n &&
      !this.config.fmpProductionLicenseConfirmed
    ) {
      throw new Error(
        "FMP production licence is not confirmed for this price snapshot.",
      );
    }
    return {
      wallet,
      correlationId,
      serviceType: input.serviceType,
      pricing,
      expiresAt,
      chargePurpose,
      termsHash: keccak256(toBytes(chargePurpose)),
    };
  }

  private async createPendingAuthorization(
    input: ReturnType<CreditLedgerService["checkedAuthorizationInput"]>,
  ): Promise<CreditAuthorization> {
    const id = crypto.randomUUID();
    return this.prisma.creditAuthorization.create({
      data: {
        id,
        challengeId: null,
        correlationId: input.correlationId,
        reservationId: creditReservationId(id),
        reservationSignature: null,
        wallet: input.wallet.toLowerCase(),
        serviceType:
          input.serviceType === "advisor"
            ? CreditServiceType.ADVISOR
            : CreditServiceType.TRADING_PLATFORM,
        priceVersion: input.pricing.version,
        priceZeroGMicroUsdc: input.pricing.components["0g"],
        priceFmpMicroUsdc: input.pricing.components.fmp,
        priceLegServiceMicroUsdc: input.pricing.components.legService,
        maximumChargeMicroUsdc: input.pricing.maximumCharge,
        chargePurpose: input.chargePurpose,
        expiresAt: input.expiresAt,
        status: CreditAuthorizationStatus.PENDING,
      },
    });
  }

  private preparedAuthorization(
    authorization: CreditAuthorization,
  ): PreparedAuthorization {
    const terms = this.authorizationTerms(authorization);
    return {
      authorizationId: authorization.id,
      reservationId: reservationId(authorization.reservationId),
      expiresAt: authorization.expiresAt,
      chargePurpose: authorization.chargePurpose,
      typedData: createCreditReservationTypedData({
        authorizationId: authorization.id,
        chainId: this.config.baseChainId,
        vaultAddress: this.config.vaultAddress,
        wallet: terms.wallet,
        correlationId: authorization.correlationId,
        serviceType: terms.serviceType,
        pricing: terms.pricing,
        expiresAt: authorization.expiresAt,
      }),
    };
  }

  private authorizationTerms(authorization: CreditAuthorization) {
    const serviceType: ServiceType =
      authorization.serviceType === CreditServiceType.ADVISOR
        ? "advisor"
        : "trading-platform";
    const pricing = checkedPricing({
      version: authorization.priceVersion,
      components: {
        "0g": authorization.priceZeroGMicroUsdc,
        fmp: authorization.priceFmpMicroUsdc,
        legService: authorization.priceLegServiceMicroUsdc,
      },
      maximumCharge: authorization.maximumChargeMicroUsdc,
    });
    const wallet = getAddress(authorization.wallet);
    const chargePurpose = createCreditChargePurpose({
      correlationId: authorization.correlationId,
      expiresAt: authorization.expiresAt,
      serviceType,
      pricing,
    });
    if (chargePurpose !== authorization.chargePurpose) {
      throw new Error("Stored authorization terms are inconsistent.");
    }
    return {
      wallet,
      correlationId: authorization.correlationId,
      serviceType,
      pricing,
      expiresAt: authorization.expiresAt,
      chargePurpose,
      termsHash: keccak256(toBytes(chargePurpose)),
    };
  }

  private assertCompatibleAuthorization(
    existing: CreditAuthorization,
    input: ReturnType<CreditLedgerService["checkedAuthorizationInput"]>,
  ): void {
    const compatible =
      existing.wallet === input.wallet.toLowerCase() &&
      existing.serviceType ===
        (input.serviceType === "advisor"
          ? CreditServiceType.ADVISOR
          : CreditServiceType.TRADING_PLATFORM) &&
      existing.priceVersion === input.pricing.version &&
      existing.priceZeroGMicroUsdc === input.pricing.components["0g"] &&
      existing.priceFmpMicroUsdc === input.pricing.components.fmp &&
      existing.priceLegServiceMicroUsdc === input.pricing.components.legService &&
      existing.maximumChargeMicroUsdc === input.pricing.maximumCharge &&
      existing.chargePurpose === input.chargePurpose &&
      existing.expiresAt.getTime() === input.expiresAt.getTime();
    if (!compatible) {
      throw new Error("Correlation identifier already exists with different terms.");
    }
  }

  private async resumeOrReturnAuthorization(
    existing: CreditAuthorization,
  ) {
    if (existing.status === CreditAuthorizationStatus.REJECTED) {
      throw new Error(existing.rejectionReason ?? "Authorization was rejected.");
    }
    if (
      existing.status === CreditAuthorizationStatus.PENDING &&
      existing.vaultTransactionHash
    ) {
      const hash = reservationId(existing.vaultTransactionHash);
      const outcome = await this.vaultClient.transactionOutcome(hash);
      if (outcome !== "confirmed") {
        const recovered = await this.recoverPendingAuthorization(existing);
        if (recovered) return recovered;
        if (outcome === "reverted") {
          const retryable = await this.prisma.creditAuthorization.update({
            where: { id: existing.id },
            data: { vaultTransactionHash: null },
          });
          return this.reservePendingAuthorization(retryable);
        }
        throw new Error("Authorization reserve is pending confirmation.");
      }
      const recovered = await this.recoverPendingAuthorization(existing);
      if (!recovered) {
        throw new Error(
          "Confirmed authorization reserve is unavailable for canonical reconciliation.",
        );
      }
      return recovered;
    }
    if (existing.status === CreditAuthorizationStatus.PENDING) {
      reservationSignature(existing.reservationSignature);
      const reservation = await this.vaultClient.getReservation(
        reservationId(existing.reservationId),
      );
      if (reservation.status === 0) {
        return this.reservePendingAuthorization(existing);
      }
      if (!this.reservationMatchesAuthorization(reservation, existing)) {
        throw new Error("Onchain reservation does not match pending authorization.");
      }
      if (reservation.status !== 1 || reservation.finalCharge !== 0n) {
        throw new Error("Pending authorization requires manual reconciliation.");
      }
      return this.markAuthorizationReserved(existing);
    }
    if (existing.status === CreditAuthorizationStatus.RESERVED) {
      return authorizationResult(existing);
    }
    throw new Error(
      `Authorization correlation is not reusable (status: ${existing.status}).`,
    );
  }

  private reservationMatchesAuthorization(
    reservation: Awaited<ReturnType<CreditVaultGateway["getReservation"]>>,
    authorization: CreditAuthorization,
  ): boolean {
    return (
      reservation.customer.toLowerCase() === authorization.wallet &&
      reservation.maximumCharge === authorization.maximumChargeMicroUsdc &&
      reservation.expiresAt ===
        Math.floor(authorization.expiresAt.getTime() / 1_000) &&
      reservation.termsHash === keccak256(toBytes(authorization.chargePurpose))
    );
  }

  private async recoverPendingAuthorization(
    authorization: CreditAuthorization,
  ): Promise<ReturnType<typeof authorizationResult> | null> {
    const reservation = await this.vaultClient.getReservation(
      reservationId(authorization.reservationId),
    );
    if (reservation.status === 0) return null;
    if (!this.reservationMatchesAuthorization(reservation, authorization)) {
      throw new Error("Onchain reservation does not match pending authorization.");
    }
    if (reservation.status !== 1 || reservation.finalCharge !== 0n) {
      throw new Error("Pending authorization requires manual reconciliation.");
    }
    return this.markAuthorizationReserved(authorization);
  }

  private async markAuthorizationReserved(
    authorization: CreditAuthorization,
  ): Promise<ReturnType<typeof authorizationResult>> {
    const reserved = await this.prisma.creditAuthorization.update({
      where: { id: authorization.id },
      data: { status: CreditAuthorizationStatus.RESERVED },
    });
    return authorizationResult(reserved);
  }

  private async rejectAuthorization(
    authorization: CreditAuthorization,
    reason: string,
  ): Promise<never> {
    await this.prisma.creditAuthorization.update({
      where: { id: authorization.id },
      data: {
        status: CreditAuthorizationStatus.REJECTED,
        rejectionReason: reason,
      },
    });
    throw new Error(reason);
  }

  private async prepareFinalUsage(
    authorization: CreditAuthorization & { usageRecord: CreditUsageRecord | null },
    components: ReturnType<typeof checkedComponents>,
    providerReferenceHash: string,
  ): Promise<CreditUsageRecord> {
    const data = {
      status: CreditUsageStatus.PROVISIONAL,
      zeroGMicroUsdc: components["0g"],
      fmpMicroUsdc: components.fmp,
      legServiceMicroUsdc: components.legService,
      totalMicroUsdc: components.total,
      customerChargeMicroUsdc: 0n,
      providerReferenceHash,
    };
    if (authorization.usageRecord) {
      if (
        authorization.usageRecord.totalMicroUsdc > 0n ||
        authorization.usageRecord.providerReferenceHash !==
          this.provisionalProviderReferenceHash()
      ) {
        if (
          authorization.usageRecord.zeroGMicroUsdc !== components["0g"] ||
          authorization.usageRecord.fmpMicroUsdc !== components.fmp ||
          authorization.usageRecord.legServiceMicroUsdc !==
            components.legService ||
          authorization.usageRecord.providerReferenceHash !==
            providerReferenceHash
        ) {
          throw new Error("Pending vault finalization has different usage.");
        }
        return authorization.usageRecord;
      }
      return this.prisma.creditUsageRecord.update({
        where: { authorizationId: authorization.id },
        data,
      });
    }
    return this.prisma.creditUsageRecord.create({
      data: {
        ...data,
        id: crypto.randomUUID(),
        authorizationId: authorization.id,
        createdAt: new Date(),
      },
    });
  }

  private checkedProviderReferenceHash(
    reference: string | null,
    totalUsage: bigint,
  ): string {
    if (totalUsage === 0n) {
      if (reference !== null) {
        throw new Error("Zero usage cannot include a provider reference.");
      }
      return this.hashProviderReference(null);
    }
    if (reference === null) {
      throw new Error("Reported usage requires a provider reference.");
    }
    return this.hashProviderReference(
      canonicalText(reference, 512, "Provider reference"),
    );
  }

  private assertIdempotentFinalization(
    status: CreditAuthorizationStatus,
    outcome: CompletionInput["outcome"],
    usage: CreditUsageRecord | null,
    components: CompletionInput["components"],
    providerReference: string | null,
  ): void {
    if (
      (status === CreditAuthorizationStatus.SETTLED && outcome !== "succeeded") ||
      ((status === CreditAuthorizationStatus.RELEASED ||
        status === CreditAuthorizationStatus.FAILED) &&
        outcome !== "failed")
    ) {
      throw new Error("Authorization was already finalized with a different outcome.");
    }
    if (!usage) {
      throw new Error("Finalized authorization usage is unavailable.");
    }
    if (components === null) {
      if (providerReference !== null) {
        throw new Error("Provisional usage cannot include a provider reference.");
      }
      if (usage.totalMicroUsdc !== 0n) {
        throw new Error(
          "Authorization was already finalized with different usage or provider reference.",
        );
      }
      return;
    }
    const checked = checkedComponents(components);
    const providerReferenceHash = this.checkedProviderReferenceHash(
      providerReference,
      checked.total,
    );
    if (
      usage.zeroGMicroUsdc !== checked["0g"] ||
      usage.fmpMicroUsdc !== checked.fmp ||
      usage.legServiceMicroUsdc !== checked.legService ||
      usage.providerReferenceHash !== providerReferenceHash
    ) {
      throw new Error(
        "Authorization was already finalized with different usage or provider reference.",
      );
    }
  }

  private hashProviderReference(reference: string | null): string {
    return crypto.createHash("sha256").update(reference ?? "").digest("hex");
  }

  private provisionalProviderReferenceHash(): string {
    return crypto
      .createHash("sha256")
      .update("leg:provisional-no-provider-reference")
      .digest("hex");
  }
}
