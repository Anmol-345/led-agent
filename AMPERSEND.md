# Ampersend (x402 / agent payments)

You chose **Install ampersend SDK** when running `scaffold-agent`.

[ampersend](https://docs.ampersend.ai/) is a platform for agent payments and operations (Edge & Node), using **x402**, **A2A**, and **MCP**.

## Links

- **Documentation:** https://docs.ampersend.ai/
- **npm (`@ampersend_ai/ampersend-sdk`):** https://www.npmjs.com/package/@ampersend_ai/ampersend-sdk
- **GitHub (TypeScript + Python):** https://github.com/edgeandnode/ampersend-sdk

## In this monorepo

The `@ampersend_ai/ampersend-sdk` dependency (0.0.14) + `@x402/fetch` + `@x402/core` are in `packages/nextjs/package.json`.

A pre-configured helper is generated at `packages/nextjs/lib/ampersend-client.ts`:

```typescript
import { getAmpersendTreasurer, getPaymentFetch } from "@/lib/ampersend-client";

// AmpersendTreasurer — authorizes x402 payments via the Ampersend API
const treasurer = getAmpersendTreasurer();

// Fetch wrapper that auto-handles 402 Payment Required responses
const payFetch = getPaymentFetch();
const res = await payFetch('https://httpay.xyz/api/market-mood');
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `AMPERSEND_SIGNING_KEY` | Yes | Private key from ampersend.ai (0x…) |
| `AMPERSEND_SMART_ACCOUNT_ADDRESS` | Recommended | Smart account address from ampersend.ai (enables smart account mode) |
| `AMPERSEND_CHAIN_ID` | No | Chain ID for payments (default: `8453` = Base mainnet) |
| `X402_NETWORKS` | No | Comma-separated networks (default: `base,base-sepolia`) |

The AI agent has an `x402_paid_fetch` tool that uses `getPaymentFetch()` to call APIs behind x402 paywalls automatically.
