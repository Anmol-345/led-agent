"use client";

import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { CreditsPanel } from "@/components/CreditsPanel";

export function CreditsPanelWithVault() {
  const [vaultAddress, setVaultAddress] = useState<Address | null>(null);
  const [usdcAddress, setUsdcAddress] = useState<Address | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/credits/config")
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!active) return;
        if (
          typeof data === "object" &&
          data !== null &&
          "vaultAddress" in data &&
          typeof data.vaultAddress === "string" &&
          isAddress(data.vaultAddress)
        ) {
          setVaultAddress(getAddress(data.vaultAddress));
          if (
            "usdcAddress" in data &&
            typeof data.usdcAddress === "string" &&
            isAddress(data.usdcAddress)
          ) {
            setUsdcAddress(getAddress(data.usdcAddress));
          } else {
            setLoadError(true);
          }
        } else {
          setLoadError(true);
        }
      })
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, []);

  if (loadError) {
    return (
      <p className="py-4 text-center text-xs text-zinc-500 font-mono">
        Credits not configured on this server. Check <code className="text-zinc-400">CREDIT_VAULT_ADDRESS</code>.
      </p>
    );
  }
  if (!vaultAddress || !usdcAddress) {
    return <p className="py-4 text-center text-xs text-zinc-500 font-mono">Loading credit vault…</p>;
  }

  return <CreditsPanel vaultAddress={vaultAddress} usdcAddress={usdcAddress} />;
}
