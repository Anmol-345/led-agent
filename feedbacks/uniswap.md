# Uniswap Trading API: Developer Feedback, Integration Pitfalls & Learnings

> **Project:** Leg Agent (Hackathon Financial Advisor & On-Chain Trading Agent)  
> **Author:** Antigravity AI Pair Developer  
> **Target Endpoint:** `https://trade-api.gateway.uniswap.org/v1`  
> **Date:** July 26, 2026  

---

## Executive Summary

During the integration of the **Uniswap Trading API** into Leg Agent—a decentralized AI financial advisor executing trades on tokenized stocks (e.g., Ondo Finance `NVDAon`, `TSLAon`, `SPYon`, `QQQon`) with direct **10 bps integrator fee collection**—we encountered several critical implementation hurdles, subtle schema behaviors, and documentation gaps. 

This document synthesizes our empirical learnings, real-world `curl` probe findings, and constructive recommendations for the Uniswap Labs developer experience team.

---

## 1. Endpoint Ambiguity & Error Code Trap (`HTTP 409 ACCESS_DENIED`)

### The Struggle
When attempting to call the standard API base URL `https://api.uniswap.org/v2/quote` with a valid Developer Portal API key in the `x-api-key` header, the API consistently returned:
```json
HTTP/2 409 Conflict
{"errorCode": "ACCESS_DENIED"}
```

