import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  isAddress,
  type Address,
  type Hex,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, sepolia } from "viem/chains";

import { CUSTOMER_CREDIT_VAULT_ABI } from "../../contracts/generatedAbis";
import { DEPLOYMENT, SEPOLIA_CHAIN_ID } from "../deployment";

export { CUSTOMER_CREDIT_VAULT_ABI } from "../../contracts/generatedAbis";

export type VaultTransactionOutcome = "confirmed" | "reverted" | "unknown";

/** Chain hosting the vault. The EIP-712 domain is bound to this id, so it must match the
 *  chain the customer's wallet signs on or reservations will not verify. */
export const VAULT_CHAIN =
  DEPLOYMENT.vaultChainId === SEPOLIA_CHAIN_ID ? sepolia : base;

export const VAULT_CHAIN_ID = VAULT_CHAIN.id;

const DEFAULT_VAULT_RPC_URL = VAULT_CHAIN.rpcUrls.default.http[0];

function createBasePublicClient(rpcUrl: string, transport?: Transport) {
  return createPublicClient({
    chain: VAULT_CHAIN,
    transport: transport ?? http(rpcUrl),
  });
}

function createBillingWalletClient(privateKey: Hex, rpcUrl: string, transport?: Transport) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: VAULT_CHAIN,
    transport: transport ?? http(rpcUrl),
  });
}

type BasePublicClient = ReturnType<typeof createBasePublicClient>;
type BillingWalletClient = ReturnType<typeof createBillingWalletClient>;

export type CreditVaultGateway = {
  getAccountSnapshot(
    customer: Address,
    blockNumber?: bigint,
  ): Promise<{ available: bigint; reserved: bigint; blockNumber: bigint }>;
  availableCreditOf(customer: Address): Promise<bigint>;
  reservedCreditOf(customer: Address): Promise<bigint>;
  verifyReservationAuthorization(input: {
    reservationId: Hex;
    customer: Address;
    maximumCharge: bigint;
    expiresAt: number;
    termsHash: Hex;
    customerSignature: Hex;
  }): Promise<boolean>;
  submitReserve(input: {
    reservationId: Hex;
    customer: Address;
    maximumCharge: bigint;
    expiresAt: number;
    termsHash: Hex;
    /** Omit (or pass "0x") to authorize via the customer's standing session grant. */
    customerSignature?: Hex;
  }): Promise<Hex>;
  /** Budget still drawable under the customer's session grant; 0 if none or expired. */
  remainingSessionAllowance(customer: Address): Promise<bigint>;
  submitSettle(reservationId: Hex, finalCharge: bigint): Promise<Hex>;
  submitRelease(reservationId: Hex): Promise<Hex>;
  transactionOutcome(hash: Hex): Promise<VaultTransactionOutcome>;
  getReservation(reservationId: Hex): Promise<{
    customer: Address;
    maximumCharge: bigint;
    expiresAt: number;
    status: number;
    finalCharge: bigint;
    termsHash: Hex;
  }>;
};

function typedData<const Value>(value: Value): Value {
  return value;
}

export function createReservationTypedData(input: {
  chainId: number;
  vaultAddress: Address;
  reservationId: Hex;
  customer: Address;
  maximumCharge: bigint;
  expiresAt: number;
  termsHash: Hex;
}) {
  return typedData({
    domain: {
      name: "Leg Customer Credit Vault",
      version: "1",
      chainId: input.chainId,
      verifyingContract: input.vaultAddress,
    },
    types: {
      Reservation: [
        { name: "reservationId", type: "bytes32" },
        { name: "customer", type: "address" },
        { name: "maximumCharge", type: "uint256" },
        { name: "expiresAt", type: "uint48" },
        { name: "termsHash", type: "bytes32" },
        { name: "chainId", type: "uint256" },
        { name: "vault", type: "address" },
      ],
    },
    primaryType: "Reservation",
    message: {
      reservationId: input.reservationId,
      customer: input.customer,
      maximumCharge: input.maximumCharge,
      expiresAt: input.expiresAt,
      termsHash: input.termsHash,
      chainId: BigInt(input.chainId),
      vault: input.vaultAddress,
    },
  });
}

