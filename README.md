# leg-agent

> **FORK NOTICE / BOT Chain port** — This tree is a BOT Chain ecosystem port of the
> scaffold-agent **leg-agent** monorepo (MIT). See [ATTRIBUTION.md](./ATTRIBUTION.md) for
> what was inherited vs. added for chainId **677** (mainnet) / **968** (testnet).
> Contracts remain EVM-compatible with zero logic change for the vault; network config,
> deploy pipeline, and frontend chain wiring are the BOT-specific work.

Onchain AI agent monorepo — scaffolded with `scaffold-agent`.

## Live on BOT Chain

| Network | Chain ID | Status |
|---------|----------|--------|
| Mainnet | 677 | **Live** — see addresses below |
| Testnet | 968 | Optional: `node scripts/deploy-botchain.mjs testnet --broadcast` |

### Mainnet addresses (chainId 677)

| Contract | Explorer |
|----------|----------|
| CustomerCreditVault | https://scan.botchain.ai/address/0xd4b0a312274996Cc20b32AB0F5c9f1a5a2f9745a |
| BotchainCreditUSDC | https://scan.botchain.ai/address/0x85dB0D47015C7b4f144773B8395869f866d94FBa |
| AgentWallet | https://scan.botchain.ai/address/0x91587Cb9021c76f5F3a20F17CED9266662ee6437 |

Vault deploy tx: https://scan.botchain.ai/tx/0x348c9b01f55dece352feae99109be0814d347e1679da6e6bd579c3766be6d84f  

Full record: `deployments/botchain-677.json`. Set `NEXT_PUBLIC_DEPLOY_TARGET=botchain` and copy vault/USDC addresses into `.env`.

```bash
# Simulate / broadcast helpers
node scripts/deploy-botchain.mjs mainnet
# bash scripts/smoke-test-botchain.sh   # after CREDIT_VAULT_ADDRESS is set
```


## Prerequisites

