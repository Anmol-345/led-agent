import { isAddress, isHex, type Address } from "viem";

import {
  CreditAuthService,
  isCreditRequestId,
  type CreditMessageVerifier,
} from "./auth";
import type { CreditPrismaClient } from "./db";

export const CREDIT_SESSION_COOKIE = "__Host-leg_credit_session";
const MAX_BODY_BYTES = 8_192;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 4_096;
const MAX_SIGNATURE_LENGTH = 4_098;
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
export const GLOBAL_CREDIT_RATE_LIMIT_COUNT = 100;
export const MAX_CREDIT_RATE_LIMIT_BUCKETS = 10_000;
const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };
const noStoreHeaders = { "Cache-Control": "no-store" };

type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonObject
  | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

type AuthDependencies = {
  prisma: CreditPrismaClient;
  appOrigin: string;
  baseRpcUrl: string;
  publicClient?: CreditMessageVerifier;
};

type AccountState = {
  available: bigint;
  providerEligible: bigint;
  reserved: bigint;
  pendingDeposits: bigint;
};

type AccountDependencies = AuthDependencies & {
  getAccount(wallet: Address): Promise<AccountState>;
  /** Vault chain and settlement token, from the resolved credit config. Reporting Base
   *  unconditionally made the panel reject every non-Base account response. */
  vaultChainId: number;
  usdcAddress: string;
};

type RequestContext = {
  clientKey: string;
  origin: string;
  now?: number;
};

// ponytail: process-local limiter; replace with shared edge storage only when credits run on multiple hosts.
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const globalRateLimits = new Map<string, { count: number; resetAt: number }>();

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(body: JsonObject, field: string): string | undefined {
  const value = body[field];
  return typeof value === "string" ? value : undefined;
}

function hasOnlyFields(body: JsonObject, fields: readonly string[]): boolean {
  return Object.keys(body).every(field => fields.includes(field));
}

function createAuthService(deps: AuthDependencies): CreditAuthService {
  return new CreditAuthService(deps.prisma, {
    appOrigin: deps.appOrigin,
    publicClient: deps.publicClient,
    rpcUrl: deps.baseRpcUrl,
  });
}

