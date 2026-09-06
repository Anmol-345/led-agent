"use client";

import { useEffect, useState } from "react";
import { Droplets, Loader2 } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import { cn } from "@/lib/utils";
import { DEPLOYMENT, chainName } from "@/lib/deployment";

type FaucetInfo = {
  chainId: number;
  chainName: string;
  mockUsdcAddress: `0x${string}` | null;
  mintAmountMicroUsdc: string;
  faucets: { label: string; url: string }[];
};

const MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/**
 * Testnet only. Mints mock credit USDC straight from the user's wallet — the mock's `mint`
 * is permissionless, so no server-side key or funded donor account is involved. Native
 * testnet ETH still has to come from a public faucet, so those links are surfaced too.
 *
 * Wallet state is withheld until mount so SSR and the first client paint agree (avoids a
 * hydration mismatch with wagmi).
 */
export function LocalFaucetButton() {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<FaucetInfo | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!DEPLOYMENT.faucetEnabled) return;
    void fetch("/api/faucet")
      .then(r => (r.ok ? r.json() : null))
      .then(d => setInfo(d))
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.kind === "ok" ? 4500 : 8000;
    const t = window.setTimeout(() => setToast(null), ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!DEPLOYMENT.faucetEnabled) return null;

  if (!mounted) {
    return (
      <div
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/50 animate-pulse"
        aria-hidden
      />
    );
  }

  const vaultChainId = DEPLOYMENT.vaultChainId;
  const disabled = !isConnected || !address || busy;

  async function onFaucet() {
    if (!address || disabled) return;
    setBusy(true);
    setToast(null);
    try {
      if (!info?.mockUsdcAddress) {
        throw new Error(
          "Mock credit USDC is not deployed yet — run `just deploy sepolia` and set CREDIT_USDC_ADDRESS."
        );
      }
      if (chainId !== vaultChainId) {
        setToast({
          kind: "ok",
          text: `Switching wallet to ${chainName(vaultChainId)}…`,
        });
        await switchChainAsync({ chainId: vaultChainId });
      }
      await writeContractAsync({
        abi: MINT_ABI,
        address: info.mockUsdcAddress,
        functionName: "mint",
        args: [address, BigInt(info.mintAmountMicroUsdc)],
        chainId: vaultChainId,
      });
      setToast({ kind: "ok", text: "Minted 1000 test USDC to your wallet." });
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const title = !isConnected
    ? "Connect a wallet first"
    : `Mint 1000 test USDC on ${chainName(vaultChainId)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => void onFaucet()}
        disabled={disabled}
        title={title}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
        aria-label="Testnet faucet"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplets className="h-4 w-4" />}
      </button>
      {toast ? (
        <div
          role="status"
          className={cn(
            "fixed bottom-20 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg",
            toast.kind === "ok"
              ? "border-border bg-card text-foreground"
              : "border-destructive/50 bg-destructive/10 text-destructive",
          )}
        >
          {toast.text}
          {toast.kind === "err" && info?.faucets?.length ? (
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              {info.faucets.map(f => (
                <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="underline">
                  {f.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
