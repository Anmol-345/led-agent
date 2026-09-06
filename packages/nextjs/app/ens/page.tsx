"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, Check, Copy, ExternalLink } from "lucide-react";
import { isAddress } from "viem";
import { mainnet } from "wagmi/chains";
import { useAccount, useEnsName } from "wagmi";
import { Button } from "@/components/ui/button";
import Link from "next/link";

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export default function EnsPage() {
  const agentRaw = (process.env.NEXT_PUBLIC_AGENT_ADDRESS || "").trim();
  const agentAddress = useMemo(() => {
    const t = agentRaw;
    return t && isAddress(t) ? (t as `0x${string}`) : undefined;
  }, [agentRaw]);

  const { address: walletAddress } = useAccount();

  const { data: agentEnsName, isLoading: agentEnsLoading } = useEnsName({
    address: agentAddress,
    chainId: mainnet.id,
    query: { enabled: Boolean(agentAddress) },
  });

  const { data: walletPrimaryEns, isLoading: walletEnsLoading } = useEnsName({
    address: walletAddress,
    chainId: mainnet.id,
    query: { enabled: Boolean(walletAddress) },
  });

  const ensAppBase = "https://app.ens.domains";
  const parentEnsUrl = walletPrimaryEns
    ? `${ensAppBase}/${encodeURIComponent(walletPrimaryEns)}`
    : null;
  const docsEnsSubnames = "https://docs.ens.domains/web/subdomains";

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card/40 px-6 sm:px-8 py-5 flex items-center gap-4 shrink-0">
        <div className="h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/15 flex items-center justify-center shrink-0">
          <BadgeCheck className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">ENS for your agent</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Names and subnames for{" "}
            <span className="font-medium text-foreground">leg-agent</span>
          </p>
        </div>
      </div>

      <main className="flex-1 px-6 sm:px-8 py-8 max-w-3xl mx-auto w-full space-y-8">
        <p className="text-sm text-muted-foreground leading-relaxed">
          <strong className="text-foreground">.eth</strong> registration and most subname flows
          run on <strong className="text-foreground">Ethereum mainnet</strong>, even if your agent
          uses another chain for dApps. Resolution below uses mainnet (chain ID {mainnet.id}).
        </p>

        <section className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Agent wallet</h2>
          {!agentAddress ? (
            <p className="text-sm text-muted-foreground">
              No valid agent address in env. Set{" "}
              <code className="rounded bg-muted px-1">
                NEXT_PUBLIC_AGENT_ADDRESS
              </code>{" "}
              to match your agent&apos;s on-chain wallet.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 font-mono text-xs break-all bg-muted/40 rounded-lg px-3 py-2.5">
                <span className="flex-1">{agentAddress}</span>
                <CopyBtn text={agentAddress} />
              </div>
              <p className="text-xs text-muted-foreground">
                Reverse record (mainnet):{" "}
                {agentEnsLoading ? (
                  <span className="animate-pulse">Loading…</span>
                ) : agentEnsName ? (
                  <span className="font-mono text-foreground">{agentEnsName}</span>
                ) : (
                  <span>none set</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="secondary" size="sm" asChild>
                  <a href={ensAppBase} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Open ENS app
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/identity">Agent identity (ERC-8004)</Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Register a new <code className="rounded bg-muted px-1">.eth</code> in the ENS app,
                then set the name&apos;s address record (or a subname) to this agent wallet. You
                can also transfer a name you already own to the agent address if you prefer.
              </p>
            </>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Your connected wallet</h2>
          {!walletAddress ? (
            <p className="text-sm text-muted-foreground">
              Connect a wallet to see its primary ENS name and get a shortcut to create a{" "}
              <strong className="text-foreground">subname</strong> for your agent (e.g.{" "}
              <code className="rounded bg-muted px-1">myagent.yourname.eth</code>
              ).
            </p>
          ) : (
            <>
              <p className="text-xs font-mono break-all text-muted-foreground">{walletAddress}</p>
              <p className="text-xs text-muted-foreground">
                Primary name (mainnet reverse record):{" "}
                {walletEnsLoading ? (
                  <span className="animate-pulse">Loading…</span>
                ) : walletPrimaryEns ? (
                  <span className="font-mono text-foreground">{walletPrimaryEns}</span>
                ) : (
                  <span>none — set one in the ENS app if you own a name</span>
                )}
              </p>
              {walletPrimaryEns ? (
                <div className="space-y-2 pt-1">
                  <p className="text-sm text-muted-foreground">
                    If you <strong className="text-foreground">control</strong>{" "}
                    <span className="font-mono">{walletPrimaryEns}</span>, open it in the ENS app
                    to add a subname and point it at your agent address above (copy/paste). Wrapped
                    names support subnames in the manager UI; see{" "}
                    <a
                      href={docsEnsSubnames}
                      className="underline hover:text-foreground"
                      target="_blank"
                      rel="noreferrer"
                    >
                      ENS subname docs
                    </a>
                    .
                  </p>
                  {parentEnsUrl ? (
                    <Button variant="default" size="sm" asChild>
                      <a href={parentEnsUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Manage {walletPrimaryEns} in ENS
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Without a primary name, you can still register or buy a{" "}
                  <code className="rounded bg-muted px-1">.eth</code> and create subnames from that
                  name&apos;s page in the ENS app.
                </p>
              )}
            </>
          )}
        </section>

        <p className="text-xs text-muted-foreground border-t border-border pt-8 leading-relaxed">
          In-app, one-click subname registration would require integrating ENS contracts (e.g.
          NameWrapper) and several transactions; this page keeps the flow simple and uses the
          official ENS app where gas and steps are handled for you.
        </p>
      </main>
    </div>
  );
}
