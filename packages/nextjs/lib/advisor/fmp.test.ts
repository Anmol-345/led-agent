import assert from "node:assert/strict";
import test from "node:test";

import { advisorTestConfig } from "./credit.test-support";
import { formatAdvisorDecimal } from "./decimal";
import { FmpGateway, type FmpFactField } from "./fmp";

const config = advisorTestConfig();
const now = new Date("2026-07-26T12:00:00.000Z");
const recentStatementDate = "2026-03-31";
const staleStatementDate = "2024-01-31";

type RecordedRequest = { headers: Record<string, string>; url: string };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function bundleBody(bundle: string, statementDate: string, quoteTimestamp: number): unknown {
  switch (bundle) {
    case "quote":
      return [{ price: 34.5, symbol: "EXMP", timestamp: quoteTimestamp }];
    case "income-statement":
      return [
        {
          date: statementDate,
          eps: 4.2,
          fiscalYear: "2026",
          operatingIncome: 912_000_000,
          period: "Q1",
          symbol: "EXMP",
        },
      ];
    case "balance-sheet-statement":
      return [
        {
          date: statementDate,
          fiscalYear: "2026",
          period: "Q1",
          propertyPlantEquipmentNet: 1_400_000_000,
          symbol: "EXMP",
          totalCurrentAssets: 2_200_000_000,
          totalCurrentLiabilities: 1_100_000_000,
        },
      ];
    case "key-metrics":
      return [
        { bookValuePerShare: 18.4, date: statementDate, fiscalYear: "2026", period: "Q1", symbol: "EXMP" },
      ];
    case "enterprise-values":
      return [{ date: statementDate, enterpriseValue: 12_500_000_000, symbol: "EXMP" }];
    case "owner-earnings":
      return [
        { date: statementDate, fiscalYear: "2026", ownersEarnings: 640_000_000, period: "Q1", symbol: "EXMP" },
      ];
    default:
      return [];
  }
}

function fakeFetch(options: {
  recorded?: RecordedRequest[];
  quoteTimestamp?: number;
  statementDate?: string;
  respond?: (bundle: string) => Response | Promise<Response>;
}): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    options.recorded?.push({ headers, url });

    const bundle = new URL(url).pathname.split("/").pop() ?? "";
    if (options.respond) return options.respond(bundle);
    return jsonResponse(
      bundleBody(
        bundle,
        options.statementDate ?? recentStatementDate,
        options.quoteTimestamp ?? Math.floor(now.getTime() / 1_000) - 60,
      ),
    );
  };
}

function gateway(fetchImplementation: typeof fetch): FmpGateway {
  return new FmpGateway({ config, fetch: fetchImplementation, now: () => now });
}

test("returns cited normalized facts for the requested fundamentals", async () => {
  const recorded: RecordedRequest[] = [];
  const results = await gateway(fakeFetch({ recorded })).facts({
    fields: ["earningsPerShare", "bookValuePerShare", "price"],
    symbol: "EXMP",
  });

  const eps = results.earningsPerShare;
  assert.equal(eps.kind, "available");
  if (eps.kind !== "available") return;
  assert.equal(formatAdvisorDecimal(eps.fact.value), "4.2");
  assert.equal(eps.fact.symbol, "EXMP");
  assert.equal(eps.fact.source, "fmp");
  assert.equal(eps.fact.period, "2026-Q1");
  assert.equal(eps.fact.observedAt.toISOString(), "2026-03-31T00:00:00.000Z");
  assert.equal(eps.fact.retrievedAt.getTime(), now.getTime());

  const price = results.price;
  assert.equal(price.kind, "available");
  if (price.kind !== "available") return;
  assert.equal(formatAdvisorDecimal(price.fact.value), "34.5");
  assert.equal(price.fact.period, null, "a market price is not a filing-period metric");
  assert.notEqual(price.fact.observedAt.getTime(), eps.fact.observedAt.getTime());
});

test("fetches only the bundles the requested fields need, keyed by header", async () => {
  const recorded: RecordedRequest[] = [];
  await gateway(fakeFetch({ recorded })).facts({
    fields: ["earningsPerShare", "operatingIncome"],
    symbol: "EXMP",
  });

  assert.equal(recorded.length, 1, "both fields come from one income-statement bundle");
  const [request] = recorded;
  assert.match(request.url, /\/stable\/income-statement\?/);
  assert.equal(request.headers.apikey, "fmp-api-key");
  assert.doesNotMatch(request.url, /fmp-api-key/, "the key never travels in a URL");
});

