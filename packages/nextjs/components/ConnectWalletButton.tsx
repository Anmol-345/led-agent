"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { usePublicClient } from "wagmi";
import { cn } from "@/lib/utils";

export function ConnectWalletButton() {
  const publicClient = usePublicClient();
  if (!publicClient) {
    return (
      <div
        className="h-9 w-28 shrink-0 animate-pulse rounded-md bg-muted"
        aria-hidden
      />
    );
  }

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openConnectModal,
        mounted,
        authenticationStatus,
      }) => {
        const readyToShow = mounted;
        const connected =
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        if (!readyToShow) {
          return (
            <div
              className="h-9 w-28 shrink-0 animate-pulse rounded-md bg-muted"
              aria-hidden
            />
          );
        }

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className={cn(
                "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-input",
                "bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              Connect wallet
            </button>
          );
        }

        return (
          <button
            type="button"
            onClick={openAccountModal}
            className={cn(
              "inline-flex h-9 max-w-[10rem] shrink-0 items-center truncate rounded-md border border-input",
              "bg-background px-2 font-mono text-xs hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
            title={account.address}
          >
            {account.displayName ??
              (account.address.length > 10
                ? account.address.slice(0, 6) + "…" + account.address.slice(-4)
                : account.address)}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
