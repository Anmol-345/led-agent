import { querySubgraph } from "@/lib/graph-client";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const subgraphId = typeof body?.subgraphId === "string" ? body.subgraphId.trim() : "";
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const variables =
      body?.variables && typeof body.variables === "object" && !Array.isArray(body.variables)
        ? (body.variables as Record<string, unknown>)
        : undefined;
    if (!subgraphId) {
      return Response.json({ error: "subgraphId is required" }, { status: 400 });
    }
    if (!query) {
      return Response.json({ error: "query is required" }, { status: 400 });
    }
    const result = await querySubgraph(subgraphId, query, variables);
    return Response.json({ result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/graph/query]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
