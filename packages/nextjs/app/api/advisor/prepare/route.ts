import { NextResponse } from "next/server";
import { isAddress, getAddress, type Address } from "viem";

import type { VerifiedCreditAction } from "@/lib/credits/auth";
import type { AdvisorQuote } from "@/lib/advisor/orchestrator";
import { getAdvisorOrchestrator } from "@/lib/advisor/service";
import { loadCreditAccountConfig } from "@/lib/credits/config";
import { BaseVaultClient } from "@/lib/credits/vault";

function safeJsonResponse(data: unknown, status = 200) {
  const json = JSON.stringify(data, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return new NextResponse(json, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createCreditVaultClient(): BaseVaultClient {
  const config = loadCreditAccountConfig();
  return new BaseVaultClient({
    vaultAddress: config.vaultAddress,
    rpcUrl: config.baseRpcUrl,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { quote, wallet } = body as {
      quote?: AdvisorQuote;
      wallet?: Address;
    };

    if (!quote || !quote.correlationId || !quote.wallet) {
      return safeJsonResponse({ error: "A valid advisor quote is required." }, 400);
    }

    if (!wallet || !isAddress(wallet)) {
      return safeJsonResponse({ error: "A valid wallet address is required." }, 400);
    }

    const normWallet = getAddress(wallet);
    if (getAddress(quote.wallet) !== normWallet) {
      return safeJsonResponse({ error: "The quote wallet does not match the connected wallet." }, 400);
    }

    const parsedQuote: AdvisorQuote = {
      ...quote,
      expiresAt: new Date(quote.expiresAt),
      pricing: {
        ...quote.pricing,
        maximumCharge: BigInt(quote.pricing.maximumCharge),
        components: {
          "0g": BigInt(quote.pricing.components["0g"]),
          fmp: BigInt(quote.pricing.components.fmp),
          legService: BigInt(quote.pricing.components.legService),
        },
      },
      wallet: normWallet,
    };

    const prepared = await getAdvisorOrchestrator().prepareAuthorization({ quote: parsedQuote });

    const action: VerifiedCreditAction = {
      challengeId: prepared.authorizationId,
      wallet: normWallet,
      action: "read-account",
      requestId: quote.correlationId,
      expiresAt: prepared.expiresAt,
    };

    // Tell the client whether a standing session grant already covers this charge. If it
    // does, the run needs no wallet signature at all — the whole point of the grant.
    let sessionGrantCovers = false;
    try {
      const remaining = await createCreditVaultClient().remainingSessionAllowance(normWallet);
      sessionGrantCovers = remaining >= parsedQuote.pricing.maximumCharge;
    } catch {
      // Unknown allowance: fall back to asking for a signature rather than assuming.
      sessionGrantCovers = false;
    }

    return safeJsonResponse({
      action,
      sessionGrantCovers,
      ...prepared,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare credit authorization.";
    return safeJsonResponse({ error: message }, 500);
  }
}
