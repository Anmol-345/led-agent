import { NextResponse } from "next/server";
import type { Hex } from "viem";

import type { VerifiedCreditAction } from "@/lib/credits/auth";
import type { AdvisorQuote, AdvisorRequest } from "@/lib/advisor/orchestrator";
import { getAdvisorOrchestrator } from "@/lib/advisor/service";

function safeJsonResponse(data: unknown, status = 200) {
  const json = JSON.stringify(data, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return new NextResponse(json, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, customerSignature, quote, request } = body as {
      action?: VerifiedCreditAction;
      customerSignature?: Hex;
      quote?: AdvisorQuote;
      request?: AdvisorRequest;
    };

    if (!quote || !quote.correlationId || !quote.wallet) {
      return safeJsonResponse({ error: "A valid advisor quote is required." }, 400);
    }

    if (!action || !action.wallet || !action.requestId) {
      return safeJsonResponse({ error: "A valid credit action is required." }, 400);
    }

    // "0x" (or omitted) means "charge against the standing session grant". The vault
    // enforces the cap and expiry on-chain, so rejecting it here would make grants
    // unusable from the advisor and keep prompting the wallet on every run.
    if (
      customerSignature !== undefined &&
      (typeof customerSignature !== "string" || !customerSignature.startsWith("0x"))
    ) {
      return safeJsonResponse({ error: "A customer signature is required for execution." }, 400);
    }

    if (!request || !request.symbol || !request.wallet) {
      return safeJsonResponse({ error: "A matching advisor request is required." }, 400);
    }

    // Ensure dates and BigInt fields in quote and action are parsed back into native types
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
    };

    const parsedAction: VerifiedCreditAction = {
      ...action,
      expiresAt: new Date(action.expiresAt),
    };

    const parsedRequest: AdvisorRequest = {
      ...request,
      symbol: request.symbol.trim().toUpperCase(),
    };

    const orchestrator = getAdvisorOrchestrator();
    const result = await orchestrator.run({
      action: parsedAction,
      customerSignature,
      quote: parsedQuote,
      request: parsedRequest,
    });

    return safeJsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to execute advisor research run.";
    return safeJsonResponse({ error: message }, 500);
  }
}
