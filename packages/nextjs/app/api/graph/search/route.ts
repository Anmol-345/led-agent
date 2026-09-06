import { searchSubgraphs } from "@/lib/graph-client";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
    const first = Number(body?.first ?? 8);
    if (!keyword) {
      return Response.json({ error: "keyword is required" }, { status: 400 });
    }
    if (!Number.isFinite(first) || first < 1 || first > 25) {
      return Response.json({ error: "first must be 1–25" }, { status: 400 });
    }
    const results = await searchSubgraphs(keyword, first);
    return Response.json({ results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/graph/search]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
