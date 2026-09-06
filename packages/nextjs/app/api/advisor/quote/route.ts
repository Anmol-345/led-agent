import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";

import { createAdvisorCorrelationId, isAdvisorCorrelationId } from "@/lib/advisor/credit";
import type { AdvisorRequest, AdvisorRequestSource } from "@/lib/advisor/orchestrator";
import { getAdvisorOrchestrator } from "@/lib/advisor/service";
import type { ValuationMethod } from "@/lib/advisor/valuation";

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
    const {
      chainId,
      conversation = [],
      correlationId = createAdvisorCorrelationId(),
      methods = ["graham-number"],
      selections = [],
      source = "web",
      symbol,
      wallet,
    } = body as {
      chainId?: number;
      conversation?: AdvisorRequest["conversation"];
      correlationId?: string;
      methods?: ValuationMethod[];
      selections?: AdvisorRequest["selections"];
      source?: AdvisorRequestSource;
      symbol?: string;
      wallet?: Address;
    };

    if (!symbol || typeof symbol !== "string" || symbol.trim() === "") {
      return safeJsonResponse({ error: "A valid financial symbol is required." }, 400);
    }

    if (!wallet || !isAddress(wallet)) {
      return safeJsonResponse({ error: "A valid wallet address is required." }, 400);
    }

    if (!isAdvisorCorrelationId(correlationId)) {
      return safeJsonResponse({ error: "Invalid advisor correlation identifier." }, 400);
    }

    const request: AdvisorRequest = {
      ...(typeof chainId === "number" && Number.isSafeInteger(chainId) && chainId > 0
        ? { chainId }
        : {}),
      conversation: Array.isArray(conversation) ? conversation : [],
      correlationId,
      methods: Array.isArray(methods) && methods.length > 0 ? methods : ["graham-number"],
      selections: Array.isArray(selections) ? selections : [],
      source: source === "connector" || source === "checkup" ? source : "web",
      symbol: symbol.trim().toUpperCase(),
      wallet,
    };

    const orchestrator = getAdvisorOrchestrator();
    const quote = await orchestrator.quote(request);

    return safeJsonResponse({ quote });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate advisor quote.";
    return safeJsonResponse({ error: message }, 400);
  }
}
