import { defineChain } from "viem";

/** BOT Chain mainnet — https://chainlist.org/chain/677 */
export const botchain = defineChain({
  id: 677,
  name: "BOT Chain",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.botchain.ai"] } },
  blockExplorers: {
    default: { name: "BOTScan", url: "https://scan.botchain.ai" },
  },
});

/** BOT Chain testnet (Bohr) */
export const botchainTestnet = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.bohr.life"] } },
  blockExplorers: {
    default: { name: "BOTScan Testnet", url: "https://scan.bohr.life" },
  },
  testnet: true,
});

export const BOTCHAIN_MAINNET_ID = 677;
export const BOTCHAIN_TESTNET_ID = 968;

export async function addBotChain(
  request: (args: {
    method: "wallet_addEthereumChain";
    params: [
      {
        chainId: string;
        chainName: string;
        nativeCurrency: { name: string; symbol: string; decimals: number };
        rpcUrls: string[];
        blockExplorerUrls?: string[];
      },
    ];
  }) => Promise<unknown>,
  target: "mainnet" | "testnet" = "mainnet",
): Promise<void> {
  const chain = target === "mainnet" ? botchain : botchainTestnet;
  await request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: `0x${chain.id.toString(16)}`,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [...chain.rpcUrls.default.http],
        blockExplorerUrls: [chain.blockExplorers.default.url],
      },
    ],
  });
}
