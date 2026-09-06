import { NextResponse } from "next/server";
import { getAdvisorConfig } from "@/lib/advisor/service";

export async function GET() {
  const config = getAdvisorConfig();
  const issuer = process.env.ADVISOR_CONNECTOR_ISSUER_ORIGIN || "https://localhost:3000";

  return NextResponse.json({
    authorization_endpoint: `${issuer}/oauth/authorize`,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code"],
    issuer,
    response_types_supported: ["code"],
    revocation_endpoint: `${issuer}/api/advisor/oauth/revoke`,
    token_endpoint: `${issuer}/api/advisor/oauth/token`,
  });
}
