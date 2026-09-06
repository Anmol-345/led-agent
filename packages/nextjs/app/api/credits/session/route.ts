import { NextRequest } from "next/server";

import {
  CREDIT_SESSION_COOKIE,
  handleLogoutRoute,
  handleSessionRoute,
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
    return handleSessionRoute(
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

export async function DELETE(request: NextRequest): Promise<Response> {
  try {
    const config = loadCreditAccountConfig();
    if (request.headers.get("origin") !== config.appOrigin) {
      return Response.json(
        { error: "Request denied." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    return handleLogoutRoute(
      { sessionToken: request.cookies.get(CREDIT_SESSION_COOKIE)?.value },
      {
        prisma: getCreditPrismaClient(config),
        appOrigin: config.appOrigin,
        baseRpcUrl: config.baseRpcUrl,
      },
    );
  } catch {
    return Response.json(
      { error: "Credit authentication is temporarily unavailable." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": `${CREDIT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
        },
      },
    );
  }
}
