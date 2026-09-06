import { SDK } from "agent0-sdk";
import { getActiveNetwork } from "@/lib/networks";

function normalizeOwnerAddresses(body: unknown): string[] | null {
  const o = body as Record<string, unknown>;
  const arr = o?.addresses;
  const single = o?.address;
  const candidates: string[] = [];
  if (Array.isArray(arr)) {
    for (const x of arr) {
      if (typeof x === "string" && /^0x[a-fA-F0-9]{40}$/i.test(x)) candidates.push(x);
    }
  }
  if (typeof single === "string" && /^0x[a-fA-F0-9]{40}$/i.test(single)) {
    candidates.push(single);
  }
  if (candidates.length === 0) return null;
  const seen = new Set<string>();
  const owners: string[] = [];
  for (const a of candidates) {
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    owners.push(a);
  }
  return owners;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chainId = body?.chainId;
    const owners = normalizeOwnerAddresses(body);
    if (!owners) {
      return Response.json(
        { error: "Provide address (0x…) or addresses: […] (ERC-8004 owner wallets to search)" },
        { status: 400 },
      );
    }
    const cid = Number(chainId);
    if (!Number.isFinite(cid)) {
      return Response.json({ error: "Invalid chainId" }, { status: 400 });
    }
    const net = getActiveNetwork();
    if (cid !== net.chainId) {
      return Response.json(
        { error: "chainId does not match active network in scaffold.config" },
        { status: 400 },
      );
    }
    const sdk = new SDK({
      chainId: net.chainId,
      rpcUrl: net.rpcUrl,
    });
    const agents = await sdk.searchAgents({
      owners,
      chains: [cid],
    });
    return Response.json({ agents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/agent0/lookup]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
