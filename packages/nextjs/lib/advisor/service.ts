import { loadAdvisorResearchConfig } from "./config";
import { AdvisorCreditAdapter, type AdvisorCreditLedger } from "./credit";
import { getAdvisorPrismaClient } from "./db";
import { FmpGateway } from "./fmp";
import { AdvisorOrchestrator } from "./orchestrator";
import { PortfolioReader } from "./portfolio";
import { AdvisorRepository } from "./repository";
import { RouterAdapter } from "./router";
import { getAddress, isAddress, type Address } from "viem";
import {
  createCreditReservationTypedData,
  creditReservationId,
  CreditLedgerService,
} from "../credits/ledger";
import { loadCreditBillingConfig } from "../credits/config";

function demoVaultAddress(): Address {
  const configured = process.env.CREDIT_VAULT_ADDRESS?.trim();
  return configured && isAddress(configured)
    ? getAddress(configured)
    : "0x4444444444444444444444444444444444444444";
}

class SimpleAdvisorCreditLedger implements AdvisorCreditLedger {
  async prepareAuthorization(input: Parameters<AdvisorCreditLedger["prepareAuthorization"]>[0]) {
    const authorizationId = `authorization-${input.correlationId}`;
    const reservationId = creditReservationId(authorizationId);
    return {
      authorizationId,
      chargePurpose: "leg-credit-v1;service=advisor",
      expiresAt: input.expiresAt,
      reservationId,
      typedData: createCreditReservationTypedData({
        authorizationId,
        chainId: 8453,
        correlationId: input.correlationId,
        expiresAt: input.expiresAt,
        pricing: input.pricing,
        serviceType: input.serviceType,
        vaultAddress: demoVaultAddress(),
        wallet: input.wallet,
      }),
    };
  }

  async authorize(input: Parameters<AdvisorCreditLedger["authorize"]>[0]) {
    return {
      authorizationId: input.authorizationId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      reservationId: creditReservationId(input.authorizationId),
    };
  }

  async finalize(
    input: Parameters<AdvisorCreditLedger["finalize"]>[0],
  ): Promise<Awaited<ReturnType<AdvisorCreditLedger["finalize"]>>> {
    if (input.components === null) return { status: "provisional" };
    const total = input.components["0g"] + input.components.fmp + input.components.legService;
    if (input.outcome === "failed") {
      return { status: total === 0n ? "released" : "failed" };
    }
    return { status: "settled" };
  }
}

let cachedOrchestrator: AdvisorOrchestrator | null = null;
let cachedRepository: AdvisorRepository | null = null;

export function getAdvisorConfig() {
  return loadAdvisorResearchConfig();
}

export function getAdvisorRepository(): AdvisorRepository {
  if (cachedRepository) return cachedRepository;
  const config = getAdvisorConfig();
  const db = getAdvisorPrismaClient(config);
  cachedRepository = new AdvisorRepository({ database: db });
  return cachedRepository;
}

export function getAdvisorOrchestrator(): AdvisorOrchestrator {
  if (cachedOrchestrator) return cachedOrchestrator;
  const config = getAdvisorConfig();
  const repository = getAdvisorRepository();
  
  let ledger: AdvisorCreditLedger;
  const forceFakeLedger = process.env.ENABLE_FAKE_CREDIT_LEDGER === "true";
  if (forceFakeLedger) {
    ledger = new SimpleAdvisorCreditLedger();
  } else {
    const billingConfig = loadCreditBillingConfig();
    const db = getAdvisorPrismaClient(config);
    ledger = new CreditLedgerService({ prisma: db as any, config: billingConfig });
  }

  const credit = new AdvisorCreditAdapter({ config, ledger });
  const fmp = new FmpGateway({ config });
  const portfolio = new PortfolioReader();
  const router = new RouterAdapter({ config });

  cachedOrchestrator = new AdvisorOrchestrator({
    config,
    credit,
    fmp,
    portfolio,
    recorder: repository,
    router,
  });

  return cachedOrchestrator;
}
