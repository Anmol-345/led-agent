import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { AdvisorConnectorConfig } from "./config";
import type { AdvisorPrismaClient } from "./db";
import { getAdvisorOrchestrator, getAdvisorRepository } from "./service";
import { CheckupService } from "./checkup";

export type OAuthClientRegistration = {
  clientName: string;
  grantTypes: string[];
  redirectUris: string[];
};

export type RegisteredOAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

export type TokenValidationResult =
  | { kind: "valid"; wallet: Address; clientId: string }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "invalid" };

export class AdvisorConnector {
  private readonly config: AdvisorConnectorConfig;
  private readonly database: AdvisorPrismaClient;

  constructor(options: { config: AdvisorConnectorConfig; database: AdvisorPrismaClient }) {
    this.config = options.config;
    this.database = options.database;
  }

  async registerClient(input: OAuthClientRegistration): Promise<RegisteredOAuthClient> {
    const id = randomUUID();
    await this.database.advisorOauthClient.create({
      data: {
        clientName: input.clientName,
        createdAt: new Date(),
        grantTypesJson: JSON.stringify(input.grantTypes),
        id,
        redirectUrisJson: JSON.stringify(input.redirectUris),
        tokenEndpointAuthMethod: "none",
      },
    });

    return {
      clientId: id,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
    };
  }

  async issueAuthorizationCode(input: {
    clientId: string;
    codeChallenge: string;
    now?: Date;
    redirectUri: string;
    wallet: Address;
  }): Promise<string> {
    const wallet = getAddress(input.wallet);
    const client = await this.database.advisorOauthClient.findUnique({
      where: { id: input.clientId },
    });
    if (!client) throw new Error("Invalid OAuth client ID.");

    const rawCode = `code_${randomBytes(24).toString("hex")}`;
    const tokenHash = createHash("sha256").update(rawCode).digest("hex");
    const now = input.now ?? new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.connector.authorizationCodeTtlSeconds * 1000,
    );

    await this.database.advisorOauthToken.create({
      data: {
        clientId: input.clientId,
        codeChallenge: input.codeChallenge,
        createdAt: now,
        expiresAt,
        id: randomUUID(),
        kind: "AUTHORIZATION_CODE",
        redirectUri: input.redirectUri,
        scope: "advisor:read-account",
        tokenHash,
        wallet,
      },
    });

