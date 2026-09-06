"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import { getActiveNetwork } from "@/lib/networks";
import { useEffectiveAgentAddress } from "@/lib/agent-swarm";

type BalanceRow = { symbol: string; balance: string; decimals: number; address?: string };

type BalancesResponse = {
  native: { symbol: string; balance: string; decimals: number };
  tokens: BalanceRow[];
};

async function fetchBalances(address: string, chainId: number): Promise<BalancesResponse> {
  const res = await fetch("/api/balances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, chainId }),
  });
  const data = (await res.json()) as BalancesResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  return data;
}

function BalancesCard({
  title,
  address,
  loading,
  error,
  data,
}: {
  title: string;
  address: string | null;
  loading: boolean;
  error: string | null;
  data: BalancesResponse | null;
}) {
  if (!address) {
    return (
      <section className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">No address configured or connected.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs font-mono break-all text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">{address}</p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading balances…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>
      ) : data ? (
        <ul className="space-y-3 text-sm">
          <li className="flex justify-between gap-4 border-b border-border pb-3">
            <span className="text-muted-foreground">{data.native.symbol}</span>
            <span className="font-mono">{data.native.balance}</span>
          </li>
          {data.tokens.length === 0 ? (
            <li className="text-xs text-muted-foreground pt-1">
              No ERC-20 tokens listed for this chain in{" "}
              <code className="rounded bg-muted px-1">network-definitions.ts</code> — native balance
              only.
            </li>
          ) : (
            data.tokens.map((t) => (
              <li key={t.symbol + (t.address || "")} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t.symbol}</span>
                <span className="font-mono">{t.balance}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </section>
  );
}

export default function BalancesPage() {
  const net = getActiveNetwork();
  const agentAddress = useEffectiveAgentAddress();
  const { address: walletAddress } = useAccount();

  const [agentData, setAgentData] = useState<BalancesResponse | null>(null);
  const [walletData, setWalletData] = useState<BalancesResponse | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [agentErr, setAgentErr] = useState<string | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);

  const loadAgent = useCallback(async () => {
    if (!agentAddress || !/^0x[a-fA-F0-9]{40}$/i.test(agentAddress)) {
      setAgentData(null);
      setAgentErr(null);
      return;
    }
    setAgentLoading(true);
    setAgentErr(null);
    try {
      setAgentData(await fetchBalances(agentAddress, net.chainId));
    } catch (e) {
      setAgentData(null);
      setAgentErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentLoading(false);
    }
  }, [agentAddress, net.chainId]);

  const loadWallet = useCallback(async () => {
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/i.test(walletAddress)) {
      setWalletData(null);
      setWalletErr(null);
      return;
    }
    setWalletLoading(true);
    setWalletErr(null);
    try {
      setWalletData(await fetchBalances(walletAddress, net.chainId));
    } catch (e) {
      setWalletData(null);
      setWalletErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWalletLoading(false);
    }
  }, [walletAddress, net.chainId]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card/40 px-6 sm:px-8 py-5 flex items-center gap-4 shrink-0">
        <div className="h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/15 flex items-center justify-center shrink-0">
          <Wallet className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">Balances</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Active network: {net.name} ({net.chainId})
          </p>
        </div>
      </div>

      <main className="flex-1 px-6 sm:px-8 py-8 max-w-3xl mx-auto w-full space-y-8">
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={() => void loadAgent()}>
            Refresh agent
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void loadWallet()}>
            Refresh wallet
          </Button>
        </div>

        <div className="grid gap-8 md:grid-cols-1">
          <BalancesCard
            title="Agent wallet"
            address={agentAddress || null}
            loading={agentLoading}
            error={agentErr}
            data={agentData}
          />
          <BalancesCard
            title="Your wallet"
            address={walletAddress ?? null}
            loading={walletLoading}
            error={walletErr}
            data={walletData}
          />
        </div>
      </main>
    </div>
  );
}
