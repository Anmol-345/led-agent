import { getAddress, isAddress, type Address } from "viem";
import { DEPLOYMENT } from "../deployment";

export const QUOTE_TTL_SECONDS = 30;
export const INTEGRATOR_FEE_BPS = 10 as const;
export const DEFAULT_DEV_FEE_RECIPIENT = getAddress(
  "0x2222222222222222222222222222222222222222"
);

export type TradingConfig = {
  quoteTtlSeconds: number;
  integratorFeeBps: 10;
  feeRecipient: Address;
  uniswapApiKey: string;
  uniswapApiBaseUrl: string;
  useUniswapApi: boolean;
  allowedChains: readonly number[];
  rpcUrls: Readonly<Record<number, string>>;
};

export function loadTradingConfig(
  env: Record<string, string | undefined> = process.env,
  options: { strictKeyCheck?: boolean } = {}
): TradingConfig {
  const feeRecipientRaw =
    env.LEG_INTEGRATOR_FEE_RECIPIENT !== undefined
      ? env.LEG_INTEGRATOR_FEE_RECIPIENT
      : DEFAULT_DEV_FEE_RECIPIENT;

  if (!feeRecipientRaw || !isAddress(feeRecipientRaw)) {
    throw new Error(
      "Trading configuration failed: LEG_INTEGRATOR_FEE_RECIPIENT must be a valid EVM address."
    );
  }
  const feeRecipient = getAddress(feeRecipientRaw);

  const useUniswapApi =
    env.USE_UNISWAP_API === "true" || env.USE_UNISWAP_API === "1";

  const uniswapApiKey = env.UNISWAP_API_KEY?.trim();
  if (useUniswapApi && !uniswapApiKey) {
    throw new Error(
      "Trading configuration failed: USE_UNISWAP_API is enabled but UNISWAP_API_KEY is missing."
    );
  }
  if (
    options.strictKeyCheck &&
    (!uniswapApiKey || uniswapApiKey.trim() === "")
  ) {
    throw new Error(
      "Trading configuration failed: UNISWAP_API_KEY must be provided."
    );
  }

  const uniswapApiBaseUrl =
    env.UNISWAP_API_BASE_URL || "https://trade-api.gateway.uniswap.org/v1";

  // Quote chains come from the deployment target; on testnet the stand-in execution chain
  // must be allowed too, since that is where the swap is actually quoted and signed.
  // ALLOWED_TRADING_CHAINS still overrides, mainly for tests.
  const defaultChains = Array.from(
    new Set<number>([
      ...DEPLOYMENT.quoteChainIds,
      ...(DEPLOYMENT.executionChainId === "asset-chain"
        ? []
        : [DEPLOYMENT.executionChainId]),
    ])
  ).join(",");
  const allowedChainsRaw = env.ALLOWED_TRADING_CHAINS || defaultChains;
  const allowedChains = allowedChainsRaw
    .split(",")
    .map(c => parseInt(c.trim(), 10))
    .filter(c => !isNaN(c) && c > 0);

  if (allowedChains.length === 0) {
    throw new Error(
      "Trading configuration failed: ALLOWED_TRADING_CHAINS must specify at least one chain ID."
    );
  }

  const rpcUrls: Record<number, string> = {};
  for (const chainId of allowedChains) {
    const envKey = `TRADING_RPC_URL_${chainId}`;
    const fallbackEnvKey = chainId === 8453 ? "BASE_RPC_URL" : undefined;
    const url =
      env[envKey] ||
      (fallbackEnvKey ? env[fallbackEnvKey] : undefined) ||
      getDefaultRpcUrl(chainId);
    if (!url) {
      throw new Error(
        `Trading configuration failed: Missing RPC URL for chain ID ${chainId}.`
      );
    }
    rpcUrls[chainId] = url;
  }

  return {
    quoteTtlSeconds: QUOTE_TTL_SECONDS,
    integratorFeeBps: INTEGRATOR_FEE_BPS,
    feeRecipient,
    uniswapApiKey: uniswapApiKey || "dev-local-key",
    uniswapApiBaseUrl,
    useUniswapApi,
    allowedChains,
    rpcUrls,
  };
}

function getDefaultRpcUrl(chainId: number): string | undefined {
  switch (chainId) {
    case 8453:
      return "https://mainnet.base.org";
    case 4663:
      // Robinhood Chain. Public endpoint; Alchemy is the vendor-recommended alternative.
      return "https://rpc.mainnet.chain.robinhood.com";
    case 11155111:
      return "https://ethereum-sepolia-rpc.publicnode.com";
    case 84532:
      return "https://sepolia.base.org";
    case 1:
      return "https://cloudflare-eth.com";
    default:
      return undefined;
  }
}