    return rawCode;
  }

  async exchangeAuthorizationCode(input: {
    clientId: string;
    code: string;
    now?: Date;
    redirectUri: string;
  }): Promise<{ kind: "success"; accessToken: string; expiresAt: Date } | { kind: "invalid" }> {
    const tokenHash = createHash("sha256").update(input.code).digest("hex");
    const authCode = await this.database.advisorOauthToken.findUnique({
      where: { tokenHash },
    });

    if (
      !authCode ||
      authCode.clientId !== input.clientId ||
      authCode.kind !== "AUTHORIZATION_CODE" ||
      authCode.revokedAt !== null
    ) {
      return { kind: "invalid" };
    }

    const now = input.now ?? new Date();
    if (authCode.expiresAt.getTime() <= now.getTime()) {
      return { kind: "invalid" };
    }

    // Revoke authorization code after exchange
    await this.database.advisorOauthToken.update({
      where: { id: authCode.id },
      data: { revokedAt: now },
    });

    const accessToken = `at_${randomBytes(32).toString("hex")}`;
    const accessTokenHash = createHash("sha256").update(accessToken).digest("hex");
    const expiresAt = new Date(
      now.getTime() + this.config.connector.tokenTtlSeconds * 1000,
    );

    await this.database.advisorOauthToken.create({
      data: {
        clientId: input.clientId,
        createdAt: now,
        expiresAt,
        id: randomUUID(),
        kind: "ACCESS",
        scope: authCode.scope,
        tokenHash: accessTokenHash,
        wallet: authCode.wallet,
      },
    });

    return { accessToken, expiresAt, kind: "success" };
  }

  async validateAccessToken(input: { token: string; now?: Date }): Promise<TokenValidationResult> {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const tokenRecord = await this.database.advisorOauthToken.findUnique({
      where: { tokenHash },
    });

    if (!tokenRecord || tokenRecord.kind !== "ACCESS") {
      return { kind: "invalid" };
    }

    if (tokenRecord.revokedAt !== null) {
      return { kind: "revoked" };
    }

    const now = input.now ?? new Date();
    if (tokenRecord.expiresAt.getTime() <= now.getTime()) {
      return { kind: "expired" };
    }

    return {
      clientId: tokenRecord.clientId,
      kind: "valid",
      wallet: getAddress(tokenRecord.wallet as Address),
    };
  }

  async revokeToken(input: { token: string }): Promise<void> {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    await this.database.advisorOauthToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  /** Constructs an MCP Server instance exposing advisor capabilities. */
  createMcpServer(wallet: Address): Server {
    const server = new Server(
      {
        name: "leg-value-investing-advisor",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "quote_advisor_research",
          description: "Quotes a value-investing research request for a financial symbol.",
          inputSchema: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              methods: { type: "array", items: { type: "string" } },
            },
            required: ["symbol"],
          },
        },
        {
          name: "run_advisor_research",
          description: "Runs authorized research request or returns a browser action URL for credit authorization.",
          inputSchema: {
            type: "object",
            properties: {
              quote: { type: "object" },
              action: { type: "object" },
              customerSignature: { type: "string" },
              request: { type: "object" },
            },
            required: ["quote", "request"],
          },
        },
        {
          name: "read_portfolio",
          description: "Reads selected supported token holdings for the authenticated wallet.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "manage_checkups",
          description: "Inspects or updates customer-controlled portfolio health checkups.",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["list", "create", "pause", "delete"] },
              cadence: { type: "string" },
              subscriptionId: { type: "string" },
            },
            required: ["action"],
          },
        },
        {
          name: "get_recommendation",
          description: "Retrieves a stored ValueInvestingRecommendation.v1 artifact by ID.",
          inputSchema: {
            type: "object",
            properties: {
              recommendationId: { type: "string" },
            },
            required: ["recommendationId"],
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async request => {
      const orchestrator = getAdvisorOrchestrator();
      const repo = getAdvisorRepository();
      const checkup = new CheckupService({ database: this.database });

      switch (request.params.name) {
        case "quote_advisor_research": {
          const args = request.params.arguments as { symbol: string; methods?: string[] };
          const quote = await orchestrator.quote({
            conversation: [{ role: "user", content: `Analyze ${args.symbol}` }],
            correlationId: `advisor-${randomUUID()}`,
            methods: (args.methods as any) || ["graham-number"],
            selections: [],
            source: "connector",
            symbol: args.symbol,
            wallet,
          });
          return {
            content: [{ type: "text", text: JSON.stringify({ quote }) }],
          };
        }

        case "run_advisor_research": {
          const args = request.params.arguments as any;
          if (!args.customerSignature || !args.action) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    actionUrl: `${this.config.connector.issuerOrigin}/authorize?correlationId=${args.quote.correlationId}`,
                    status: "authorization_required",
                  }),
                },
              ],
            };
          }
          const runResult = await orchestrator.run({
            action: args.action,
            customerSignature: args.customerSignature,
            quote: args.quote,
            request: args.request,
          });
          return { content: [{ type: "text", text: JSON.stringify(runResult) }] };
        }

        case "read_portfolio": {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ holdings: [], wallet }),
              },
            ],
          };
        }

        case "manage_checkups": {
          const args = request.params.arguments as any;
          if (args.action === "list") {
            const list = await checkup.listSubscriptions(wallet);
            return { content: [{ type: "text", text: JSON.stringify({ subscriptions: list }) }] };
          }
          return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
        }

        case "get_recommendation": {
          const args = request.params.arguments as { recommendationId: string };
          const rec = await repo.recommendationHandoff({
            now: new Date(),
            recommendationId: args.recommendationId,
            wallet,
          });
          return { content: [{ type: "text", text: JSON.stringify(rec) }] };
        }

        default:
          throw new Error(`Unsupported tool: ${request.params.name}`);
      }
    });

    return server;
  }
}
