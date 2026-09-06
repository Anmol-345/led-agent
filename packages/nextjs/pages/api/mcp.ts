import type { NextApiRequest, NextApiResponse } from "next";
import { StreamableHttpAdapter } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { AdvisorConnector } from "@/lib/advisor/connector";
import { getAdvisorConfig } from "@/lib/advisor/service";
import { getAdvisorPrismaClient } from "@/lib/advisor/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!token) {
      res.status(401).json({ error: "Unauthorized: Bearer token is required." });
      return;
    }

    const config = getAdvisorConfig();
    const db = getAdvisorPrismaClient(config);
    const connector = new AdvisorConnector({ config: config as any, database: db });

    const validation = await connector.validateAccessToken({ token });
    if (validation.kind !== "valid") {
      res.status(401).json({ error: `Unauthorized: Token is ${validation.kind}.` });
      return;
    }

    const server = connector.createMcpServer(validation.wallet);
    const transport = new StreamableHttpAdapter({ req, res });
    await server.connect(transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP server transport error.";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
}
