set dotenv-load

# List available commands
default:
    @just --list

# Start local Anvil, for `forge test` only (the app targets real chains)
chain:
    cd packages/foundry && anvil

# Fund DEPLOYER + optional AGENT (100 ETH each from Anvil default account #0; chain must be running)
fund:
    node scripts/fund-deployer.mjs

# Install and verify the reviewed Foundry dependencies used by CustomerCreditVault.
foundry-dependencies:
    #!/usr/bin/env bash
    set -euo pipefail
    cd packages/foundry
    if [ ! -f lib/forge-std/src/Script.sol ]; then
      echo "Installing forge-std (first run)..."
      forge install foundry-rs/forge-std --no-git
    fi
    if [ ! -f lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol ]; then
      echo "Installing OpenZeppelin Contracts v5.6.1 (first run)..."
      forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git
    fi
    expected_openzeppelin_revision="5fd1781b1454fd1ef8e722282f86f9293cacf256"
    actual_openzeppelin_revision="$(git -C lib/openzeppelin-contracts rev-parse HEAD)"
    if [ "$actual_openzeppelin_revision" != "$expected_openzeppelin_revision" ]; then
      echo "OpenZeppelin Contracts must be v5.6.1 ($expected_openzeppelin_revision), found $actual_openzeppelin_revision." >&2
      exit 1
    fi
    if [ -n "$(git -C lib/openzeppelin-contracts status --porcelain)" ]; then
      echo "OpenZeppelin Contracts must have a clean working tree." >&2
      exit 1
    fi

# Compile contracts
compile: foundry-dependencies
    #!/usr/bin/env bash
    set -euo pipefail
    cd packages/foundry
    forge build

# Deploy contracts and generate ABI types (prompts for secrets password if .env.secrets.encrypted exists)
# Examples: just deploy   just deploy base   just deploy --network sepolia
deploy *ARGS:
    just foundry-dependencies
    node scripts/with-secrets.mjs -- node scripts/deploy-foundry.mjs {{ARGS}}

# Verify deployed contracts on a block explorer (set ETHERSCAN_API_KEY / BASESCAN_API_KEY / …)
# Examples: just verify base   just verify --network sepolia   VERIFY_NETWORK=base just verify
verify *ARGS:
    node scripts/with-secrets.mjs -- node scripts/verify-foundry.mjs {{ARGS}}

# Run contract tests
test: foundry-dependencies
    #!/usr/bin/env bash
    set -euo pipefail
    cd packages/foundry
    forge test

# Run the TypeScript unit tests (defaults to the testnet target; chains derive from it)
test-ts:
    #!/usr/bin/env bash
    set -euo pipefail
    cd packages/nextjs
    NEXT_PUBLIC_DEPLOY_TARGET="${NEXT_PUBLIC_DEPLOY_TARGET:-testnet}" \
      npx tsx --test lib/trading/*.test.ts lib/advisor/*.test.ts lib/credits/*.test.ts

# Apply customer-credit SQLite migrations on the persistent Node host.
credits-migrate:
    cd packages/nextjs && npm run credits:migrate

# Create a verified customer-credit SQLite backup at an absent absolute path.
credits-backup path:
    cd packages/nextjs && npm run credits:backup -- "{{path}}"

# Restore a verified backup; CREDIT_DATABASE_PATH must not already exist.
credits-restore path:
    cd packages/nextjs && npm run credits:restore -- "{{path}}"

# Start NextJS frontend (prompts for secrets password if .env.secrets.encrypted exists)
start:
    -node scripts/check-network.mjs
    node scripts/with-secrets.mjs -- sh -c 'cd packages/nextjs && npm run dev'

# Plain repo-root .env (NEXT_PUBLIC_* for WalletConnect / Reown client bundle)
#   just env MY_KEY my_value   — or: SECRET_VALUE=x just env MY_KEY
env key value:
    node scripts/secret-add.mjs env {{key}} {{value}}

# Encrypted .env.secrets.encrypted (password prompt; creates file if missing)
enc key value:
    node scripts/secret-add.mjs encrypted {{key}} {{value}}

# Reown / WalletConnect Cloud project id → .env
reown project_id:
    node scripts/secret-add.mjs env NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID {{project_id}}

# Register ERC-8004 agent on-chain (AGENT_PRIVATE_KEY pays gas; network from scaffold.config)
register-agent:
    node scripts/with-secrets.mjs -- npx tsx scripts/register-agent.ts

# Add N swarm agent wallets (public/agents.json + SWARM_AGENT_KEYS_JSON); default agents=1
swarm agents='1':
    node scripts/with-secrets.mjs -- node scripts/swarm-agents.mjs agents={{agents}}

# Deploy to Vercel (production by default); just ship   just ship name=my-custom-name   just ship preview
ship *ARGS:
    node scripts/ship.mjs {{ARGS}}

# Push env vars to Vercel; just ship-env KEY VALUE   just ship-env sync (pushes all from .env)
ship-env *ARGS:
    node scripts/with-secrets.mjs -- node scripts/ship-env.mjs {{ARGS}}

# Show deployer + agent address QR codes (reads repo-root .env)
accounts:
    node scripts/show-accounts.mjs

# Native balance for DEPLOYER_ADDRESS (+ agent) on every network in network-definitions
balances:
    npx tsx scripts/show-balances-all-chains.ts

# Generate a deployer wallet (if not already set)
generate:
    node scripts/generate-deployer.mjs

# Validate the deploy target's vault chain has contracts in deployedContracts
check-network:
    node scripts/check-network.mjs

# Switch deployment target (mainnet | testnet) in the repo-root .env
use-target target:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "{{target}}" != "mainnet" ] && [ "{{target}}" != "testnet" ]; then
      echo "Unknown target: {{target}} (expected 'mainnet' or 'testnet')"
      exit 1
    fi
    touch .env
    if grep -q '^NEXT_PUBLIC_DEPLOY_TARGET=' .env; then
      sed -i.bak 's/^NEXT_PUBLIC_DEPLOY_TARGET=.*/NEXT_PUBLIC_DEPLOY_TARGET={{target}}/' .env && rm -f .env.bak
    else
      echo 'NEXT_PUBLIC_DEPLOY_TARGET={{target}}' >> .env
    fi
    echo "  NEXT_PUBLIC_DEPLOY_TARGET → {{target}}"
    node scripts/check-network.mjs

# One-command setup for the testnet target: deploy the vault to Sepolia, then start
quickstart:
    #!/usr/bin/env bash
    set -euo pipefail
    just use-target testnet
    echo "Deploying contracts to Sepolia..."
    just deploy sepolia
    echo "Starting app..."
    just start

# Health check: validate env vars, connectivity, and setup
doctor:
    node scripts/doctor.mjs
