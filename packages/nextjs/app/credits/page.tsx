import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { CreditsPanelWithVault } from "@/components/CreditsPanelWithVault";

export const dynamic = "force-dynamic";

function configuredVaultAddress(): Address | null {
  const value = process.env.CREDIT_VAULT_ADDRESS?.trim();
  if (!value || !isAddress(value) || value.toLowerCase() === zeroAddress) {
    return null;
  }
  return getAddress(value);
}

export default function CreditsPage() {
  const vaultAddress = configuredVaultAddress();

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-950 p-6 text-slate-100 md:p-12">
      {vaultAddress ? (
        <CreditsPanelWithVault />
      ) : (
        <div role="alert" className="max-w-xl rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-200">
          Customer credits are not configured on this server. Set a reviewed, non-zero
          <code className="mx-1">CREDIT_VAULT_ADDRESS</code> before exposing this page.
        </div>
      )}
    </main>
  );
}
