# Homelab Deployment & Operations Guide

This guide covers deploying and operating `leg-agent` on your self-hosted homelab using Docker Compose, persistent SQLite storage, and Cloudflare Tunnel integration. The vault runs on a real chain — Base on the `mainnet` target, Sepolia on `testnet` — so there is no local node to operate.

---

## 1. Prerequisites & Docker Installation

Install Docker Engine and Docker Compose (v2.20+) on your host system:

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

Verify the installation:

```bash
docker --version
docker compose version
```

---

## 2. Cloudflare Tunnel Setup

1. Log into your [Cloudflare Dashboard](https://dash.cloudflare.com) and navigate to **Zero Trust > Networks > Tunnels**.
2. Click **Create a Tunnel** and select `cloudflared`. Name your tunnel `leg-agent-homelab`.
3. Copy the generated `CLOUDFLARE_TUNNEL_TOKEN` secret.

---

## 3. Hostname Routing Configuration

1. In the Cloudflare Tunnel configuration view, add a Public Hostname rule:
   - **Subdomain / Domain**: `leg-agent.lybre.xyz`
   - **Service Type**: `HTTP`
   - **URL / Target**: `app:3000`
2. Save the hostname configuration. All HTTPS requests to `https://leg-agent.lybre.xyz` will now be securely routed through the tunnel directly to the `app` container on port 3000.

---

## 4. Environment Configuration

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Configure your environment variables:

```ini
# Cloudflare Tunnel Secret
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...

# Public Application Origin
CREDIT_APP_ORIGIN=https://leg-agent.lybre.xyz

# Deployment target: mainnet (Base vault, real trades) or testnet (Sepolia vault).
NEXT_PUBLIC_DEPLOY_TARGET=testnet

# RPC for the vault chain (Base on mainnet, Sepolia on testnet).
CREDIT_BASE_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# Internal Database & Runtime Configuration
CREDIT_DATABASE_PATH=/app/packages/nextjs/prisma/data/credits.db
CREDIT_CONFIRMATIONS=2
# Both printed by `just deploy sepolia`. There are no defaults on purpose — a placeholder
# here previously produced a deployment that came up looking healthy but could not work.
CREDIT_DEPLOYMENT_BLOCK=
CREDIT_VAULT_ADDRESS=
CREDIT_USDC_ADDRESS=
CREDIT_BILLING_SIGNER_PRIVATE_KEY=   # must hold BILLING_ROLE on the deployed vault
CREDIT_SCHEDULER_SECRET=your-32-character-minimum-scheduler-secret-string
FMP_PRODUCTION_LICENSE_CONFIRMED=true

# Provider Keys
UNISWAP_API_KEY=your-uniswap-trading-api-key
FMP_API_KEY=your-financial-modeling-prep-key
```

---

## 5. Build and Launch the Stack

Start the entire Docker stack in detached mode:

```bash
docker compose up -d --build
```

Verify that all 4 containers are running healthy:

```bash
docker compose ps
```

You should see:
- `leg-agent-app` (Running)
- `leg-agent-cloudflared` (Running)

---

## 6. MetaMask Network Configuration

The app targets real chains, so no custom RPC is needed — the wallet is switched
automatically to whichever chain a trade settles on, and networks the wallet does not know
(Robinhood Chain, 4663) are added via `wallet_addEthereumChain` on request.

On the `testnet` target you only need **Sepolia**, which MetaMask ships with. Fund it from
a public faucet, then use the droplet button in the app to mint mock credit USDC.

## 7. End-to-End User Verification Workflow

1. Navigate to `https://leg-agent.lybre.xyz/` in your browser.
2. Connect your MetaMask wallet.
3. Click **Fund Wallet** to mint test ETH and Base USDC from the local fork.
4. Expand **Manage Credits** and deposit USDC to credit your `CustomerCreditVault` balance.
5. Select a tokenized stock chip (e.g. `AAPL.d`, `NVDAon`) and a legendary investor philosophy chip (e.g. `Ben Graham`, `Warren Buffett`).
6. Click **Run AI Advisor & Fetch Quote**.
7. Sign the EIP-712 Credit Reservation typed data when prompted by MetaMask.
8. Review the inline **Valuation Recommendation Artifact** and the **Uniswap Trading API Quote**.
9. Click **Approve & Trade via MetaMask** and approve the onchain transaction.
10. Observe the animated pixel-art bionic leg celebration card upon transaction confirmation!

---

## 8. Database Backup and Restoration

### Backup SQLite Volume

To create a consistent snapshot of the credit ledger and advisor run database:

```bash
docker exec leg-agent-app npm run credits:backup
```

Or manually copy the database file:

```bash
docker run --rm -v leg-agent_sqlite-data:/data -v $(pwd):/backup alpine \
  tar czvf /backup/credits_db_backup.tar.gz -C /data .
```

### Restore SQLite Volume

To restore the database:

```bash
docker run --rm -v leg-agent_sqlite-data:/data -v $(pwd):/backup alpine \
  sh -c "cd /data && tar xzvf /backup/credits_db_backup.tar.gz"
docker compose restart app
```

---

## 9. Secret Rotation & Stack Updates

To update secrets or rebuild after pulling codebase changes:

1. Update `.env` with new keys or tokens.
2. Restart the containers with build:

```bash
docker compose up -d --build --force-recreate
```

SQLite database records (`sqlite-data`) are preserved across restarts. There is no local chain state to keep — the vault lives on a real network.

---

## 10. Security Warnings & Best Practices

> [!CAUTION]
> **NEVER REUSE DEMO PRIVATE KEYS ON MAINNET**
> 
> Never reuse the well-known Anvil development keys (`0xac0...2ff80`) here. The billing signer holds BILLING_ROLE on a vault holding real customer credit; generate a fresh key and keep it encrypted.
> 
> - Never send real mainnet funds to these addresses.
> - Always use distinct, hardware-secured, or dedicated private keys in production.
> - Ensure Cloudflare Tunnel access control (Access/Zero Trust policies) is enabled if hosting private endpoints.
