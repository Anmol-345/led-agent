import type { AdvisorResearchConfig } from "./config";
import { parseAdvisorNumber } from "./decimal";

/**
 * The private FMP gateway.
 *
 * It fetches only the bundle a requested method needs, passes Leg's server-side key by header so it
 * never reaches a URL or access log, and returns normalized cited facts. A raw provider payload,
 * provider path, credential, or error detail never leaves this module: an unusable source becomes a
 * named unavailable reason instead.
 */

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export type FmpFactField =
  | "bookValuePerShare"
  | "earningsPerShare"
  | "enterpriseValue"
  | "netFixedAssets"
  | "netWorkingCapital"
  | "operatingIncome"
  | "ownerEarnings"
  | "price";

export type FmpUnavailableReason = "ambiguous" | "missing" | "source-unavailable" | "stale";

export type FmpFact = {
  field: FmpFactField;
  observedAt: Date;
  /** Statement period label such as `2026-Q1`; null for a market observation. */
  period: string | null;
  retrievedAt: Date;
  source: "fmp";
  symbol: string;
  value: bigint;
};

export type FmpFactResult =
  | { fact: FmpFact; kind: "available" }
  | { field: FmpFactField; kind: "unavailable"; reason: FmpUnavailableReason; symbol: string };

export type FmpFactSet = Readonly<Record<FmpFactField, FmpFactResult>>;

type FmpBundle =
  | "balance-sheet-statement"
  | "enterprise-values"
  | "income-statement"
  | "key-metrics"
  | "owner-earnings"
  | "quote"
  | "ratios";

type FmpEntry = Readonly<Record<string, unknown>>;

/**
 * Binds an advisor field to a provider bundle and its JSON member(s).
 */
const fieldSources: Readonly<
  Record<FmpFactField, { bundle: FmpBundle; read: (entry: FmpEntry) => number | null }>
> = {
  bookValuePerShare: {
    bundle: "key-metrics",
    read: entry =>
      numberMember(entry, "bookValuePerShare") ??
      numberMember(entry, "tangibleBookValuePerShare") ??
      numberMember(entry, "bookValuePerShareTTM"),
  },
  earningsPerShare: {
    bundle: "income-statement",
    read: entry =>
      numberMember(entry, "eps") ??
      numberMember(entry, "epsDiluted") ??
      numberMember(entry, "epsdiluted"),
  },
  enterpriseValue: {
    bundle: "enterprise-values",
    read: entry =>
      numberMember(entry, "enterpriseValue") ??
      numberMember(entry, "enterpriseValueTTM"),
  },
  netFixedAssets: {
    bundle: "balance-sheet-statement",
    read: entry =>
      numberMember(entry, "propertyPlantEquipmentNet") ??
      numberMember(entry, "netPropertyPlantEquipment"),
  },
  netWorkingCapital: {
    bundle: "balance-sheet-statement",
    read: entry => {
      const currentAssets = numberMember(entry, "totalCurrentAssets");
      const currentLiabilities = numberMember(entry, "totalCurrentLiabilities");
      if (currentAssets === null || currentLiabilities === null) return null;
      return currentAssets - currentLiabilities;
    },
  },
  operatingIncome: {
    bundle: "income-statement",
    read: entry =>
      numberMember(entry, "operatingIncome") ??
      numberMember(entry, "operatingIncomeTTM"),
  },
  ownerEarnings: {
    bundle: "owner-earnings",
    read: entry =>
      numberMember(entry, "ownersEarnings") ??
      numberMember(entry, "ownerEarnings"),
  },
  price: {
    bundle: "quote",
    read: entry =>
      numberMember(entry, "price") ??
      numberMember(entry, "previousClose"),
  },
};

