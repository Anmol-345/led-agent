"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock, PauseCircle, PlayCircle, Trash2, Plus, AlertCircle, CheckCircle2 } from "lucide-react";

import type { CheckupSubscription, PendingCheckup, CheckupCadence } from "@/lib/advisor/checkup";

export function CheckupPanel() {
  const { address, isConnected } = useAccount();

  const [subscriptions, setSubscriptions] = useState<CheckupSubscription[]>([]);
  const [pendingCheckups, setPendingCheckups] = useState<PendingCheckup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form states
  const [cadence, setCadence] = useState<CheckupCadence>("weekly");
  const [tokenAddress, setTokenAddress] = useState("");
  const [chainId, setChainId] = useState("8453");

  async function fetchCheckups() {
    if (!address) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/advisor/checkups?wallet=${address}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load checkups");

      setSubscriptions(data.subscriptions || []);
      setPendingCheckups(data.pendingCheckups || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error fetching checkup data");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (isConnected && address) {
      fetchCheckups();
    }
  }, [isConnected, address]);

  async function handleCreateSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!address) return;

    try {
      const assets = tokenAddress.trim() ? [{ chainId: Number(chainId), tokenAddress: tokenAddress.trim() as `0x${string}` }] : [];
      const res = await fetch("/api/advisor/checkups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          assets,
          cadence,
          wallet: address,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create subscription");

      setTokenAddress("");
      fetchCheckups();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error creating checkup");
    }
  }

  async function handleToggleState(sub: CheckupSubscription) {
    if (!address) return;
    const newState = sub.state === "active" ? "paused" : "active";

    try {
      const res = await fetch("/api/advisor/checkups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          subscriptionId: sub.id,
          state: newState,
          wallet: address,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update state");
      }

      fetchCheckups();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error toggling state");
    }
  }

  async function handleDelete(subId: string) {
    if (!address) return;

    try {
      const res = await fetch("/api/advisor/checkups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          subscriptionId: subId,
          wallet: address,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete subscription");
      }

      fetchCheckups();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error deleting checkup");
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <Clock className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-bold tracking-tight">Connect Wallet for Portfolio Checkups</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-2">
          Manage opt-in periodic health checkups for your selected on-chain holdings.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-6 overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Clock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Portfolio Health Checkups</h1>
            <p className="text-xs text-muted-foreground">
              Opt into periodic review prompts. Due checkups remain unbilled until you authorize fresh research.
            </p>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Create New Subscription */}
      <form onSubmit={handleCreateSubscription} className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <h3 className="text-sm font-semibold flex items-center space-x-2">
          <Plus className="h-4 w-4 text-primary" />
          <span>Opt-In to Periodic Checkup</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Cadence</label>
            <select
              value={cadence}
              onChange={e => setCadence(e.target.value as CheckupCadence)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Chain ID</label>
            <Input
              value={chainId}
              onChange={e => setChainId(e.target.value)}
              placeholder="8453 (Base)"
              className="bg-background text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Selected Token Address (Optional)</label>
            <Input
              value={tokenAddress}
              onChange={e => setTokenAddress(e.target.value)}
              placeholder="0x…"
              className="bg-background text-xs font-mono"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" size="sm">
            Create Checkup Subscription
          </Button>
        </div>
      </form>

      {/* Pending Checkups Alert */}
      {pendingCheckups.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center space-x-2">
            <AlertCircle className="h-4 w-4" />
            <span>Pending Checkups ({pendingCheckups.length})</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            The scheduler marked these checkups as due. Authorize a checkup to run fresh cited portfolio research.
          </p>

          <div className="space-y-2">
            {pendingCheckups.map(p => (
              <div key={p.id} className="p-3 bg-background rounded-lg border border-border flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold">Cadence: {p.cadence}</span>
                  <span className="text-muted-foreground ml-3">Due: {new Date(p.dueAt).toLocaleDateString()}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => window.location.href = "/"}>
                  Authorize Research
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscriptions List */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your Checkup Subscriptions</h3>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading subscriptions…</p>
        ) : subscriptions.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No active or paused checkups found.</p>
        ) : (
          <div className="space-y-2">
            {subscriptions.map(sub => (
              <div key={sub.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between shadow-sm text-xs">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-foreground capitalize">{sub.cadence} Checkup</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      sub.state === "active" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                    }`}>
                      {sub.state}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    Next Due: {new Date(sub.nextDueAt).toLocaleDateString()} • Assets: {(sub.assets || []).length} selected
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleToggleState(sub)}>
                    {sub.state === "active" ? <PauseCircle className="h-4 w-4 text-amber-500" /> : <PlayCircle className="h-4 w-4 text-emerald-500" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(sub.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
