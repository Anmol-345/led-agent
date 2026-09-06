import { getAddress, isAddress } from "viem";
import { vaultSettlement } from "@/lib/credits/settlement";

export const runtime = "nodejs";

/**
 * Public, non-secret wiring the credits panel needs to talk to the right chain: which
 * vault, on which chain, denominated in which token. The panel used to assume Base and
 * native USDC, which silently broke every non-Base deployment.
 */
export async function GET(): Promise<Response> {
  const value = process.env.CREDIT_VAULT_ADDRESS?.trim();
  if (!value || !isAddress(value)) {
    return Response.json({ error: "Credit vault is not configured." }, { status: 503 });
  }

  let settlement;
  try {
    settlement = vaultSettlement();
  } catch {
    return Response.json(
      { error: "Credit settlement token is not configured." },
      { status: 503 },
    );
  }

  return Response.json(
    {
      chainId: settlement.chainId,
      usdcAddress: settlement.usdcAddress,
      vaultAddress: getAddress(value),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
