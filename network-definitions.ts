import { targetNetwork, rpcOverrides } from "./scaffold.config";

export type NetworkKey =
  | "ethereum"
  | "base"
  | "sepolia"
  | "baseSepolia"
  | "polygon"
  | "bnb"
  | "localhost";

export type TokenDef = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
};

export type NetworkDefinition = {
  key: NetworkKey;
  chainId: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  blockExplorerUrl: string;
  /** Agent0 / registry subgraph (The Graph). Replace if you use a custom deployment. */
  agent0SubgraphUrl: string;
  tokens: TokenDef[];
};

export const NETWORKS: Record<NetworkKey, NetworkDefinition> = {
  ethereum: {
    key: "ethereum",
    chainId: 1,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://eth.llamarpc.com",
    blockExplorerUrl: "https://etherscan.io",
    agent0SubgraphUrl:
      "https://api.studio.thegraph.com/query/82628/agent0-ethereum/v0.0.1",
    tokens: [
      {
        symbol: "USDC",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        decimals: 6,
      },
      {
        symbol: "USDT",
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        decimals: 6,
      },
      {
        symbol: "DAI",
        address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        decimals: 18,
      },
      {
        symbol: "WETH",
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        decimals: 18,
      },
    ],
  },
  base: {
    key: "base",
    chainId: 8453,
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://mainnet.base.org",
    blockExplorerUrl: "https://basescan.org",
    agent0SubgraphUrl:
      "https://api.studio.thegraph.com/query/82628/agent0-base/v0.0.1",
    tokens: [
      {
        symbol: "USDC",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
      },
      {
        symbol: "WETH",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
      },
    ],
  },
  sepolia: {
    key: "sepolia",
    chainId: 11155111,
    name: "Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://rpc.sepolia.org",
    blockExplorerUrl: "https://sepolia.etherscan.io",
    agent0SubgraphUrl:
      "https://api.studio.thegraph.com/query/82628/agent0-sepolia/v0.0.1",
    tokens: [
      {
        symbol: "USDC",
        address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        decimals: 6,
      },
    ],
  },
  baseSepolia: {
    key: "baseSepolia",
    chainId: 84532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "https://sepolia.base.org",
    blockExplorerUrl: "https://sepolia.basescan.org",
    agent0SubgraphUrl:
      "https://api.studio.thegraph.com/query/82628/agent0-base-sepolia/v0.0.1",
    tokens: [
      {
        symbol: "USDC",
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        decimals: 6,
      },
    ],
  },
  polygon: {
    key: "polygon",
    chainId: 137,
    name: "Polygon",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrl: "https://polygon-rpc.com",
    blockExplorerUrl: "https://polygonscan.com",
    agent0SubgraphUrl:
      "https://api.studio.thegraph.com/query/82628/agent0-polygon/v0.0.1",
    tokens: [
      {
        symbol: "USDC",
        address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        decimals: 6,
      },
      {
        symbol: "USDT",
        address: "0xc2132D05D31c914a87C6611c10748AEb04B58e8F",
        decimals: 6,
      },
      {
        symbol: "DAI",
        address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        decimals: 18,
      },
      {
        symbol: "WETH",
        address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        decimals: 18,
      },
    ],
  },
  bnb: {
    key: "bnb",
    chainId: 56,
    name: "BNB Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrl: "https://bsc-dataseed.binance.org",
    blockExplorerUrl: "https://bscscan.com",
    agent0SubgraphUrl:
      "https://api.studio.thegraph.com/query/82628/agent0-bnb/v0.0.1",
    tokens: [
      {
        symbol: "USDC",
        address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        decimals: 18,
      },
      {
        symbol: "USDT",
        address: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18,
      },
      {
        symbol: "DAI",
        address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
        decimals: 18,
      },
      {
        symbol: "WBNB",
        address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        decimals: 18,
      },
    ],
  },
  localhost: {
    key: "localhost",
    chainId: 31337,
    name: "Localhost",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrl: "http://127.0.0.1:8545",
    blockExplorerUrl: "http://localhost:8545",
    agent0SubgraphUrl: "",
    tokens: [],
  },
};

export function getActiveNetwork(): NetworkDefinition {
  const key = targetNetwork as NetworkKey;
  const net = NETWORKS[key];
  if (!net) {
    throw new Error(`Unknown targetNetwork: ${String(targetNetwork)}`);
  }
  const byChain = rpcOverrides[String(net.chainId)];
  const byKey = rpcOverrides[key];
  const override = byChain || byKey;
  return { ...net, rpcUrl: override?.trim() || net.rpcUrl };
}

/** Re-export for wallet config (burner wallet, etc.). */
export { targetNetwork, rpcOverrides, type TargetNetwork } from "./scaffold.config";
