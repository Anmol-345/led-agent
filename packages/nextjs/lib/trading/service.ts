import Database from "better-sqlite3";
import { resolve } from "node:path";
import { loadTradingConfig, type TradingConfig } from "./config";
import { TradeGuard } from "./guard";
import { TradeOrchestrator } from "./orchestrator";
import { TradeRepository } from "./repository";
import { DefaultUniswapGateway, type UniswapGateway } from "./uniswap";

let singletonOrchestrator: TradeOrchestrator | null = null;
let singletonRepository: TradeRepository | null = null;

export function getTradingService(
  env: Record<string, string | undefined> = process.env,
  customGateway?: UniswapGateway
): { orchestrator: TradeOrchestrator; repository: TradeRepository; config: TradingConfig } {
  if (singletonOrchestrator && singletonRepository && !customGateway) {
    const config = loadTradingConfig(env);
    return { orchestrator: singletonOrchestrator, repository: singletonRepository, config };
  }

  const config = loadTradingConfig(env);
  const dbPath = env.CREDIT_DATABASE_PATH || resolve(process.cwd(), "../../data/credits.db");
  const db = new Database(dbPath);
  const repo = new TradeRepository(db);
  const guard = new TradeGuard();
  const gateway = customGateway || new DefaultUniswapGateway();
  const orchestrator = new TradeOrchestrator(guard, gateway, repo, config);

  if (!customGateway) {
    singletonOrchestrator = orchestrator;
    singletonRepository = repo;
  }

  return { orchestrator, repository: repo, config };
}