function isPrivateKey(value: string): value is Hex {
  return (
    /^0x[0-9a-fA-F]{64}$/.test(value) &&
    value.toLowerCase() !== `0x${"0".repeat(64)}`
  );
}

function normalizedTopics(
  topics: readonly (Hex | readonly Hex[] | null)[],
): [] | [Hex, ...Hex[]] {
  const normalized: Hex[] = [];
  for (const topic of topics) {
    if (typeof topic !== "string") {
      throw new Error("Customer credit vault event topics are not concrete.");
    }
    normalized.push(topic);
  }
  const first = normalized[0];
  return first === undefined ? [] : [first, ...normalized.slice(1)];
}

export class BaseVaultClient implements CreditVaultGateway {
  public readonly vaultAddress: Address;
  public readonly publicClient: BasePublicClient;
  private readonly walletClient: BillingWalletClient | undefined;
  private readonly confirmations: number;
  private readonly receiptTimeoutMs: number;
  private billingRoleVerified = false;

  constructor(options: {
    vaultAddress: Address;
    rpcUrl?: string;
    billingSignerPrivateKey?: Hex;
    confirmations?: number;
    receiptTimeoutMs?: number;
    transport?: Transport;
  }) {
    if (!isAddress(options.vaultAddress)) {
      throw new Error("Customer credit vault address is invalid.");
    }
    const rpcUrl =
      options.rpcUrl ??
      process.env.CREDIT_BASE_RPC_URL ??
      DEFAULT_VAULT_RPC_URL;
    this.vaultAddress = options.vaultAddress;
    this.confirmations = options.confirmations ?? 1;
    this.receiptTimeoutMs = options.receiptTimeoutMs ?? 30_000;
    if (
      !Number.isSafeInteger(this.confirmations) ||
      this.confirmations < 1 ||
      !Number.isSafeInteger(this.receiptTimeoutMs) ||
      this.receiptTimeoutMs < 1
    ) {
      throw new Error(
        "Credit vault confirmations and receipt timeout must be positive integers.",
      );
    }
    this.publicClient = createBasePublicClient(rpcUrl, options.transport);
    if (options.billingSignerPrivateKey !== undefined) {
      if (!isPrivateKey(options.billingSignerPrivateKey)) {
        throw new Error("Credit billing signer private key is invalid.");
      }
      this.walletClient = createBillingWalletClient(
        options.billingSignerPrivateKey,
        rpcUrl,
        options.transport,
      );
    }
  }

  decodeVaultEventLog(log: {
    topics: readonly (Hex | readonly Hex[] | null)[];
    data: Hex;
  }) {
    return decodeEventLog({
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      topics: normalizedTopics(log.topics),
      data: log.data,
    });
  }

