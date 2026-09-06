import crypto from "node:crypto";

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import {
  createSiweMessage,
  parseSiweMessage as parseViemSiweMessage,
} from "viem/siwe";

import type { CreditPrismaClient } from "./db";
import { CreditAction } from "./generated/prisma/client";
import { VAULT_CHAIN, VAULT_CHAIN_ID } from "./vault";

// Vault chain follows the deployment target; the SIWE chainId must match it.
const BASE_CHAIN_ID = VAULT_CHAIN_ID;
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const SESSION_LIFETIME_MS = 15 * 60 * 1000;
const AUTH_RECORD_RETENTION_MS = SESSION_LIFETIME_MS;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 4_096;
const requestIdPattern =
  /^(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[0-9A-Fa-f]{2})+$/;
const actionStatementPrefix = "Leg Credit Action: ";

export type CreditActionType = "read-account";

export type VerifiedCreditAction = {
  challengeId: string;
  wallet: Address;
  action: "read-account";
  requestId: string;
  expiresAt: Date;
};

export type CreditMessageVerifier = {
  verifyMessage(parameters: {
    address: Address;
    message: string;
    signature: Hex;
  }): Promise<boolean>;
};

type ParsedSiweMessage = {
  domain: string;
  wallet: Address;
  action: "read-account";
  uri: string;
  version: "1";
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  requestId: string;
};

type CreditAuthOrigin = {
  domain: string;
  uri: string;
};

function invalidChallenge(): Error {
  return new Error("Invalid credit challenge.");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function isCreditRequestId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    requestIdPattern.test(value)
  );
}

function creditAuthOrigin(appOrigin: string): CreditAuthOrigin {
  const origin = new URL(appOrigin);
  const loopback =
    origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (
    origin.origin !== appOrigin ||
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback))
  ) {
    throw new Error("Credit app origin must be a canonical URL origin.");
  }
  return { domain: origin.host, uri: origin.origin };
}

export function createCreditChallengeMessage(input: {
  action: CreditActionType;
  appOrigin: string;
  expiresAt: Date;
  issuedAt: Date;
  nonce: string;
  requestId: string;
  wallet: Address;
}): string {
  if (
    !isAddress(input.wallet) ||
    input.action !== "read-account" ||
    !isCreditRequestId(input.requestId) ||
    !/^[0-9a-f]{32}$/.test(input.nonce) ||
    !Number.isFinite(input.issuedAt.getTime()) ||
    !Number.isFinite(input.expiresAt.getTime()) ||
    input.expiresAt.getTime() <= input.issuedAt.getTime()
  ) {
    throw new Error("Invalid challenge input.");
  }

  const origin = creditAuthOrigin(input.appOrigin);
  const message = createSiweMessage({
    address: getAddress(input.wallet),
    chainId: BASE_CHAIN_ID,
    domain: origin.domain,
    expirationTime: input.expiresAt,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
    requestId: input.requestId,
    statement: `${actionStatementPrefix}read-account`,
    uri: origin.uri,
    version: "1",
  });
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error("Invalid challenge input.");
  }
  return message;
}

function parseSiweMessage(
  message: string,
  expectedOrigin: CreditAuthOrigin,
): ParsedSiweMessage {
  if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
    throw invalidChallenge();
  }

  const parsed = parseViemSiweMessage(message);
  const statement = parsed.statement ?? "";
  if (
    statement !== `${actionStatementPrefix}read-account` ||
    parsed.domain !== expectedOrigin.domain ||
    parsed.uri !== expectedOrigin.uri ||
    parsed.version !== "1" ||
    parsed.chainId !== BASE_CHAIN_ID ||
    parsed.scheme !== undefined ||
    parsed.notBefore !== undefined ||
    parsed.resources !== undefined ||
    parsed.nonce === undefined ||
    !/^[0-9a-f]{32}$/.test(parsed.nonce) ||
    parsed.issuedAt === undefined ||
    !Number.isFinite(parsed.issuedAt.getTime()) ||
    parsed.expirationTime === undefined ||
    !Number.isFinite(parsed.expirationTime.getTime()) ||
    parsed.requestId === undefined ||
    !isCreditRequestId(parsed.requestId) ||
    parsed.address === undefined ||
    !isAddress(parsed.address)
  ) {
    throw invalidChallenge();
  }

  return {
    domain: expectedOrigin.domain,
    wallet: getAddress(parsed.address),
    action: "read-account",
    uri: expectedOrigin.uri,
    version: "1",
    chainId: BASE_CHAIN_ID,
    nonce: parsed.nonce,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expirationTime,
    requestId: parsed.requestId,
  };
}

export class CreditAuthService {
  private readonly publicClient: CreditMessageVerifier;
  private readonly appOrigin: CreditAuthOrigin;

  constructor(
    private readonly prisma: CreditPrismaClient,
    options: {
      appOrigin: string;
      publicClient?: CreditMessageVerifier;
      rpcUrl?: string;
    },
  ) {
    this.appOrigin = creditAuthOrigin(options.appOrigin);
    const baseClient = createPublicClient({
      chain: VAULT_CHAIN,
      transport: http(
        options.rpcUrl ?? process.env.CREDIT_BASE_RPC_URL ?? VAULT_CHAIN.rpcUrls.default.http[0],
      ),
    });
    this.publicClient = options.publicClient ?? {
      verifyMessage(parameters) {
        return baseClient.verifyMessage(parameters);
      },
    };
  }

