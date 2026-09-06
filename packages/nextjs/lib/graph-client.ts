/** The Graph Network registry subgraph (Arbitrum) — used for keyword search. */
const GRAPH_NETWORK_SUBGRAPH_ID = "DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp";

/**
 * x402 signing key — reuses Ampersend signing key when available,
 * falls back to AGENT_PRIVATE_KEY (fund with USDC on Base).
 */
async function resolveX402Key(): Promise<string> {
  const fromX402 = (process.env.X402_PRIVATE_KEY || "").trim();
  if (fromX402) return fromX402;

  const fromAmpersend = (process.env.AMPERSEND_SIGNING_KEY || "").trim();
  if (fromAmpersend) return fromAmpersend;

  const agentKey = (process.env.AGENT_PRIVATE_KEY || "").trim();
  if (agentKey) return agentKey;

  throw new Error(
    "No x402 signing key found. Set AGENT_PRIVATE_KEY (default), X402_PRIVATE_KEY, or AMPERSEND_SIGNING_KEY in .env",
  );
}


async function resolveGraphApiKey(): Promise<string | null> {
  return (process.env.GRAPH_API_KEY || "").trim() || null;
}

/** base (mainnet) or base-sepolia (testnet) — matches The Graph x402 docs (X402_CHAIN). */
function resolveX402Chain(): "base" | "base-sepolia" {
  const chain = (process.env.X402_CHAIN || "").trim().toLowerCase();
  if (chain === "base-sepolia" || chain === "base_sepolia") return "base-sepolia";
  if (chain === "base") return "base";
  const id = Number(process.env.X402_CHAIN_ID || "8453");
  return id === 84532 ? "base-sepolia" : "base";
}

function graphGatewayBase(): string {
  return resolveX402Chain() === "base-sepolia"
    ? "https://testnet.gateway.thegraph.com"
    : "https://gateway.thegraph.com";
}

async function queryViaApiKey(
  subgraphId: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown | null> {
  const apiKey = await resolveGraphApiKey();
  if (!apiKey) return null;

  const gateway = graphGatewayBase();
  const res = await fetch(`${gateway}/api/${apiKey}/subgraphs/id/${subgraphId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
  if (!res.ok) {
    throw new Error(`Graph API key query failed: ${res.status} ${JSON.stringify(json)}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json;
}

async function queryViaX402(
  subgraphId: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const { createGraphQuery } = await import("@graphprotocol/client-x402");
  const gateway = graphGatewayBase();
  const endpoint = `${gateway}/api/x402/subgraphs/id/${subgraphId}`;
  const privateKey = await resolveX402Key();
  const gql = createGraphQuery({
    endpoint,
    privateKey,
    chain: resolveX402Chain(),
  });
  const result = await gql(query, variables);
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  return result;
}

/** Run GraphQL against a subgraph — API key first, then x402 per-query USDC. */
async function runGraphQL(
  subgraphId: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  let apiKeyError: Error | null = null;
  try {
    const viaKey = await queryViaApiKey(subgraphId, query, variables);
    if (viaKey !== null) return viaKey;
  } catch (err) {
    apiKeyError = err instanceof Error ? err : new Error(String(err));
    if (!(await resolveGraphApiKey())) throw err;
  }

  try {
    return await queryViaX402(subgraphId, query, variables);
  } catch (x402Err) {
    const x402Msg = x402Err instanceof Error ? x402Err.message : String(x402Err);
    console.error("[graph-client] x402 payment failed:", x402Msg);
    if (apiKeyError) console.error("[graph-client] API key also failed:", apiKeyError.message);
    throw new Error(
      `Subgraph query failed. x402: ${x402Msg}` +
        (apiKeyError ? ` | API key: ${apiKeyError.message}` : ""),
    );
  }
}

/** Query a subgraph on The Graph Network (x402 or GRAPH_API_KEY). */
export async function querySubgraph(
  subgraphId: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  return runGraphQL(subgraphId, query, variables);
}

/** Search subgraphs by keyword via the Graph Network registry subgraph. */
export async function searchSubgraphs(
  keyword: string,
  first = 8,
): Promise<{ id: string; displayName: string; description: string }[]> {
  const escaped = keyword.replace(/"/g, '\\"');
  const words = keyword.trim().split(/\s+/);
  const broadWord = words[0].replace(/"/g, '\\"');
  const needsBroadSearch = words.length > 1;

  const query = `{
    subgraphs(
      first: ${Math.min(first, 5)},
      where: { metadata_: { displayName_contains_nocase: "${escaped}" } },
      orderBy: currentSignalledTokens,
      orderDirection: desc
    ) {
      id
      metadata { displayName description }
    }
    ${needsBroadSearch ? `broader: subgraphs(
      first: ${first},
      where: { metadata_: { displayName_contains_nocase: "${broadWord}" } },
      orderBy: currentSignalledTokens,
      orderDirection: desc
    ) {
      id
      metadata { displayName description }
    }` : ""}
  }`;

  const json = (await runGraphQL(GRAPH_NETWORK_SUBGRAPH_ID, query)) as {
    data?: {
      subgraphs?: {
        id: string;
        metadata?: { displayName?: string; description?: string };
      }[];
      broader?: {
        id: string;
        metadata?: { displayName?: string; description?: string };
      }[];
    };
  };

  const seen = new Set<string>();
  const results: { id: string; displayName: string; description: string }[] = [];
  const deprioritized: typeof results = [];
  for (const s of [...(json.data?.subgraphs ?? []), ...(json.data?.broader ?? [])]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const entry = { id: s.id, displayName: s.metadata?.displayName || s.id, description: s.metadata?.description || "" };
    if (/substream/i.test(entry.displayName)) {
      deprioritized.push(entry);
    } else {
      results.push(entry);
    }
  }
  return [...results, ...deprioritized].slice(0, first);
}