### Impact & Misdirection
The `HTTP 409 ACCESS_DENIED` status code strongly implies an authorization failure, account tier restriction, or missing KYC verification. In reality, Developer Portal API keys generated on [developer.uniswap.org](https://developer.uniswap.org) are strictly gated for the **Gateway Endpoint**.

### Learning & Fix
The correct production gateway base URL is:
$$\text{Production Base URL} = \text{\texttt{https://trade-api.gateway.uniswap.org/v1}}$$

**Constructive Feedback:**
- Deprecate or return `HTTP 301 Moved Permanently` or a descriptive error code like `HTTP 400 ObsoleteEndpoint` with detail `"Please use https://trade-api.gateway.uniswap.org/v1"` when developer keys are sent to legacy endpoints.

---

## 2. Amount Formatting: Raw Atomic Units vs. Human Decimal Strings

### The Struggle
When submitting trade quote requests from user interface forms, amounts are typically formatted as human decimal strings (e.g. `"100.0"` for 100 USDC or `"1.0"` for 1 token). Sending `"amount": "100.0"` in `POST /quote` causes schema validation failures or unexpected routing errors:
```json
{"errorCode":"RequestValidationError","detail":"\"amount\" fails to match required pattern"}
```

### Learning & Fix
The `amount` field in `POST /quote` **must always be a raw integer string** representing atomic units (wei):
- For **100 USDC** (6 decimals): `parseUnits("100.0", 6)` $\rightarrow$ `"100000000"`
- For **1 NVDAon** (18 decimals): `parseUnits("1.0", 18)` $\rightarrow$ `"1000000000000000000"`

**Constructive Feedback:**
- Clarify in the `POST /quote` API reference documentation that `amount` requires atomic integer units (wei) based on the `decimals` parameter of `tokenIn` / `tokenOut`.

---

## 3. Same-Asset Swap Request: Misleading `HTTP 404 ResourceNotFound`

### The Struggle
If a client UI inadvertently requests a quote where `tokenIn` equals `tokenOut` (e.g. `NVDAon` $\rightarrow$ `NVDAon`), the gateway responds with:
```json
HTTP/2 404 Not Found
{"errorCode":"ResourceNotFound","detail":"No quotes available","requestId":"..."}
```

### Impact & Misdirection
`ResourceNotFound: No quotes available` leads developers to assume liquidity pools are missing or that the asset is unindexed on the target chain, masking the fact that the input and output tokens are identical.

**Constructive Feedback:**
- Add a pre-routing request validator for `tokenIn !== tokenOut`. If `tokenIn === tokenOut`, return `HTTP 400 Bad Request` with `{"errorCode":"InvalidTokenPair","detail":"tokenIn and tokenOut cannot be identical"}`.

---

## 4. Integrator Fee Response Schema Discrepancy (`portionAmount` / `feeAmount`)

### The Struggle
When requesting a quote with fee collection enabled:
```json
{
  "feeBps": 10,
  "feeRecipient": "0x2222222222222222222222222222222222222222"
}
```
The documentation indicates that top-level fee metadata (`portionAmount`, `portionRecipient`, or `feeAmount`) will be returned in the response. However, in `CLASSIC` routing mode with Universal Router v2, the fee split is encoded directly into the Universal Router execution bytecode (`quote.methodParameters.calldata`), leaving top-level `portionAmount` / `feeAmount` as `undefined` or omitted from top-level response JSON metadata.

### Impact & Fix
Attempting to read `json.feeAmount` or `json.portionAmount` directly resulted in `0 tokens` displayed in our UI.

**Implementation Fix:**  
If `feeAmount` is omitted from response JSON metadata, calculate the fee in atomic units directly from output amount:
$$\text{Integrator Fee Amount} = \frac{\text{Output Amount} \times \text{feeBps}}{10000}$$

```typescript
let feeAmountRaw = String(
  json.feeAmount || json.portionAmount || json.quote?.portionAmount || "0"
);

if (feeAmountRaw === "0" && outputAmountRaw !== "0" && feeBps > 0) {
  const outBig = BigInt(outputAmountRaw);
  feeAmountRaw = ((outBig * BigInt(feeBps)) / 10000n).toString();
}
```

**Constructive Feedback:**
- Standardize top-level response metadata so that `portionAmount` / `feeAmount` is always explicitly returned as a string whenever `feeBps` and `feeRecipient` are specified in the request.

---

## 5. Tokenized Stock (RWA) Discoverability & Liquidity Findings

### Key Discoveries
Our direct `curl` probing revealed fantastic liquidity for major **Ondo Finance Tokenized Equities** on Ethereum Mainnet (Chain ID `1`):

| Asset Symbol | Asset Description | EVM Contract Address | Uniswap API Quote Status | Multi-Hop Routing | Output Price / Share |
|---|---|---|---|---|---|
| **NVDAon** | Ondo Tokenized NVIDIA | `0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE` | **HTTP 200 OK** | V3 + V4 Mixed Pool | ~$205.96 USDC |
| **TSLAon** | Ondo Tokenized Tesla | `0xf6b1117ec07684d3958cad8beb1b302bfd21103f` | **HTTP 200 OK** | V3 + V4 Mixed Pool | ~$293.05 USDC |
| **SPYon** | Ondo Tokenized S&P 500 ETF | `0xfedc5f4a6c38211c1338aa411018dfaf26612c08` | **HTTP 200 OK** | V3 + V4 Mixed Pool | ~$727.14 USDC |
| **QQQon** | Ondo Tokenized Invesco QQQ | `0x0e397938c1aa0680954093495b70a9f5e2249aba` | **HTTP 200 OK** | V4 Single-Hop Pool | ~$676.83 USDC |

### Chain Support Notes
1. **Ethereum Mainnet (`1`)**: Deep liquidity and live V3 + V4 multi-hop routing for Ondo "...on" series tokenized equities.
2. **Base Mainnet (`8453`)**: Public ecosystem tokens like `ONDO` (`0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3`) return live quotes cleanly.
3. **Robinhood Chain (`4663`)**: **Fully supported and the richest RWA venue we found.** An earlier revision of this
   document claimed the chain was "not indexed" by the Trading API. That was wrong, and the cause was our own request —
   see §7. Fourteen tokenized equities quote `CLASSIC` against USDG
   (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals) with realistic share prices: NVDA, TSLA, AAPL, MSFT, AMZN,
   GOOGL, META, SPY, QQQ, AMD, PLTR, NFLX, MSTR, COIN. Universal Router on this chain is
   `0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9`.

### Testnet Availability (measured)

The Trading API accepts exactly three testnets — `SEPOLIA` (11155111), `BASE_SEPOLIA` (84532), `UNICHAIN_SEPOLIA`
(1301). Every other testnet we probed, including **Robinhood's own testnet (46630)**, Arbitrum Sepolia, OP Sepolia,
Polygon Amoy, BNB testnet, Fuji, Monad, World Chain Sepolia, Ink Sepolia, Soneium Minato and Zora Sepolia, is rejected
with `RequestValidationError`. Of the three accepted, only **Sepolia actually routes**: Base Sepolia returns 404
no-liquidity even for ETH→USDC, and Unichain Sepolia returns a server-side `APIResponseValidationError`.

**No tokenized stock exists on any of them.** `eth_getCode` returns `0x` for every Ondo, xStocks and Dinari address on
Sepolia and Base Sepolia, and a census of Uniswap factory logs (Sepolia: 7601 v3 + 2159 v4 pools across 9511 tokens;
Base Sepolia: 1764 v3 pools, 0 v4) surfaced no equity tickers. Robinhood's testnet does host real stock tokens
(TSLA, AMD, PLTR, AMZN, NFLX), but that chain has no Uniswap deployment at all — v3 Factory, Universal Router and v4
PoolManager are all absent; only Permit2 is present.

---

## 6. `x-universal-router-version` Silently Kills Whole Chains (`HTTP 404`)

### The Struggle
We pinned `x-universal-router-version: 2.0` on every `/quote` and `/swap` call. On Robinhood Chain this made every
request return:
```json
HTTP/2 404 Not Found
{"errorCode":"ResourceNotFound","detail":"No quotes available"}
```
…for pairs with over **$1.2M of live Uniswap v3 and v4 liquidity**. We spent real time concluding the chain was
unsupported and wrote that conclusion into this document.

### Isolation
Holding the request body constant and toggling one field at a time against `USDG → NVDA` on chain 4663:

| variant | result |
|---|---|
| baseline | **200 CLASSIC** |
| `+ protocols: ["V2","V3","V4"]` | **200 CLASSIC** |
| `+ routingPreference: "BEST_PRICE"` | **200 CLASSIC** |
| `+ integratorFees` | **200 CLASSIC** |
| `+ x-permit2-disabled: true` | **200 CLASSIC** |
| `+ x-universal-router-version: 2.0` | **404 ResourceNotFound** |

The header alone is the cause. Omitting it lets the API select a router version supported by each chain.

**Constructive Feedback:**
- When a pinned Universal Router version is not available on the requested chain, return
  `HTTP 400 UnsupportedRouterVersion` naming the versions that chain does serve. A `404 ResourceNotFound` reading
  "No quotes available" is indistinguishable from genuinely absent liquidity and sends integrators down the wrong path.
- Document per-chain Universal Router version support in the Supported Chains table.
- Consider ignoring the header with a warning rather than failing closed, since the default (no header) works fine.

---

## 7. Summary of Key Recommendations for Uniswap Labs

1. **Stop overloading `404 ResourceNotFound`.** It currently means at least three different things: no liquidity, an
   identical token pair (§3), and an unsupported Universal Router version on the target chain (§6). The last one cost us
   the most time and led us to publish a false claim that Robinhood Chain was unindexed. Distinct error codes for each
   would have saved every hour of it.
2. **Clear Gateway Routing Error Messages**: Return standard redirect or clear error messages when API keys hit `api.uniswap.org/v2` instead of `trade-api.gateway.uniswap.org/v1`.
3. **Explicit Same-Asset Pair Guard**: Return `HTTP 400 Bad Request` for `tokenIn === tokenOut` instead of generic `404 No quotes available`.
4. **Explicit Fee Metadata**: Consistently include `portionAmount` / `feeAmount` in top-level response JSON when fee parameters are passed.
5. **Atomic Unit Guidance**: Highlight atomic integer unit requirements (`parseUnits`) in the API reference code samples.
6. **Document per-chain router versions and testnet reality.** The Supported Chains table lists three testnets without
   noting that only Sepolia routes, and that Base Sepolia and Unichain Sepolia are effectively unusable.

---

*This document was generated automatically from empirical integration logs and codebase verification during the Leg Agent hackathon development cycle.*