  private async pruneExpiredRecords(now: Date): Promise<void> {
    await this.prisma.$transaction(async transaction => {
      await transaction.creditSession.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      await transaction.creditChallenge.deleteMany({
        where: {
          authorization: null,
          createdAt: {
            lte: new Date(now.getTime() - AUTH_RECORD_RETENTION_MS),
          },
          expiresAt: { lte: now },
          session: null,
        },
      });
    });
  }

  async createChallenge(input: {
    wallet: Address;
    action: CreditActionType;
    requestId: string;
  }): Promise<{
    challengeId: string;
    message: string;
    issuedAt: Date;
    expiresAt: Date;
  }> {
    if (
      !isAddress(input.wallet) ||
      input.action !== "read-account" ||
      !isCreditRequestId(input.requestId)
    ) {
      throw new Error("Invalid challenge input.");
    }

    const wallet = getAddress(input.wallet);
    const nonce = crypto.randomBytes(16).toString("hex");
    const challengeId = crypto.randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_LIFETIME_MS);
    const message = createCreditChallengeMessage({
      action: input.action,
      appOrigin: this.appOrigin.uri,
      expiresAt,
      issuedAt,
      nonce,
      requestId: input.requestId,
      wallet,
    });

    await this.pruneExpiredRecords(issuedAt);
    await this.prisma.creditChallenge.create({
      data: {
        id: challengeId,
        nonce,
        messageHash: sha256(message),
        wallet: wallet.toLowerCase(),
        action: CreditAction.READ_ACCOUNT,
        requestId: input.requestId,
        expiresAt,
        createdAt: issuedAt,
      },
    });

    return { challengeId, message, issuedAt, expiresAt };
  }

  async verifyChallenge(input: {
    challengeId?: string;
    message: string;
    signature: Hex;
  }): Promise<VerifiedCreditAction> {
    const parsed = parseSiweMessage(input.message, this.appOrigin);
    const now = new Date();
    const challenge = await this.prisma.creditChallenge.findUnique({
      where: { nonce: parsed.nonce },
    });

    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt.getTime() <= now.getTime() ||
      challenge.messageHash !== sha256(input.message) ||
      challenge.wallet !== parsed.wallet.toLowerCase() ||
      challenge.action !== CreditAction.READ_ACCOUNT ||
      challenge.requestId !== parsed.requestId ||
      challenge.createdAt.getTime() !== parsed.issuedAt.getTime() ||
      challenge.expiresAt.getTime() !== parsed.expiresAt.getTime() ||
      (input.challengeId !== undefined && challenge.id !== input.challengeId)
    ) {
      throw invalidChallenge();
    }

    let validSignature = false;
    try {
      validSignature = await this.publicClient.verifyMessage({
        address: parsed.wallet,
        message: input.message,
        signature: input.signature,
      });
    } catch {
      validSignature = false;
    }
    if (!validSignature) {
      throw invalidChallenge();
    }

    const consumed = await this.prisma.creditChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw invalidChallenge();
    }

    return {
      challengeId: challenge.id,
      wallet: parsed.wallet,
      action: "read-account",
      requestId: challenge.requestId,
      expiresAt: challenge.expiresAt,
    };
  }

  async createSession(input: {
    challengeId: string;
    message: string;
    signature: Hex;
  }): Promise<{
    sessionToken: string;
    wallet: Address;
    action: "read-account";
    requestId: string;
    expiresAt: Date;
  }> {
    const verified = await this.verifyChallenge({
      challengeId: input.challengeId,
      message: input.message,
      signature: input.signature,
    });
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const sessionExpiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

    await this.prisma.creditSession.create({
      data: {
        id: crypto.randomUUID(),
        secretHash: sha256(sessionToken),
        challengeId: verified.challengeId,
        wallet: verified.wallet.toLowerCase(),
        action: CreditAction.READ_ACCOUNT,
        requestId: verified.requestId,
        expiresAt: sessionExpiresAt,
      },
    });

    return {
      sessionToken,
      wallet: verified.wallet,
      action: "read-account",
      requestId: verified.requestId,
      expiresAt: sessionExpiresAt,
    };
  }

  async verifySession(
    sessionToken: string,
  ): Promise<{ wallet: Address; requestId: string }> {
    if (!/^[0-9a-f]{64}$/.test(sessionToken)) {
      throw new Error("Invalid session.");
    }

    const session = await this.prisma.creditSession.findUnique({
      where: { secretHash: sha256(sessionToken) },
    });
    if (
      !session ||
      session.action !== CreditAction.READ_ACCOUNT ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      !isAddress(session.wallet)
    ) {
      throw new Error("Invalid session.");
    }

    return {
      wallet: getAddress(session.wallet),
      requestId: session.requestId,
    };
  }

  async revokeSession(sessionToken: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(sessionToken)) {
      return;
    }

    await this.prisma.creditSession.updateMany({
      where: {
        secretHash: sha256(sessionToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
  }
}