function numberMember(entry: FmpEntry, member: string): number | null {
  const value = entry[member];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringMember(entry: FmpEntry, member: string): string | null {
  const value = entry[member];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isEntry(value: unknown): value is FmpEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observation(bundle: FmpBundle, entry: FmpEntry): { observedAt: Date; period: string | null } | null {
  if (bundle === "quote") {
    const timestamp = numberMember(entry, "timestamp");
    if (timestamp === null) return null;
    const observedAt = new Date(timestamp * 1_000);
    return Number.isNaN(observedAt.getTime()) ? null : { observedAt, period: null };
  }

  const date = stringMember(entry, "date");
  if (date === null) return null;
  const observedAt = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(observedAt.getTime())) return null;

  const fiscalYear = stringMember(entry, "fiscalYear");
  const periodLabel = stringMember(entry, "period");
  const period =
    fiscalYear !== null && periodLabel !== null ? `${fiscalYear}-${periodLabel}` : date;
  return { observedAt, period };
}

export type FmpGatewayOptions = {
  config: AdvisorResearchConfig;
  fetch?: typeof fetch;
  now?: () => Date;
};

export class FmpGateway {
  private readonly config: AdvisorResearchConfig;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;

  constructor(options: FmpGatewayOptions) {
    this.config = options.config;
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async facts(input: {
    fields: readonly FmpFactField[];
    symbol: string;
  }): Promise<FmpFactSet> {
    const symbol = this.checkedSymbol(input.symbol);
    const retrievedAt = this.now();
    const bundles = new Set(input.fields.map(field => fieldSources[field].bundle));
    if (input.fields.includes("bookValuePerShare")) {
      bundles.add("ratios");
    }

    const loaded = new Map<FmpBundle, readonly FmpEntry[] | null>();

    await Promise.all(
      [...bundles].map(async bundle => {
        loaded.set(bundle, await this.loadBundle(bundle, symbol));
      }),
    );

    const requested = new Set(input.fields);
    const resolve = (field: FmpFactField): FmpFactResult => {
      if (!requested.has(field)) {
        return { field, kind: "unavailable", reason: "missing", symbol };
      }
      const primaryRes = this.resolveField(
        field,
        symbol,
        loaded.get(fieldSources[field].bundle) ?? null,
        retrievedAt,
      );
      if (primaryRes.kind === "available") return primaryRes;

      if (field === "bookValuePerShare") {
        const fallbackRes = this.resolveField(
          field,
          symbol,
          loaded.get("ratios") ?? null,
          retrievedAt,
        );
        if (fallbackRes.kind === "available") return fallbackRes;
      }

      return primaryRes;
    };

    return {
      bookValuePerShare: resolve("bookValuePerShare"),
      earningsPerShare: resolve("earningsPerShare"),
      enterpriseValue: resolve("enterpriseValue"),
      netFixedAssets: resolve("netFixedAssets"),
      netWorkingCapital: resolve("netWorkingCapital"),
      operatingIncome: resolve("operatingIncome"),
      ownerEarnings: resolve("ownerEarnings"),
      price: resolve("price"),
    };
  }

  private checkedSymbol(symbol: string): string {
    if (!SYMBOL_PATTERN.test(symbol)) {
      throw new Error("Advisor research symbol is unsupported.");
    }
    return symbol;
  }

  private async loadBundle(bundle: FmpBundle, symbol: string): Promise<readonly FmpEntry[] | null> {
    const url = new URL(`${this.config.fmp.baseUrl}/${bundle}`);
    url.searchParams.set("symbol", symbol);

    try {
      const response = await this.fetchImplementation(url.toString(), {
        headers: { accept: "application/json", apikey: this.config.fmp.apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) return null;
      return payload.filter(isEntry);
    } catch {
      return null;
    }
  }

  private resolveField(
    field: FmpFactField,
    symbol: string,
    entries: readonly FmpEntry[] | null,
    retrievedAt: Date,
  ): FmpFactResult {
    const unavailable = (reason: FmpUnavailableReason): FmpFactResult => ({
      field,
      kind: "unavailable",
      reason,
      symbol,
    });

    if (entries === null) return unavailable("source-unavailable");

    const source = fieldSources[field];
    const matching = entries.filter(entry => {
      const s = stringMember(entry, "symbol");
      return s === null || s.toUpperCase() === symbol.toUpperCase();
    });
    if (matching.length === 0) return unavailable("missing");

    const observed = observation(source.bundle, matching[0]);
    if (observed === null) return unavailable("missing");

    const duplicated = matching.filter(entry => {
      const candidate = observation(source.bundle, entry);
      return candidate !== null && candidate.observedAt.getTime() === observed.observedAt.getTime();
    });
    if (duplicated.length > 1) return unavailable("ambiguous");

    const raw = source.read(matching[0]);
    if (raw === null) return unavailable("missing");
    const value = parseAdvisorNumber(raw);
    if (value === null) return unavailable("missing");

    if (!this.isFresh(source.bundle, observed.observedAt, retrievedAt)) {
      return unavailable("stale");
    }

    return {
      fact: {
        field,
        observedAt: observed.observedAt,
        period: observed.period,
        retrievedAt,
        source: "fmp",
        symbol,
        value,
      },
      kind: "available",
    };
  }

  private isFresh(bundle: FmpBundle, observedAt: Date, retrievedAt: Date): boolean {
    const age = retrievedAt.getTime() - observedAt.getTime();
    if (age < 0) return false;
    return bundle === "quote"
      ? age <= this.config.freshness.maxPriceAgeSeconds * 1_000
      : age <= this.config.freshness.maxFundamentalAgeDays * MILLISECONDS_PER_DAY;
  }
}
