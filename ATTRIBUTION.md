# Attribution

This project is a **BOT Chain port** of [leg-agent](.), an onchain AI financial-advisor agent monorepo scaffolded with `scaffold-agent`. Contracts are SPDX MIT. A root `LICENSE` (MIT) was added for the BOT Chain ecosystem port so the project has an explicit open-source grant.

## Upstream / inherited

- `packages/foundry/src/AgentWallet.sol` — agent execution wallet (logic retained)
- `packages/foundry/src/CustomerCreditVault.sol` — credit vault accounting (logic retained; Base USDC pin unchanged for chain 8453)
- Foundry deploy/test layout under `packages/foundry/`
- Next.js app under `packages/nextjs/` (advisor, credits, trading integrations)
- Scaffold-agent tooling (`justfile`, `scripts/`, network helpers)

## Written for the BOT Chain port

- BOT Chain network configuration (chainId 677 / 968) in Foundry, deploy scripts, and frontend
- `packages/foundry/script/DeployBotchain.s.sol` — BOT-only deploy with chain-id seatbelt
- `deployments/botchain-*.json` deployment records
- `packages/nextjs/lib/config/chain.ts` — viem `botchain` / `botchainTestnet` definitions
- `test/BotchainVerify.t.sol` / `scripts/smoke-test-botchain.*` mainnet verification helpers
- `DESIGN.md` BOT Chain–native product direction
- This file and the README **FORK NOTICE / BOT Chain port** section
