import { randomUUID } from "node:crypto";

import { getAddress, type Address } from "viem";

import type { AdvisorDatabaseConfig } from "./config";
import { getAdvisorPrismaClient, type AdvisorPrismaClient } from "./db";
import type {
  AdvisorFailureCode,
  AdvisorQuote,
  AdvisorRunRecorder,
  AdvisorRequestSource,
  CitedCalculation,
  CitedFact,
} from "./orchestrator";
import {
  RECOMMENDATION_DISCLAIMER,
  validateRecommendationHandoff,
  type RecommendationHandoff,
  type ValueInvestingRecommendation,
} from "./recommendation";

/**
 * Advisor-owned persistence.
 *
 * It writes only `advisor_*` tables and stores no raw prompt, wallet signature, provider key, or
 * raw provider payload — only redacted operational evidence, citation metadata, reproducible
 * calculation references, and the exact recommendation artifact.
 */

const sourceByRequest: Readonly<Record<AdvisorRequestSource, "CHECKUP" | "CONNECTOR" | "WEB">> = {
  checkup: "CHECKUP",
  connector: "CONNECTOR",
  web: "WEB",
};

const stanceByArtifact: Readonly<
  Record<
    ValueInvestingRecommendation["stance"],
    "FAIRLY_VALUED" | "INSUFFICIENT_BASIS" | "OVERVALUED" | "RESEARCH_ONLY" | "UNDERVALUED"
  >
> = {
  "fairly-valued": "FAIRLY_VALUED",
  "insufficient-basis": "INSUFFICIENT_BASIS",
  overvalued: "OVERVALUED",
  "research-only": "RESEARCH_ONLY",
  undervalued: "UNDERVALUED",
};

const artifactByStance: Readonly<Record<string, ValueInvestingRecommendation["stance"]>> = {
  FAIRLY_VALUED: "fairly-valued",
  INSUFFICIENT_BASIS: "insufficient-basis",
  OVERVALUED: "overvalued",
  RESEARCH_ONLY: "research-only",
  UNDERVALUED: "undervalued",
};

export class AdvisorRepository implements AdvisorRunRecorder {
  private readonly database: AdvisorPrismaClient;

  constructor(options: { config?: AdvisorDatabaseConfig; database?: AdvisorPrismaClient }) {
    const database = options.database ?? (options.config && getAdvisorPrismaClient(options.config));
    if (!database) {
      throw new Error("Advisor repository requires a database configuration or client.");
    }
    this.database = database;
  }

  async recordQuote(input: { quote: AdvisorQuote }): Promise<void> {
    const { quote } = input;
    await this.database.advisorQuote.upsert({
      create: {
        completionTokenAllowance: quote.completionTokenAllowance,
        contextHash: quote.contextHash,
        correlationId: quote.correlationId,
        expiresAt: quote.expiresAt,
        id: randomUUID(),
        maximumChargeMicroUsdc: quote.pricing.maximumCharge,
        philosophyVersion: quote.philosophyVersion,
        price0gMicroUsdc: quote.pricing.components["0g"],
        priceFmpMicroUsdc: quote.pricing.components.fmp,
        priceLegServiceMicroUsdc: quote.pricing.components.legService,
        priceVersion: quote.pricing.version,
        promptTokenBudget: quote.promptTokenBudget,
        routerModel: quote.routerModel,
        source: sourceByRequest[quote.source],
        wallet: getAddress(quote.wallet),
      },
      // A requote for the same correlation keeps one replay-safe binding.
      update: {},
      where: { correlationId: quote.correlationId },
    });
  }

  async startRun(input: {
    correlationId: string;
    runId: string;
    source: AdvisorRequestSource;
    startedAt: Date;
    wallet: Address;
  }): Promise<void> {
    const quote = await this.database.advisorQuote.findUnique({
      where: { correlationId: input.correlationId },
    });
    if (!quote) {
      throw new Error("An advisor run requires the quote that priced it.");
    }

    await this.database.advisorRun.create({
      data: {
        correlationId: input.correlationId,
        id: input.runId,
        philosophyVersion: quote.philosophyVersion,
        priceVersion: quote.priceVersion,
        quoteId: quote.id,
        routerModel: quote.routerModel,
        source: sourceByRequest[input.source],
        startedAt: input.startedAt,
        status: "RUNNING",
        wallet: getAddress(input.wallet),
      },
    });
  }