- [Node.js](https://nodejs.org) 24.11.x (the credit runtime rejects other versions)
- [just](https://just.systems/man/en/) command runner
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- First `just compile`, `just test`, or `just deploy` installs **forge-std** and the reviewed **OpenZeppelin Contracts v5.6.1** revision (`5fd1781b1454fd1ef8e722282f86f9293cacf256`) into `packages/foundry/lib/` (gitignored).

## Quick Start

`scaffold-agent` runs **`npm install`** in the repo root when you create the project (unless **`SCAFFOLD_SKIP_NPM_INSTALL=1`**). Then:

The app runs against **one of two deployment targets**, selected by
**`NEXT_PUBLIC_DEPLOY_TARGET`** in the repo-root `.env` (see `.env.example`):

| | `mainnet` | `testnet` |
|---|---|---|
| Credit vault | Base (8453), native USDC | Sepolia (11155111), mock USDC we deploy |
| 0G router | `router-api.0g.ai` | `router-api-testnet.integratenetwork.work` |
| Trades | real, on the asset's own chain | **stand-in swap on Sepolia** (see below) |
| Faucet | none — bring your own funds | mints mock USDC from your wallet |

```bash
just use-target testnet   # write NEXT_PUBLIC_DEPLOY_TARGET into .env
just deploy sepolia       # deploy the vault + mock USDC; copy the printed addresses to .env
just start                # start the app
just quickstart           # the three above in one command
just verify               # verify deployed contracts on an explorer
just ship                 # deploy the generic scaffold to Vercel; credit routes are unsupported there
```

**Why testnet trades are stand-ins.** No tokenized equity exists on any testnet the Uniswap
Trading API supports — verified by `eth_getCode` against every Ondo, xStocks and Dinari
address on Sepolia and Base Sepolia, and by a census of the ~9,500 tokens with Uniswap
pools there. Robinhood runs a testnet with real stock tokens, but the API rejects chain
46630 and no Uniswap is deployed on it. So on `testnet` the price you see is a **real live
mainnet quote** for the real asset, while the transaction you sign is a same-sized USDC
swap on Sepolia. The UI always labels this; it is a demonstration device, not a fill.

`just chain` still runs a local Anvil node, but only for `forge test` — the app no longer
targets a local chain.

If install was skipped or failed: `npm install` from the repo root.

---

## Deploying

Both targets need a **funded deployer wallet** — an EOA holding native gas on the chain you
are deploying to. The deploy itself is two contracts (`AgentWallet`, `CustomerCreditVault`)
plus, off Base, a mock USDC.

### 1. Create or supply a deployer key

```bash
just generate          # creates DEPLOYER_PRIVATE_KEY + DEPLOYER_ADDRESS if unset
just accounts          # show deployer + agent addresses as QR codes, to fund from a phone
```

`just generate` writes the key to `.env.secrets.encrypted` if you use encrypted mode
(prompting for the password), otherwise to `.env`. To use a wallet you already control,
set `DEPLOYER_PRIVATE_KEY` and `DEPLOYER_ADDRESS` yourself — `just enc DEPLOYER_PRIVATE_KEY 0x...`
keeps it encrypted at rest.

> `just fund` only works against a local Anvil node. On real networks you must fund the
> deployer address yourself.

### 2a. Testnet — Sepolia

Free. Get Sepolia ETH from a faucet ([Google Cloud](https://cloud.google.com/application/web3/faucet/ethereum/sepolia),
[Alchemy](https://sepoliafaucet.com), or [pk910's PoW faucet](https://sepolia-faucet.pk910.de)).
**~0.05 ETH is plenty** for the whole deploy.

```bash
just use-target testnet
just deploy sepolia
```

The deploy prints the two values the app needs:

```
CREDIT_USDC_ADDRESS=0x…     # the mock USDC it just deployed
CREDIT_VAULT_ADDRESS=0x…    # the vault
```

Copy both into `.env`, along with the block the vault landed in:

```bash
CREDIT_VAULT_ADDRESS=0x…
CREDIT_USDC_ADDRESS=0x…
CREDIT_DEPLOYMENT_BLOCK=<block number of the deploy tx>
CREDIT_BASE_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
CREDIT_BILLING_SIGNER_PRIVATE_KEY=0x…   # see below
```

On testnet every vault role (admin, billing, treasury) defaults to the deployer, so
`CREDIT_BILLING_SIGNER_PRIVATE_KEY` can simply be the deployer key. Then:

```bash
just check-network     # confirms the vault is deployed on the target's chain
just start
```

In the app, use the droplet button to mint mock USDC to your wallet, then deposit it.

### 2b. Mainnet — Base

**This spends real money.** The vault holds real customer USDC, so the deploy script
enforces two rules that do not apply on testnet:

- `CREDIT_ADMIN_ADDRESS` **must be a contract** — a multisig or timelock, not an EOA.
- admin, billing and treasury must be **three distinct addresses**, none of them the deployer.

This is deliberate: it means no single compromised key can drain the vault.

```bash
# Set these first — the deploy reverts without them.
CREDIT_ADMIN_ADDRESS=0x…      # Safe / timelock contract
CREDIT_BILLING_ADDRESS=0x…    # hot signer that reserves and settles charges
CREDIT_TREASURY_ADDRESS=0x…   # withdraws accrued revenue
```

Fund the deployer with Base ETH (a few dollars covers it), then:

```bash
just use-target mainnet
just deploy base
```

Record `CREDIT_VAULT_ADDRESS` and its deployment block. `CREDIT_USDC_ADDRESS` is **not**
used on Base — the vault is pinned to native USDC (`0x8335…2913`) in the contract itself
and refuses to deploy against any other token. Set `CREDIT_BILLING_SIGNER_PRIVATE_KEY` to
the key behind `CREDIT_BILLING_ADDRESS`, and point `CREDIT_BASE_RPC_URL` at a Base RPC you
trust (the public `https://mainnet.base.org` will rate-limit under real traffic).

### 3. Verify on a block explorer (optional)

```bash
just verify sepolia          # needs ETHERSCAN_API_KEY
just verify base             # needs BASESCAN_API_KEY
```

Constructor arguments are reconstructed from the broadcast, including the mock USDC address
on testnet, so you do not need to restate them.

### Redeploying

`deployedContracts.ts` is regenerated on every deploy and is committed, because
`packages/foundry/broadcast/` is gitignored — a fresh clone cannot regenerate it without
redeploying. Commit the regenerated file after a deploy.

### Cost summary

| | chain | gas token | typical cost |
|---|---|---|---|
| testnet | Sepolia (11155111) | faucet ETH | free |
| mainnet | Base (8453) | ETH on Base | a few dollars |

Trades are separate: on `mainnet` the customer spends their own funds on the asset's chain;
on `testnet` the stand-in swap costs only Sepolia gas.

## Customer credits

`CustomerCreditVault` is a non-upgradeable contract holding prepaid USDC credit. On the
`mainnet` target it lives on Base and is pinned in the contract to native Base USDC
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`); on `testnet` it lives on Sepolia against a
mock USDC the deploy creates. See [Deploying](#deploying) for the steps and the role rules.

Credit production must run on one persistent Node 24.11.x host with a durable local SQLite
volume. Vercel, AWS Lambda, horizontally scaled SQLite writers, and other
ephemeral/serverless runtimes are unsupported for credit routes; `just ship` remains
available only for the generic scaffold.

### Spending credit without signing every charge

By default each charge needs an EIP-712 signature from the customer. `depositWithGrant`
lets them authorize a **capped, expiring budget** in the deposit transaction they already
sign, after which inference charges settle with no wallet prompt:

```solidity
depositWithGrant(uint256 amount, uint256 maxTotalCharge, uint48 expiresAt)
```

The cap and expiry bound the damage: a compromised billing signer can never draw more than
`maxTotalCharge` before `expiresAt`, and `revokeSessionGrant()` ends it immediately. Unspent
budget is refunded when a reservation settles below its maximum or is released, so a session
is not burnt down by uncharged reservations. **Swaps are excluded** — they move real funds
and always require an explicit confirmation.

Configure the persistent host with server-only variables:

```dotenv
CREDIT_APP_ORIGIN=https://app.example.com
CREDIT_BASE_RPC_URL=https://...
CREDIT_CONFIRMATIONS=12
CREDIT_DEPLOYMENT_BLOCK=12345678
CREDIT_VAULT_ADDRESS=0x...
CREDIT_DATABASE_PATH=/var/lib/leg-agent/credits.sqlite
CREDIT_BILLING_SIGNER_PRIVATE_KEY=0x...
CREDIT_SCHEDULER_SECRET=at-least-32-characters...
FMP_PRODUCTION_LICENSE_CONFIRMED=false
```

The billing key must derive `CREDIT_BILLING_ADDRESS` and hold the vault's `BILLING_ROLE`; writes fail closed otherwise. That role cannot invent a customer cap: billing first persists an immutable draft, the customer signs EIP-712 data bound to the reservation, Base chain, and vault, the server stores that public signature before broadcast, and `CustomerCreditVault` verifies the same EOA/ERC-1271 signature on-chain. SIWE credit sessions are read-only. Set the FMP flag to `true` only after confirming production licensing. Never expose credit, FMP, or 0G secrets through `NEXT_PUBLIC_*` variables.

Create the durable directory, run migrations before starting the service, and take verified SQLite backups:

```bash
just credits-migrate
just credits-backup /secure/backups/credits-$(date +%F).sqlite
```

Restore is intentionally non-overwriting. Stop the service, move the current database aside, then restore to the configured absent `CREDIT_DATABASE_PATH`:

```bash
just credits-restore /secure/backups/credits-2026-07-25.sqlite
```

After deployment or restore, start exactly one application/scheduler process and verify the vault address, deployment block, Base RPC, and durable volume against the deployment record.

**Next.js:** Chat at `/`. **RainbowKit + wagmi + viem**. **MetaMask only** — the burner wallet and its local-chain auto-connect were removed along with the forked-Anvil setup. **Reown / WalletConnect:** **`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`** in repo-root **`.env`** ([WalletConnect Cloud](https://cloud.walletconnect.com)); **`just reown <id>`**. **`/balances`**, **`/identity`**, **`/debug`**. **`next.config.js`** loads repo-root **`.env`**.


## Commands

| Command | Description |
|---|---|
| `just chain` | Start local Anvil (for `forge test` only) |
| `just fund` | Fund `DEPLOYER_ADDRESS`, `AGENT_ADDRESS`, and any swarm rows in `packages/*/public/agents.json` (100 ETH each from account #0) |
| `just deploy` | Deploy contracts & auto-generate ABI types (optional: `just deploy base`, `just deploy --network sepolia`) |
| `just verify` | Verify deployed `AgentWallet` and `CustomerCreditVault` contracts on an explorer (default network: sepolia; e.g. `just verify base`) |
| `just env KEY VALUE` | Upsert repo-root `.env` (e.g. **Reown** `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`) |
| `just enc KEY VALUE` | Add/update a key in `.env.secrets.encrypted` (password prompt) |
| `just reown PROJECT_ID` | WalletConnect Cloud id → `.env` |
| `just register-agent` | Register ERC-8004 agent on-chain (`AGENT_PRIVATE_KEY`; uses `scaffold.config` network) |
| `just swarm agents=N` | Add **N** swarm wallets (`public/agents.json` + `SWARM_AGENT_KEYS_JSON`; default `agents=1`) |
| `just balances` | Native balance on **all** networks in `network-definitions` (`DEPLOYER_ADDRESS` + agent; `rpcOverrides` from `scaffold.config`) |
| `just credits-migrate` | Apply customer-credit SQLite migrations on the persistent host |
| `just credits-backup <absolute-path>` | Create and integrity-check a mode-0600 SQLite backup |
| `just credits-restore <absolute-path>` | Restore a verified backup to an absent configured database path |
| `just ship` | Deploy the generic scaffold to **Vercel**; credit routes require a persistent Node host |
| `just ship-env KEY VALUE` | Push an env var to the Vercel project; `just ship-env sync` pushes all known vars from `.env` |
| `just start` | Start the frontend / agent (may prompt for secrets password) |
| `just accounts` | QR codes for `DEPLOYER_ADDRESS` + agent (`AGENT_ADDRESS` / `NEXT_PUBLIC_AGENT_ADDRESS`; repo-root `.env`) |
| `just generate` | Generate a deployer wallet (password prompt if `.env.secrets.encrypted` exists) |
| `just check-network` | Validate the target's vault chain has deployments in `deployedContracts.ts` |
| `just use-target <target>` | Switch `NEXT_PUBLIC_DEPLOY_TARGET` in `.env` (`mainnet` or `testnet`) and run check |
| `just quickstart` | Testnet setup: use-target → deploy to Sepolia → start |
| `just test-ts` | Run the TypeScript unit tests |
| `just doctor` | Health check: validate env, tools, and setup |

## Ampersend (x402 payments)

See **[\`AMPERSEND.md\`](./AMPERSEND.md)** — [docs](https://docs.ampersend.ai/), [npm](https://www.npmjs.com/package/@ampersend_ai/ampersend-sdk), [GitHub](https://github.com/edgeandnode/ampersend-sdk).

## Secrets

**`.cursorignore`** (Cursor) keeps `.env`, encrypted secrets, `private-keys/`, and common key files out of LLM context. **`.claude/settings.json`** sets **Claude Code** `permissions.deny` `Read(...)` rules for the same paths (Claude Code does not read `.cursorignore`). `.claude/settings.local.json` is gitignored for machine-specific overrides. Adjust either file if you add other secret locations.

Secrets live in **\`.env.secrets.encrypted\`** (AES-256-GCM). **\`.env\`** holds only non-sensitive values. Use **\`just deploy\`**, **\`just start\`**, etc. — they prompt for your password (or set **\`SCAFFOLD_ENV_PASSWORD\`** in CI).
