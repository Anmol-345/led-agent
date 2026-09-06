import { NextRequest } from "next/server";

import {
  handleChallengeRoute,
  readBoundedJson,
} from "@/lib/credits/api";
import { loadCreditAccountConfig } from "@/lib/credits/config";
import { getCreditPrismaClient } from "@/lib/credits/db";

export const runtime = "nodejs";

function clientKey(request: NextRequest): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "single-host"
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await readBoundedJson(request);
    const config = loadCreditAccountConfig();
    return handleChallengeRoute(
      body ?? {},
      {
        prisma: getCreditPrismaClient(config),
        appOrigin: config.appOrigin,
        baseRpcUrl: config.baseRpcUrl,
      },
      {
        clientKey: clientKey(request),
        origin: request.headers.get("origin") ?? "",
      },
    );
  } catch {
    return Response.json(
      { error: "Credit authentication is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