test("an unavailable source is reported without leaking provider detail", async () => {
  for (const respond of [
    () => new Response("upstream failure at https://financialmodelingprep.com/stable?apikey=fmp-api-key", { status: 500 }),
    () => new Response("not json", { headers: { "content-type": "application/json" }, status: 200 }),
    () => {
      throw new Error("connect ECONNREFUSED 1.2.3.4:443 apikey=fmp-api-key");
    },
  ]) {
    const results = await gateway(fakeFetch({ respond })).facts({
      fields: ["earningsPerShare"],
      symbol: "EXMP",
    });
    const eps = results.earningsPerShare;
    assert.equal(eps.kind, "unavailable");
    if (eps.kind !== "unavailable") return;
    assert.equal(eps.reason, "source-unavailable");
    const serialized = JSON.stringify(eps);
    assert.doesNotMatch(serialized, /fmp-api-key/);
    assert.doesNotMatch(serialized, /financialmodelingprep/);
    assert.doesNotMatch(serialized, /ECONNREFUSED/);
  }
});

test("a stale statement or price is unavailable rather than cited", async () => {
  const staleFundamentals = await gateway(
    fakeFetch({ statementDate: staleStatementDate }),
  ).facts({ fields: ["earningsPerShare"], symbol: "EXMP" });
  assert.equal(staleFundamentals.earningsPerShare.kind, "unavailable");
  if (staleFundamentals.earningsPerShare.kind !== "unavailable") return;
  assert.equal(staleFundamentals.earningsPerShare.reason, "stale");

  const stalePrice = await gateway(
    fakeFetch({ quoteTimestamp: Math.floor(now.getTime() / 1_000) - 5_000 }),
  ).facts({ fields: ["price"], symbol: "EXMP" });
  assert.equal(stalePrice.price.kind, "unavailable");
  if (stalePrice.price.kind !== "unavailable") return;
  assert.equal(stalePrice.price.reason, "stale");
});

test("a missing, null, or unrepresentable value is never invented", async () => {
  const cases: readonly [unknown, string][] = [
    [[], "empty response"],
    [[{ date: recentStatementDate, fiscalYear: "2026", period: "Q1", symbol: "EXMP" }], "absent field"],
    [[{ date: recentStatementDate, eps: null, fiscalYear: "2026", period: "Q1", symbol: "EXMP" }], "null field"],
    [[{ date: recentStatementDate, eps: "4.2", fiscalYear: "2026", period: "Q1", symbol: "EXMP" }], "string field"],
    [[{ date: recentStatementDate, eps: Number.NaN, fiscalYear: "2026", period: "Q1", symbol: "EXMP" }], "NaN field"],
    [[{ eps: 4.2, symbol: "EXMP" }], "no observation date"],
    [[{ date: recentStatementDate, eps: 4.2, fiscalYear: "2026", period: "Q1", symbol: "OTHER" }], "wrong symbol"],
  ];

  for (const [body, label] of cases) {
    const results = await gateway(fakeFetch({ respond: () => jsonResponse(body) })).facts({
      fields: ["earningsPerShare"],
      symbol: "EXMP",
    });
    assert.equal(results.earningsPerShare.kind, "unavailable", label);
    if (results.earningsPerShare.kind !== "unavailable") return;
    assert.equal(results.earningsPerShare.reason, "missing", label);
  }
});

test("two entries for the same period are ambiguous, not silently first-wins", async () => {
  const duplicated = [
    { date: recentStatementDate, eps: 4.2, fiscalYear: "2026", period: "Q1", symbol: "EXMP" },
    { date: recentStatementDate, eps: 4.9, fiscalYear: "2026", period: "Q1", symbol: "EXMP" },
  ];
  const results = await gateway(fakeFetch({ respond: () => jsonResponse(duplicated) })).facts({
    fields: ["earningsPerShare"],
    symbol: "EXMP",
  });

  assert.equal(results.earningsPerShare.kind, "unavailable");
  if (results.earningsPerShare.kind !== "unavailable") return;
  assert.equal(results.earningsPerShare.reason, "ambiguous");
});

test("rejects an unsupported symbol before any provider request", async () => {
  const recorded: RecordedRequest[] = [];
  const subject = gateway(fakeFetch({ recorded }));

  for (const symbol of ["", "exmp/../secret", "A".repeat(24), "EX MP", "EX;MP"]) {
    await assert.rejects(
      () => subject.facts({ fields: ["earningsPerShare"], symbol }),
      /symbol/i,
      symbol,
    );
  }
  assert.deepEqual(recorded, []);
});

test("every supported field resolves through its own bundle", async () => {
  const fields: readonly FmpFactField[] = [
    "bookValuePerShare",
    "earningsPerShare",
    "enterpriseValue",
    "netFixedAssets",
    "netWorkingCapital",
    "operatingIncome",
    "ownerEarnings",
    "price",
  ];
  const results = await gateway(fakeFetch({})).facts({ fields, symbol: "EXMP" });

  for (const field of fields) {
    assert.equal(results[field].kind, "available", field);
  }
  const workingCapital = results.netWorkingCapital;
  assert.equal(workingCapital.kind, "available");
  if (workingCapital.kind !== "available") return;
  // 2_200_000_000 current assets less 1_100_000_000 current liabilities.
  assert.equal(formatAdvisorDecimal(workingCapital.fact.value), "1100000000");
});
