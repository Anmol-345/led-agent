"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { AgentSwarmProvider } from "@/lib/agent-swarm";

const Web3Providers = dynamic(
  () => import("@/lib/web3-providers").then((m) => m.Web3Providers),
  { ssr: false },
);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Web3Providers>
      <AgentSwarmProvider>{children}</AgentSwarmProvider>
    </Web3Providers>
  );
}
