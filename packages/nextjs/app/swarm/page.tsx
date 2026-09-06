"use client";

import { useCallback, useMemo, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Users, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentSwarm } from "@/lib/agent-swarm";

export default function SwarmPage() {
  const { roster } = useAgentSwarm();
  const [pk, setPk] = useState<string | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const genLocal = useCallback(() => {
    const hex = generatePrivateKey();
    const acct = privateKeyToAccount(hex);
    setPk(hex);
    setAddr(acct.address);
    setCopied(false);
  }, []);

  const snippet = useMemo(() => {
    if (!pk || !addr) return "";
    return JSON.stringify([{ id: "new-local", privateKey: pk }], null, 0);
  }, [pk, addr]);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card/40 px-6 sm:px-8 py-5 flex items-center gap-4 shrink-0">
        <div className="h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/15 flex items-center justify-center shrink-0">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">Swarm</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            On-chain agent wallets — add more with{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">just swarm agents=N</code>
          </p>
        </div>
      </div>

      <main className="flex-1 px-6 sm:px-8 py-8 max-w-3xl mx-auto w-full space-y-8">
        <section className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Configured agents</h2>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents.json entries yet.</p>
          ) : (
            <ul className="space-y-3 text-sm font-mono text-xs">
              {roster.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
                  <span className="text-foreground">{a.id}</span>
                  <span className="text-muted-foreground break-all">{a.address}</span>
                  {a.preset ? (
                    <span className="text-muted-foreground">preset: {a.preset}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Generate locally (browser)</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Creates a key in memory only. To persist, merge the private key into encrypted secrets and
            update <code className="rounded bg-muted px-1">public/agents.json</code> — use{" "}
            <code className="rounded bg-muted px-1">just swarm agents=1</code> for a guided flow, or
            append the JSON below to <code className="rounded bg-muted px-1">SWARM_AGENT_KEYS_JSON</code>.
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={genLocal}>
            Generate wallet
          </Button>
          {addr && pk ? (
            <div className="space-y-2 text-xs">
              <p className="font-mono break-all text-muted-foreground">{addr}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted p-2 text-[10px] leading-snug">
                  {snippet}
                </code>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
                  title="Copy JSON snippet"
                  onClick={() => {
                    void navigator.clipboard.writeText(snippet).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
