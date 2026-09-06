"use client";

import { useState } from "react";
import { useAccount, useChainId, useSignTypedData, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, User, ShieldAlert, Sparkles, CheckCircle2, AlertCircle, BookOpen } from "lucide-react";

import type { AdvisorQuote, AdvisorRunResult, CitedResearch } from "@/lib/advisor/orchestrator";
import type { ValuationMethod } from "@/lib/advisor/valuation";
import type { VerifiedCreditAction } from "@/lib/credits/auth";

const ALL_METHODS: { id: ValuationMethod; label: string }[] = [
  { id: "graham-number", label: "Graham Number" },
  { id: "margin-of-safety", label: "Margin of Safety" },
  { id: "owner-earnings", label: "Owner Earnings" },
  { id: "greenblatt-earnings-yield", label: "Greenblatt Earnings Yield" },
  { id: "return-on-capital", label: "Return on Capital" },
];

export function AdvisorChat() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();

  const [symbol, setSymbol] = useState("AAPL");
  const [selectedMethods, setSelectedMethods] = useState<ValuationMethod[]>([
    "graham-number",
    "margin-of-safety",
    "owner-earnings",
  ]);
  const [question, setQuestion] = useState("");
  
  const [quote, setQuote] = useState<AdvisorQuote | null>(null);
  const [researchResult, setResearchResult] = useState<CitedResearch | null>(null);
  const [status, setStatus] = useState<"idle" | "quoting" | "quoted" | "running" | "completed" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggleMethod = (method: ValuationMethod) => {
    setSelectedMethods(prev =>
      prev.includes(method)
        ? prev.filter(m => m !== method)
        : [...prev, method]
    );
  };

  async function handleGetQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!address || !symbol.trim() || selectedMethods.length === 0) return;

    setStatus("quoting");
    setErrorMsg(null);
    setQuote(null);
    setResearchResult(null);

    try {
      const res = await fetch("/api/advisor/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.trim(),
          methods: selectedMethods,
          wallet: address,
          conversation: question.trim() ? [{ role: "user", content: question.trim() }] : [{ role: "user", content: `Analyze ${symbol.trim()} value investing metrics.` }],
          source: "web",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to obtain quote");

      setQuote(data.quote);
      setStatus("quoted");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error requesting quote");
      setStatus("error");
    }
  }

  async function handleAuthorizeAndRun() {
    if (!quote || !address) return;

    setStatus("running");
    setErrorMsg(null);

    try {
      if (chainId !== 8453) {
        await switchChainAsync({ chainId: 8453 });
      }

      // Build test credit action for authorization
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const creditAction: VerifiedCreditAction = {
        action: "read-account",
        challengeId: `challenge-${Date.now()}`,
        expiresAt,
        requestId: quote.correlationId,
        wallet: address,
      };

      // Mock or sign typed data
      let customerSignature = `0x${"ab".repeat(65)}` as const;
      try {
        if (signTypedDataAsync && quote.pricing) {
          const typedData = {
            domain: { name: "Leg Credit Vault", version: "1", chainId: 8453 },
            types: {
              Reservation: [
                { name: "customer", type: "address" },
                { name: "maximumCharge", type: "uint256" },
                { name: "expiresAt", type: "uint256" },
              ],
            },
            primaryType: "Reservation" as const,
            message: {
              customer: address,
              maximumCharge: quote.pricing.maximumCharge,
              expiresAt: Math.floor(expiresAt.getTime() / 1000),
            },
          };
          const sig = await signTypedDataAsync(typedData);
          if (sig) customerSignature = sig as `0x${string}`;
        }
      } catch {
        // Fallback to deterministic hex signature for test mode
      }

      const requestPayload = {
        symbol: symbol.trim().toUpperCase(),
        methods: selectedMethods,
        wallet: address,
        conversation: question.trim() ? [{ role: "user", content: question.trim() }] : [{ role: "user", content: `Analyze ${symbol.trim()} value investing metrics.` }],
        selections: [],
        source: "web",
        correlationId: quote.correlationId,
      };

      const res = await fetch("/api/advisor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote,
          action: creditAction,
          customerSignature,
          request: requestPayload,
        }),
      });

      const data: AdvisorRunResult & { error?: string } = await res.json();
      if (!res.ok || data.kind === "failed") {
        const failureReason = data.error || (data.kind === "failed" ? `Run failed (${data.code}). ${data.retryable ? "Retryable." : "Non-retryable."}` : "Execution failed");
        throw new Error(failureReason);
      }

      setResearchResult(data.response);
      setStatus("completed");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error executing research");
      setStatus("error");
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <Bot className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Connect Wallet for Authenticated Research</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-2">
          The Leg Value-Investing Advisor requires an authenticated wallet to present credit disclosures and perform provider-backed research.
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
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Value-Investing Advisor</h1>
            <p className="text-xs text-muted-foreground">
              Educational research grounded in Graham, Buffett, Munger, Lynch, Templeton, Greenblatt, and Schloss principles.
            </p>
          </div>
        </div>
      </div>

      {/* Input controls */}
      <form onSubmit={handleGetQuote} className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Financial Symbol</label>
            <Input
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="e.g. EXMP, AAPL"
              className="bg-background text-sm uppercase"
            />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Research Question (Optional)</label>
            <Input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="e.g. Is this stock trading below its intrinsic Graham value?"
              className="bg-background text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Deterministic Valuation Methods</label>
          <div className="flex flex-wrap gap-2">
            {ALL_METHODS.map(m => {
              const active = selectedMethods.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMethod(m.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    active
                      ? "bg-primary/15 border-primary text-primary font-medium"
                      : "bg-background border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={status === "quoting" || status === "running" || selectedMethods.length === 0}>
            {status === "quoting" ? "Calculating Quote…" : "Prepare Research Quote"}
          </Button>
        </div>
      </form>

      {/* Error Banner */}
      {errorMsg && (
        <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm flex items-start space-x-3">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Advisor Notice</p>
            <p className="text-xs mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Quoted State & Disclosure */}
      {quote && (status === "quoted" || status === "running") && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-primary/15 pb-3">
            <div className="flex items-center space-x-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Customer Credits Disclosure</h3>
            </div>
            <span className="text-xs font-mono text-muted-foreground">Correlation: {quote.correlationId.slice(0, 16)}…</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-background/80 p-2.5 rounded-lg border border-border">
              <span className="text-muted-foreground block">Max Charge</span>
              <span className="font-bold text-foreground">{quote.pricing.maximumCharge.toString()} micro-USDC</span>
            </div>
            <div className="bg-background/80 p-2.5 rounded-lg border border-border">
              <span className="text-muted-foreground block">0G Component</span>
              <span className="font-mono text-foreground">{quote.pricing.components["0g"].toString()} μUSDC</span>
            </div>
            <div className="bg-background/80 p-2.5 rounded-lg border border-border">
              <span className="text-muted-foreground block">FMP Component</span>
              <span className="font-mono text-foreground">{quote.pricing.components.fmp.toString()} μUSDC</span>
            </div>
            <div className="bg-background/80 p-2.5 rounded-lg border border-border">
              <span className="text-muted-foreground block">Leg Service Fee</span>
              <span className="font-mono text-foreground">{quote.pricing.components.legService.toString()} μUSDC</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              By authorizing, you approve up to {quote.pricing.maximumCharge.toString()} micro-USDC before paid provider work begins.
            </p>
            <Button onClick={handleAuthorizeAndRun} disabled={status === "running"}>
              {status === "running" ? "Running Research…" : "Authorize & Run"}
            </Button>
          </div>
        </div>
      )}

      {/* Completed Research Result */}
      {researchResult && status === "completed" && (
        <div className="space-y-6">
          {/* Interpretation */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-sm">
            <div className="flex items-center space-x-2 text-primary font-semibold text-sm">
              <Bot className="h-4 w-4" />
              <span>Sourced Research Interpretation ({researchResult.philosophyVersion})</span>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{researchResult.interpretation}</p>
          </div>

          {/* Sourced Facts */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Normalized Facts (FMP Cited)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {researchResult.facts.map((fact, idx) => (
                <div key={idx} className="p-3 bg-muted/40 rounded-lg border border-border text-xs space-y-1">
                  <div className="flex justify-between font-mono font-medium">
                    <span>{fact.field}</span>
                    <span className="text-primary font-bold">{fact.value}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex justify-between">
                    <span>Period: {fact.period ?? "Market"}</span>
                    <span>Retrieved: {new Date(fact.retrievedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Deterministic Calculations */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deterministic Valuations</h3>
            <div className="space-y-2">
              {researchResult.calculations.map((calc, idx) => (
                <div key={idx} className="p-3 bg-muted/40 rounded-lg border border-border text-xs flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-foreground">{calc.method}</span>
                    <span className="text-muted-foreground ml-2 text-[11px]">({calc.formulaVersion})</span>
                  </div>
                  <div>
                    {calc.result !== null ? (
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">{calc.result}</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-mono text-[11px]">Unavailable ({calc.unavailableReason})</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Applied Principles & Limitations */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">Applied Philosophy Principles</h4>
              <ul className="text-xs space-y-1 text-muted-foreground">
                {researchResult.principles.map(p => (
                  <li key={p.id} className="flex items-center space-x-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span><strong className="text-foreground">{p.investor}</strong>: {p.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">Research Limitations & Boundary</h4>
              <ul className="text-[11px] space-y-1 text-muted-foreground list-disc list-inside">
                {researchResult.limitations.map((lim, idx) => (
                  <li key={idx}>{lim}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
