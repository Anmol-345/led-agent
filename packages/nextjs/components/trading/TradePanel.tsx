"use client";

import { useEffect, useState } from "react";
import { useAccount, useSendTransaction, useSignTypedData, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { ArrowLeftRight, AlertCircle, CheckCircle2, Clock, ShieldCheck, RefreshCw, ExternalLink } from "lucide-react";
import type { EligibleAsset, OrderStatus, TradeOrderRecord, TradeReceiptRecord, ValidatedTradeQuote } from "@/lib/trading/types";

function formatDisplayAmount(val: string, decimals = 18): string {
  if (!val || val === "0") return "0";
  if (val.includes(".")) {
    const n = parseFloat(val);
    return isNaN(n) ? val : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  try {
    const formatted = formatUnits(BigInt(val), decimals);
    const n = parseFloat(formatted);
    return isNaN(n) ? formatted : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  } catch {
    return val;
  }
}

export function TradePanel() {
  const { address, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();

  const [assets, setAssets] = useState<readonly EligibleAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<EligibleAsset | null>(null);
  const [amount, setAmount] = useState("100.0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeQuote, setActiveQuote] = useState<ValidatedTradeQuote | null>(null);
  const [activeOrder, setActiveOrder] = useState<TradeOrderRecord | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<TradeReceiptRecord | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  // Load eligible assets on mount
  useEffect(() => {
    fetch("/api/trades/assets")
      .then(res => res.json())
      .then(data => {
        if (data.assets) {
          setAssets(data.assets);
          if (data.assets.length > 0) {
            setSelectedAsset(data.assets[0]);
          }
        }
      })
      .catch(() => setError("Failed to load eligible assets."));
  }, []);

  // Expiry countdown timer
  useEffect(() => {
    if (!activeQuote) {
      setTimeRemaining(null);
      return;
    }

    const expiresTime = new Date(activeQuote.expiresAt).getTime();
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresTime - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeQuote]);

  const handleRequestQuote = async () => {
    if (!address || !selectedAsset) return;
    setLoading(true);
    setError(null);
    setActiveReceipt(null);

    // Mock read-account session and recommendation for demonstration
    const mockSessionAction = {
      challengeId: "ch_demo",
      wallet: address,
      action: "read-account" as const,
      requestId: "req_demo",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };

    const mockRecommendation = {
      id: "rec_demo",
      version: "ValueInvestingRecommendation.v1" as const,
      wallet: address,
      assetAddress: selectedAsset.token,
      assetChainId: selectedAsset.chainId,
      assetSymbol: selectedAsset.symbol,
      calculations: [],
      disclaimer: "Educational research only.",
      evidence: [],
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      generatedAt: new Date().toISOString(),
      philosophyVersion: "1.0",
      risks: "Market risk",
      runId: "run_demo",
      stance: "undervalued" as const,
      thesis: "Strong earnings yield",
    };

    try {
      const res = await fetch("/api/trades/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionAction: mockSessionAction,
          recommendation: mockRecommendation,
          assetReference: selectedAsset.assetReference,
          chainId: selectedAsset.chainId,
          amount,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Failed to fetch quote.");
        setActiveQuote(null);
        setActiveOrder(null);
      } else {
        setActiveQuote(data.quote);
        setActiveOrder(data.order);
      }
    } catch {
      setError("Network error while requesting quote.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!activeQuote || !activeOrder || !address) return;
    setLoading(true);
    setError(null);

    try {
      if (chain?.id !== activeQuote.chainId) {
        await switchChain({ chainId: activeQuote.chainId });
      }

      if (activeQuote.kind === "classic") {
        // No fabricated hash on failure. This used to invent a random 64-hex string when
        // gas estimation failed and record it as a real submission, producing an order that
        // referenced a transaction which never existed.
        const txHash = await sendTransactionAsync({
          to: activeQuote.transaction.to,
          data: activeQuote.transaction.data,
          value: BigInt(activeQuote.transaction.value || "0"),
        });

        // Submit acknowledgement
        const subRes = await fetch(
          `/api/trades/orders/${activeOrder.id}/submitted`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionAction: {
                challengeId: "ch_demo",
                wallet: address,
                action: "read-account",
                requestId: "req_demo",
                expiresAt: new Date(Date.now() + 600000).toISOString(),
              },
              transactionHash: txHash,
            }),
          }
        );
        const subData = await subRes.json();
        if (subData.order) {
          setActiveOrder(subData.order);
        }
      }
    } catch (err: any) {
      setError(err.message || "Wallet action rejected or failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-4 sm:p-6">
      {/* Disclaimer Banner */}
      <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 flex gap-3 text-xs text-amber-600 dark:text-amber-400">
        <ShieldCheck className="h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="font-semibold">Recommendation-Bound Trading Notice</p>
          <p className="mt-0.5">
            Educational research only. This recommendation establishes no issuer eligibility, route, price guarantee, or permission to trade.
            Trades use Uniswap's direct 10 bps API integrator fee. Customer Credits are never charged for trades.
          </p>
        </div>
      </div>

      {/* Main Trade Form */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">Trade Tokenized Stock</h2>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
            10 bps Direct Fee
          </span>
        </div>

        {/* Asset Selection */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Select Eligible Asset</label>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            value={selectedAsset?.assetReference || ""}
            onChange={e => {
              const asset = assets.find(a => a.assetReference === e.target.value);
              if (asset) setSelectedAsset(asset);
            }}
          >
            {assets.map(asset => (
              <option key={asset.assetReference} value={asset.assetReference}>
                {asset.symbol} ({asset.issuerId.toUpperCase()}) — Chain {asset.chainId}
              </option>
            ))}
          </select>
        </div>

        {/* Input Amount */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Input Amount (Base-10)</label>
          <input
            type="text"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="100.0"
          />
        </div>

        {/* Request Quote Button */}
        <button
          onClick={handleRequestQuote}
          disabled={loading || !address || !selectedAsset}
          className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
        >
          {loading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowLeftRight className="h-4 w-4" />
          )}
          Get Validated Quote
        </button>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Quote Review Card */}
      {activeQuote && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {activeQuote.kind === "classic" ? "Classic Uniswap Route" : "UniswapX Order"}
            </span>
            {timeRemaining !== null && (
              <div className="flex items-center gap-1.5 text-xs text-amber-500 font-mono">
                <Clock className="h-3.5 w-3.5" />
                <span>{timeRemaining}s remaining</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Minimum Output</span>
              <p className="text-sm font-semibold font-mono mt-0.5">
                {formatDisplayAmount(
                  activeQuote.kind === "classic"
                    ? activeQuote.minimumOutput
                    : activeQuote.outputMinimum,
                  selectedAsset?.decimals || 18
                )}{" "}
                {selectedAsset?.symbol}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Integrator Fee (10 bps)</span>
              <p className="text-sm font-semibold font-mono mt-0.5">
                {formatDisplayAmount(
                  activeQuote.fee.amount,
                  selectedAsset?.decimals || 18
                )}{" "}
                {selectedAsset?.symbol}
              </p>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Direct Fee Recipient</span>
              <p className="text-xs font-mono truncate text-muted-foreground mt-0.5">
                {activeQuote.fee.recipient}
              </p>
            </div>
          </div>

          {timeRemaining === 0 ? (
            <div className="p-3 bg-destructive/10 rounded-lg text-xs text-destructive text-center">
              Quote expired. Please request a fresh quote.
            </div>
          ) : (
            <button
              onClick={handleConfirmAction}
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 text-white py-3 text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Confirm Wallet Execution
            </button>
          )}
        </div>
      )}

      {/* Order & Receipt View */}
      {activeOrder && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Order Status</h3>
            <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground font-mono uppercase">
              {activeOrder.status}
            </span>
          </div>

          {activeOrder.transactionHash && (
            <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
              <span>Tx: {activeOrder.transactionHash.slice(0, 16)}...</span>
              <ExternalLink className="h-3 w-3" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
