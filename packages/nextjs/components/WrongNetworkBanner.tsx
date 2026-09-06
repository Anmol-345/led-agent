"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { botchain, botchainTestnet } from "@/lib/config/chain";
import { DEPLOYMENT, isBotchain } from "@/lib/deployment";

function isRequestFn(
  value: unknown
): value is (args: { method: string; params?: unknown[] }) => Promise<unknown> {
  return typeof value === "function";
}

function getWalletRequest():
  | ((args: { method: string; params?: unknown[] }) => Promise<unknown>)
  | null {
  if (typeof window === "undefined") return null;
  const ethereum = Reflect.get(window, "ethereum");
  if (typeof ethereum !== "object" || ethereum === null) return null;
  const request = Reflect.get(ethereum, "request");
  return isRequestFn(request) ? request.bind(ethereum) : null;
}

/**
 * Blocking banner when the wallet is on the wrong chain (BOT Chain port).
 */
export function WrongNetworkBanner() {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const expected = DEPLOYMENT.vaultChainId;

  if (!isBotchain || !isConnected || chainId === expected) return null;

  async function fixNetwork() {
    const request = getWalletRequest();
    if (!request) return;
    const chain = DEPLOYMENT.target === "botchain" ? botchain : botchainTestnet;
    try {
      await switchChainAsync({ chainId: expected });
    } catch {
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
      await switchChainAsync({ chainId: expected });
    }
  }

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 bg-amber-950 px-4 py-3 text-amber-50"
    >
      <p className="text-sm">
        Wrong network. Switch to {DEPLOYMENT.vaultChainName} (chain {expected}) to use
        credits. Confirmations land in under a second (~$0.002 gas).
      </p>
      <button
        type="button"
        onClick={() => void fixNetwork()}
        className="shrink-0 rounded bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-950"
      >
        Add / switch network
      </button>
    </div>
  );
}
