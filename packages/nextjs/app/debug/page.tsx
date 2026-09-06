"use client";

import { Bug } from "lucide-react";
import type { Abi, Address } from "viem";
import { Contract } from "@scaffold-ui/debug-contracts";
import deployedContracts from "@/contracts/deployedContracts";
import { NETWORKS, type NetworkDefinition } from "@/lib/networks";

function blockExplorerForChain(chainId: number): string | undefined {
  const n = (Object.values(NETWORKS) as NetworkDefinition[]).find(
    (x) => x.chainId === chainId,
  );
  return n?.blockExplorerUrl;
}

export default function DebugPage() {
  const data = deployedContracts as Record<
    string,
    Record<string, { address: string; abi: readonly unknown[] }>
  >;
  const entries = Object.entries(data).filter(
    ([, contracts]) => Object.keys(contracts).length > 0,
  );

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card/40 px-6 sm:px-8 py-5 flex items-center gap-4 shrink-0">
        <div className="h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/15 flex items-center justify-center shrink-0">
          <Bug className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">Debug contracts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Deployed addresses &amp; ABI via{" "}
            <a
              href="https://github.com/scaffold-eth/scaffold-ui"
              className="underline hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Scaffold UI
            </a>
          </p>
        </div>
      </div>

      <main className="flex-1 px-6 sm:px-8 py-8 max-w-7xl mx-auto w-full space-y-10 scaffold-ui-debug" data-theme="dark">
        {entries.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm text-center text-sm text-muted-foreground space-y-3">
            <p>No deployed contracts in <code className="bg-muted px-1 rounded">deployedContracts.ts</code> yet.</p>
            <p>Run: <code className="bg-muted px-1 rounded">just chain</code> → <code className="bg-muted px-1 rounded">just fund</code> → <code className="bg-muted px-1 rounded">just deploy</code></p>
          </div>
        ) : (
          entries.map(([chainIdStr, contracts]) => {
            const chainId = Number(chainIdStr);
            const explorer = blockExplorerForChain(chainId);
            return (
              <section key={chainIdStr} className="space-y-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded-lg bg-primary/10 px-3 py-1 text-sm font-semibold text-primary ring-1 ring-inset ring-primary/25">
                    Chain {chainIdStr}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {(Object.values(NETWORKS) as NetworkDefinition[]).find((x) => x.chainId === chainId)?.name ?? "Unknown"}
                  </span>
                </div>
                {Object.entries(contracts).map(([name, meta]) => (
                  <Contract
                    key={name}
                    contractName={name}
                    contract={{
                      address: meta.address as Address,
                      abi: meta.abi as Abi,
                    }}
                    chainId={chainId}
                    blockExplorerBaseUrl={explorer}
                  />
                ))}
              </section>
            );
          })
        )}
        <p className="text-xs text-muted-foreground border-t border-border pt-6">
          Inspired by{" "}
          <a
            href="https://github.com/scaffold-eth/scaffold-eth-2"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Scaffold-ETH 2
          </a>{" "}
          and{" "}
          <a
            href="https://github.com/scaffold-eth/scaffold-ui"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Scaffold UI
          </a>
          . The chat agent can use server tools (<code className="bg-muted px-1 rounded">list_deployed_contracts</code>,{" "}
          <code className="bg-muted px-1 rounded">contract_read</code>
          ) plus optional 1Claw Intents tools when configured.
        </p>
      </main>
    </div>
  );
}
