import { createPublicClient, erc20Abi, getAddress, http, isAddress, type Address } from "viem";

/**
 * Read-only reads of holdings the authenticated wallet selected.
 *
 * The reader calls `balanceOf` and nothing else. It never requests a private key, a transfer
 * approval, or any custody permission, and it never infers a ticker, price, issuer eligibility, or
 * trading availability from token metadata. An asset outside the configured support list, or one
 * whose read fails, is reported explicitly rather than guessed.
 */

const MAXIMUM_SELECTIONS = 64;

export type AdvisorSupportedAsset = {
  chainId: number;
  decimals: number;
  /** The research symbol this token is mapped to, or null when it is deliberately unvalued. */
  researchSymbol: string | null;
  token: Address;
};

/**
 * The reviewed support list. Adding a chain or token mapping requires a new specification or a
 * reviewed amendment, so this stays a fixed table rather than runtime input.
 */
export const ADVISOR_SUPPORTED_ASSETS: readonly AdvisorSupportedAsset[] = [
  {
    chainId: 8453,
    decimals: 6,
    researchSymbol: null,
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
];

export type AdvisorAssetSelection = {
  chainId: number;
  token: string;
};

export type HoldingObservation =
  | {
      amount: bigint;
      chainId: number;
      decimals: number;
      kind: "observed";
      readAt: Date;
      /** Present only for a configured mapping; null keeps the holding explicitly unvalued. */
      research: { symbol: string } | null;
      token: Address;
    }
  | {
      chainId: number;
      kind: "unavailable";
      reason: "read-failed" | "unsupported-asset";
      readAt: Date;
      token: string;
    };

export type BalanceReader = {
  balanceOf(input: { chainId: number; owner: Address; token: Address }): Promise<bigint>;
};

/** Reads ERC-20 balances over the configured RPC endpoints. No signer is ever constructed. */
export function createRpcBalanceReader(
  rpcUrlsByChainId: Readonly<Record<number, string>> = { 8453: process.env.CREDIT_BASE_RPC_URL ?? "https://mainnet.base.org" },
): BalanceReader {
  return {
    async balanceOf(input) {
      const rpcUrl = rpcUrlsByChainId[input.chainId] ?? "https://mainnet.base.org";
      const client = createPublicClient({ transport: http(rpcUrl) });
      return client.readContract({
        abi: erc20Abi,
        address: input.token,
        args: [input.owner],
        functionName: "balanceOf",
      });
    },
  };
}

export class PortfolioReader {
  private readonly assets: readonly AdvisorSupportedAsset[];
  private readonly balances: BalanceReader;
  private readonly now: () => Date;

  constructor(options?: {
    /** Defaults to the reviewed support list; a deployment supplies its own verified table. */
    assets?: readonly AdvisorSupportedAsset[];
    balances?: BalanceReader;
    now?: () => Date;
  }) {
    this.assets = options?.assets ?? ADVISOR_SUPPORTED_ASSETS;
    this.balances = options?.balances ?? createRpcBalanceReader();
    this.now = options?.now ?? (() => new Date());
  }

  private supportedAsset(selection: AdvisorAssetSelection): AdvisorSupportedAsset | null {
    if (!isAddress(selection.token)) return null;
    const token = getAddress(selection.token);
    return (
      this.assets.find(asset => asset.chainId === selection.chainId && asset.token === token) ??
      null
    );
  }

  async read(input: {
    selections: readonly AdvisorAssetSelection[];
    wallet: string;
  }): Promise<readonly HoldingObservation[]> {
    if (!isAddress(input.wallet)) {
      throw new Error("Advisor portfolio wallet is invalid.");
    }
    const wallet = getAddress(input.wallet);

    const unique = new Map<string, AdvisorAssetSelection>();
    for (const selection of input.selections) {
      unique.set(`${selection.chainId}:${selection.token.toLowerCase()}`, selection);
    }
    if (unique.size > MAXIMUM_SELECTIONS) {
      throw new Error(`Advisor portfolio selection exceeds ${MAXIMUM_SELECTIONS} assets.`);
    }

    return Promise.all([...unique.values()].map(selection => this.readOne(selection, wallet)));
  }

  private async readOne(
    selection: AdvisorAssetSelection,
    wallet: Address,
  ): Promise<HoldingObservation> {
    const readAt = this.now();
    const asset = this.supportedAsset(selection);
    if (!asset) {
      return {
        chainId: selection.chainId,
        kind: "unavailable",
        reason: "unsupported-asset",
        readAt,
        token: selection.token,
      };
    }

    try {
      const amount = await this.balances.balanceOf({
        chainId: asset.chainId,
        owner: wallet,
        token: asset.token,
      });
      return {
        amount,
        chainId: asset.chainId,
        decimals: asset.decimals,
        kind: "observed",
        readAt,
        research: asset.researchSymbol === null ? null : { symbol: asset.researchSymbol },
        token: asset.token,
      };
    } catch {
      // RPC endpoints and transport errors never reach the customer-visible observation.
      return {
        chainId: asset.chainId,
        kind: "unavailable",
        reason: "read-failed",
        readAt,
        token: asset.token,
      };
    }
  }
}
