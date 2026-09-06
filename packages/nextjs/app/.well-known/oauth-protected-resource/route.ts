import { NextResponse } from "next/server";

export async function GET() {
  const issuer = process.env.ADVISOR_CONNECTOR_ISSUER_ORIGIN || "https://localhost:3000";

  return NextResponse.json({
    resource: `${issuer}/api/mcp`,
    scopes_supported: ["advisor:read-account"],
  });
}