function withinRateLimit(bucket: string, clientKey: string, now: number): boolean {
  const key = `${bucket}:${clientKey.slice(0, 128)}`;
  if (rateLimits.size >= MAX_CREDIT_RATE_LIMIT_BUCKETS && !rateLimits.has(key)) {
    for (const [candidate, value] of rateLimits) {
      if (value.resetAt <= now) {
        rateLimits.delete(candidate);
      }
    }
    if (rateLimits.size >= MAX_CREDIT_RATE_LIMIT_BUCKETS) {
      return false;
    }
  }
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else if (current.count >= RATE_LIMIT_COUNT) {
    return false;
  } else {
    current.count += 1;
  }

  const global = globalRateLimits.get(bucket);
  if (!global || global.resetAt <= now) {
    globalRateLimits.set(bucket, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }
  if (global.count >= GLOBAL_CREDIT_RATE_LIMIT_COUNT) {
    return false;
  }
  global.count += 1;
  return true;
}

function sessionCookie(token: string, maxAge: number): string {
  return [
    `${CREDIT_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function accountResponse(body: JsonObject, status: number): Response {
  return Response.json(body, { status, headers: privateNoStoreHeaders });
}

function customerSafeReason(reason: string | null): string | null {
  const safe = reason?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 256);
  return safe ? safe : null;
}

export function resetCreditRateLimitsForTests(): void {
  rateLimits.clear();
  globalRateLimits.clear();
}

export async function readBoundedJson(request: Request): Promise<JsonObject | null> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
    return null;
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return null;
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  if (bytes === 0) {
    return null;
  }

  try {
    const value: JsonValue = JSON.parse(text);
    return isJsonObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function formatMicroUsdcToDecimal(microUsdc: bigint): string {
  const isNegative = microUsdc < 0n;
  const absolute = isNegative ? -microUsdc : microUsdc;
  const integerPart = (absolute / 1_000_000n).toString();
  const fractionalPart = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${isNegative ? "-" : ""}${integerPart}.${fractionalPart}`;
}

export async function handleChallengeRoute(
  body: JsonObject,
  deps: AuthDependencies,
  context: RequestContext,
): Promise<Response> {
  if (context.origin !== deps.appOrigin) {
    return Response.json(
      { error: "Request denied." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  if (
    !withinRateLimit(
      "challenge",
      context.clientKey,
      context.now ?? Date.now(),
    )
  ) {
    return Response.json(
      { error: "Too many requests." },
      { status: 429, headers: noStoreHeaders },
    );
  }

  const wallet = stringField(body, "wallet");
  const action = stringField(body, "action");
  const requestId = stringField(body, "requestId");
  if (
    wallet === undefined ||
    !isAddress(wallet) ||
    action !== "read-account" ||
    requestId === undefined ||
    requestId.length > MAX_REQUEST_ID_LENGTH ||
    !isCreditRequestId(requestId) ||
    !hasOnlyFields(body, ["wallet", "action", "requestId"])
  ) {
    return Response.json(
      { error: "Invalid challenge request." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  try {
    const result = await createAuthService(deps).createChallenge({
      wallet,
      action,
      requestId,
    });
    return Response.json(result, { status: 200, headers: noStoreHeaders });
  } catch {
    return Response.json(
      { error: "Credit authentication is temporarily unavailable." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}

export async function handleSessionRoute(
  body: JsonObject,
  deps: AuthDependencies,
  context: RequestContext,
): Promise<Response> {
  if (context.origin !== deps.appOrigin) {
    return Response.json(
      { error: "Request denied." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  if (
    !withinRateLimit(
      "session",
      context.clientKey,
      context.now ?? Date.now(),
    )
  ) {
    return Response.json(
      { error: "Too many requests." },
      { status: 429, headers: noStoreHeaders },
    );
  }

  const challengeId = stringField(body, "challengeId");
  const message = stringField(body, "message");
  const signature = stringField(body, "signature");
  if (
    challengeId === undefined ||
    !/^[0-9a-f-]{36}$/i.test(challengeId) ||
    message === undefined ||
    message.length === 0 ||
    message.length > MAX_MESSAGE_LENGTH ||
    signature === undefined ||
    signature.length > MAX_SIGNATURE_LENGTH ||
    !isHex(signature) ||
    !hasOnlyFields(body, ["challengeId", "message", "signature"])
  ) {
    return Response.json(
      { error: "Authentication failed." },
      { status: 401, headers: noStoreHeaders },
    );
  }

  try {
    const session = await createAuthService(deps).createSession({
      challengeId,
      message,
      signature,
    });
    const maxAge = Math.max(
      0,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1_000),
    );
    return Response.json(
      {
        wallet: session.wallet.toLowerCase(),
        action: session.action,
        requestId: session.requestId,
        expiresAt: session.expiresAt,
      },
      {
        status: 200,
        headers: {
          ...noStoreHeaders,
          "Set-Cookie": sessionCookie(session.sessionToken, maxAge),
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Authentication failed." },
      { status: 401, headers: noStoreHeaders },
    );
  }
}

export async function handleLogoutRoute(
  input: { sessionToken?: string },
  deps: AuthDependencies,
): Promise<Response> {
  if (input.sessionToken !== undefined) {
    await createAuthService(deps).revokeSession(input.sessionToken);
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...noStoreHeaders,
      "Set-Cookie": sessionCookie("", 0),
    },
  });
}

export async function handleAccountRoute(
  input: { sessionToken?: string },
  deps: AccountDependencies,
): Promise<Response> {
  if (input.sessionToken === undefined) {
    return accountResponse({ error: "Unauthorized." }, 401);
  }

  let wallet: Address;
  try {
    ({ wallet } = await createAuthService(deps).verifySession(input.sessionToken));
  } catch {
    return accountResponse({ error: "Unauthorized." }, 401);
  }

  try {
    const account = await deps.getAccount(wallet);
    const [authorizations, deposits] = await Promise.all([
      deps.prisma.creditAuthorization.findMany({
        where: { wallet: wallet.toLowerCase() },
        include: {
          usageRecord: {
            include: {
              corrections: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 20,
              },
            },
          },
        },
        orderBy: [{ expiresAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
      deps.prisma.creditChainEvent.findMany({
        where: {
          wallet: wallet.toLowerCase(),
          eventName: "Deposited",
        },
        orderBy: [
          { observedAt: "desc" },
          { transactionHash: "desc" },
          { logIndex: "desc" },
        ],
        take: 50,
      }),
    ]);
    const usageHistory = authorizations.map(authorization => ({
      authorizationId: authorization.id,
      correlationId: authorization.correlationId,
      serviceType: authorization.serviceType,
      status: authorization.status,
      rejectionReason: customerSafeReason(authorization.rejectionReason),
      maximumChargeUsdc: formatMicroUsdcToDecimal(
        authorization.maximumChargeMicroUsdc,
      ),
      customerChargeUsdc: formatMicroUsdcToDecimal(
        authorization.usageRecord?.customerChargeMicroUsdc ?? 0n,
      ),
      components: authorization.usageRecord
        ? {
            zeroG: formatMicroUsdcToDecimal(
              authorization.usageRecord.zeroGMicroUsdc,
            ),
            fmp: formatMicroUsdcToDecimal(authorization.usageRecord.fmpMicroUsdc),
            legService: formatMicroUsdcToDecimal(
              authorization.usageRecord.legServiceMicroUsdc,
            ),
          }
        : null,
      corrections:
        authorization.usageRecord?.corrections.map(correction => ({
          id: correction.id,
          reason:
            customerSafeReason(correction.reason) ??
            "Correction recorded without customer-facing details.",
          totalUsdc: formatMicroUsdcToDecimal(correction.totalMicroUsdc),
          components: {
            zeroG: formatMicroUsdcToDecimal(correction.zeroGMicroUsdc),
            fmp: formatMicroUsdcToDecimal(correction.fmpMicroUsdc),
            legService: formatMicroUsdcToDecimal(correction.legServiceMicroUsdc),
          },
          createdAt: correction.createdAt.toISOString(),
        })) ?? [],
      createdAt: authorization.usageRecord?.createdAt.toISOString() ?? null,
      expiresAt: authorization.expiresAt.toISOString(),
    }));
    const depositActivity = deposits.map(deposit => ({
      transactionHash: deposit.transactionHash,
      amountUsdc: formatMicroUsdcToDecimal(deposit.amountMicroUsdc),
      finality: deposit.finality,
      reason: customerSafeReason(deposit.reason),
      observedAt: deposit.observedAt.toISOString(),
    }));

    return accountResponse(
      {
        wallet: wallet.toLowerCase(),
        // The vault chain and settlement token follow the deployment target. Reporting
        // Base unconditionally made the panel reject every testnet account response.
        baseChainId: deps.vaultChainId,
        baseUsdcAddress: deps.usdcAddress,
        availableUsdc: formatMicroUsdcToDecimal(account.available),
        providerEligibleUsdc: formatMicroUsdcToDecimal(account.providerEligible),
        reservedUsdc: formatMicroUsdcToDecimal(account.reserved),
        pendingDepositsUsdc: formatMicroUsdcToDecimal(account.pendingDeposits),
        depositActivity,
        usageHistory,
      },
      200,
    );
  } catch {
    return accountResponse(
      { error: "Credit account is temporarily unavailable." },
      503,
    );
  }
}