  async availableCreditOf(customer: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "availableCreditOf",
      args: [customer],
    });
  }

  async getAccountSnapshot(
    customer: Address,
    blockNumber?: bigint,
  ): Promise<{ available: bigint; reserved: bigint; blockNumber: bigint }> {
    const snapshotBlock = blockNumber ?? (await this.publicClient.getBlockNumber());
    const [available, reserved] = await this.publicClient.multicall({
      allowFailure: false,
      blockNumber: snapshotBlock,
      contracts: [
        {
          address: this.vaultAddress,
          abi: CUSTOMER_CREDIT_VAULT_ABI,
          functionName: "availableCreditOf",
          args: [customer],
        },
        {
          address: this.vaultAddress,
          abi: CUSTOMER_CREDIT_VAULT_ABI,
          functionName: "reservedCreditOf",
          args: [customer],
        },
      ],
    });
    return { available, reserved, blockNumber: snapshotBlock };
  }

  async reservedCreditOf(customer: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "reservedCreditOf",
      args: [customer],
    });
  }

  async totalCustomerLiability(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "totalCustomerLiability",
    });
  }

  async unwithdrawnRevenue(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "unwithdrawnRevenue",
    });
  }

  async verifyReservationAuthorization(input: {
    reservationId: Hex;
    customer: Address;
    maximumCharge: bigint;
    expiresAt: number;
    termsHash: Hex;
    customerSignature: Hex;
  }): Promise<boolean> {
    try {
      return await this.publicClient.verifyTypedData({
        address: input.customer,
        ...createReservationTypedData({
          chainId: VAULT_CHAIN_ID,
          vaultAddress: this.vaultAddress,
          reservationId: input.reservationId,
          customer: input.customer,
          maximumCharge: input.maximumCharge,
          expiresAt: input.expiresAt,
          termsHash: input.termsHash,
        }),
        signature: input.customerSignature,
      });
    } catch {
      return false;
    }
  }

  async getReservation(reservationId: Hex): Promise<{
    customer: Address;
    maximumCharge: bigint;
    expiresAt: number;
    status: number;
    finalCharge: bigint;
    termsHash: Hex;
  }> {
    const [customer, maximumCharge, expiresAt, status, finalCharge, termsHash] =
      await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CUSTOMER_CREDIT_VAULT_ABI,
        functionName: "reservations",
        args: [reservationId],
      });
    return {
      customer,
      maximumCharge,
      expiresAt: Number(expiresAt),
      status,
      finalCharge,
      termsHash,
    };
  }

  async remainingSessionAllowance(customer: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "remainingSessionAllowance",
      args: [customer],
    });
  }

  async submitReserve(input: {
    reservationId: Hex;
    customer: Address;
    maximumCharge: bigint;
    expiresAt: number;
    termsHash: Hex;
    customerSignature?: Hex;
  }): Promise<Hex> {
    const walletClient = this.requiredWalletClient();
    await this.ensureBillingRole(walletClient);
    const { request } = await this.publicClient.simulateContract({
      account: walletClient.account,
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "reserve",
      args: [
        input.reservationId,
        input.customer,
        input.maximumCharge,
        input.expiresAt,
        input.termsHash,
        // An empty signature tells the vault to draw on the standing session grant.
        input.customerSignature ?? "0x",
      ],
    });
    return walletClient.writeContract(request);
  }

  async submitSettle(reservationId: Hex, finalCharge: bigint): Promise<Hex> {
    const walletClient = this.requiredWalletClient();
    await this.ensureBillingRole(walletClient);
    const { request } = await this.publicClient.simulateContract({
      account: walletClient.account,
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "settle",
      args: [reservationId, finalCharge],
    });
    return walletClient.writeContract(request);
  }

  async submitRelease(reservationId: Hex): Promise<Hex> {
    const walletClient = this.requiredWalletClient();
    await this.ensureBillingRole(walletClient);
    const { request } = await this.publicClient.simulateContract({
      account: walletClient.account,
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "release",
      args: [reservationId],
    });
    return walletClient.writeContract(request);
  }

  async transactionOutcome(hash: Hex): Promise<VaultTransactionOutcome> {
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        confirmations: this.confirmations,
        hash,
        timeout: this.receiptTimeoutMs,
      });
      return receipt.status === "success" ? "confirmed" : "reverted";
    } catch {
      return "unknown";
    }
  }

  private requiredWalletClient(): BillingWalletClient {
    if (!this.walletClient) {
      throw new Error("Credit billing signer is required for vault writes.");
    }
    return this.walletClient;
  }

  private async ensureBillingRole(walletClient: BillingWalletClient): Promise<void> {
    if (this.billingRoleVerified) return;
    const billingRole = await this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "BILLING_ROLE",
    });
    const authorized = await this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "hasRole",
      args: [billingRole, walletClient.account.address],
    });
    if (!authorized) {
      throw new Error("Configured credit billing signer does not have BILLING_ROLE.");
    }
    this.billingRoleVerified = true;
  }
}
