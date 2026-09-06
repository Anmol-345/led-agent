"use client";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, usePublicClient } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi-config";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** RainbowKit's transaction store requires a viem public client on first paint. */
function RainbowKitGate({ children }: { children: ReactNode }) {
  const publicClient = usePublicClient();
  if (!publicClient) return <>{children}</>;
  return (
    <RainbowKitProvider theme={darkTheme()} modalSize="compact">
      {children}
    </RainbowKitProvider>
  );
}

export function Web3Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitGate>{children}</RainbowKitGate>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