  async completeRun(input: {
    calculations: readonly CitedCalculation[];
    citations: readonly CitedFact[];
    completedAt: Date;
    correlationId: string;
    runId: string;
    usage: { completionTokens: number; promptTokens: number };
  }): Promise<void> {
    await this.database.$transaction(async transaction => {
      await transaction.advisorRun.update({
        data: {
          completedAt: input.completedAt,
          completionTokens: input.usage.completionTokens,
          promptTokens: input.usage.promptTokens,
          status: "COMPLETED",
        },
        where: { id: input.runId },
      });
      for (const citation of input.citations) {
        await transaction.advisorCitation.create({
          data: {
            id: randomUUID(),
            observedAt: citation.observedAt,
            periodLabel: citation.period,
            retrievedAt: citation.retrievedAt,
            runId: input.runId,
            source: citation.source,
            symbol: citation.symbol,
          },
        });
      }
      for (const calculation of input.calculations) {
        await transaction.advisorCalculation.create({
          data: {
            citationIdsJson: JSON.stringify(calculation.inputs.map(entry => entry.field)),
            createdAt: input.completedAt,
            formulaVersion: calculation.formulaVersion,
            id: calculation.calculationId,
            inputsJson: JSON.stringify(calculation.inputs),
            method: calculation.method,
            resultDecimal: calculation.result,
            runId: input.runId,
            unavailableReason: calculation.unavailableReason,
          },
        });
      }
    });
  }

  async failRun(input: {
    code: AdvisorFailureCode;
    completedAt: Date;
    correlationId: string;
    runId: string;
  }): Promise<void> {
    await this.database.advisorRun.update({
      data: { completedAt: input.completedAt, failureCode: input.code, status: "FAILED" },
      where: { id: input.runId },
    });
  }

  /** Persists the exact artifact produced by a completed run. */
  async saveRecommendation(recommendation: ValueInvestingRecommendation): Promise<void> {
    await this.database.advisorRecommendation.create({
      data: {
        artifactVersion: recommendation.version,
        assetAddress: recommendation.assetAddress,
        assetChainId: BigInt(recommendation.assetChainId),
        assetSymbol: recommendation.assetSymbol,
        calculationIdsJson: JSON.stringify(recommendation.calculations),
        evidenceJson: JSON.stringify(recommendation.evidence),
        expiresAt: recommendation.expiresAt,
        generatedAt: recommendation.generatedAt,
        id: recommendation.id,
        risks: recommendation.risks,
        runId: recommendation.runId,
        stance: stanceByArtifact[recommendation.stance],
        thesis: recommendation.thesis,
        wallet: getAddress(recommendation.wallet),
      },
    });
  }

  /** Rebuilds a stored artifact and revalidates it before any handoff. */
  async recommendationHandoff(input: {
    now: Date;
    recommendationId: string;
    wallet: string;
  }): Promise<RecommendationHandoff> {
    const stored = await this.database.advisorRecommendation.findUnique({
      where: { id: input.recommendationId },
    });
    if (!stored) return { kind: "rejected", reason: "malformed" };

    const run = await this.database.advisorRun.findUnique({ where: { id: stored.runId } });
    const parsedEvidence: unknown = JSON.parse(stored.evidenceJson);
    const parsedCalculations: unknown = JSON.parse(stored.calculationIdsJson);

    return validateRecommendationHandoff({
      now: input.now,
      recommendation: {
        assetAddress: stored.assetAddress,
        assetChainId: Number(stored.assetChainId),
        assetSymbol: stored.assetSymbol,
        calculations: parsedCalculations,
        disclaimer: RECOMMENDATION_DISCLAIMER,
        evidence: parsedEvidence,
        expiresAt: stored.expiresAt,
        generatedAt: stored.generatedAt,
        id: stored.id,
        philosophyVersion: run?.philosophyVersion ?? "",
        risks: stored.risks,
        runId: stored.runId,
        stance: artifactByStance[stored.stance] ?? stored.stance,
        thesis: stored.thesis,
        version: stored.artifactVersion,
        wallet: stored.wallet,
      },
      wallet: input.wallet,
    });
  }
}
