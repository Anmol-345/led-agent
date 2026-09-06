# Research & Design Decisions

## Summary

- **Feature**: `tokenized-stock-trading`
- **Discovery Scope**: Complex integration, limited to existing wallet seams and official Uniswap documentation.
- **Key Findings**:
  - The Trading API returns distinct Classic and UniswapX route shapes; Classic routes use `/swap`, while UniswapX orders have independently queryable terminal status.
  - The current API supports a request-scoped integrator fee in the quote request and encodes that fee into returned execution data.
  - A direct configured fee-recipient address removes the need for a v4 hook, a fee-receiver contract, a withdrawal flow, or a Customer Credits trade charge.

## Research Log

### Existing Scaffold Boundaries

- **Context**: The feature must extend the current Next.js, wagmi, viem, and shared local SQLite seams without creating a second wallet or using `AgentWallet` for customer funds.
- **Sources Consulted**: `packages/nextjs/lib/wagmi-config.ts`, `packages/nextjs/app/identity/page.tsx`, `packages/nextjs/contracts/deployedContracts.ts`, and `packages/foundry/src/AgentWallet.sol`.
- **Findings**:
  - `wagmiConfig` supplies RainbowKit/wagmi chains and the identity page has an explicit chain-switch pattern.
  - `AgentWallet` permits its owner or agent to call arbitrary targets and is unsuitable for customer trade authority.
  - Customer Credits owns `CreditAuthService`; its `read-account` action yields a wallet-bound, short-lived `VerifiedCreditAction` without authorizing a debit. The Advisor owns `ValueInvestingRecommendation.v1` and validates its exact wallet binding and expiry on handoff.
  - The scaffold has no Trading API client, trade persistence, credit-vault integration, fee recipient, or v4 hook implementation.
- **Implications**: Trading consumes only a `read-account` wallet identity and a read-only Advisor recommendation handoff through explicit adapters. It never changes `AgentWallet`, holds a customer key, or reads or writes Customer Credits balances.

### Uniswap Trading API Route and Fee Semantics

- **Context**: Quotes must be server-validated, route-aware, and charge exactly one 10 bps Leg fee.
- **Sources Consulted**: [Swapping API integration guide](https://developers.uniswap.org/docs/trading/swapping-api/integration-guide), [Swapping FAQ](https://developers.uniswap.org/docs/trading/swapping-api/faqs), [quote API reference](https://developers.uniswap.org/docs/api-reference/aggregator_quote), and [request-scoped integrator fees](https://developers.uniswap.org/docs/changelog/active-notifications/setting-a-fee-through-the-api).
- **Findings**:
  - A top-level routing discriminator determines the execution path: Classic-style routes use `/swap`; UniswapX routes use their order flow and status endpoints.
  - An integrator may request one fee in basis points and a recipient in `/quote`; the API returns fee information in the quote and encodes it in the action returned for execution.
  - The API documentation currently uses both singular and plural integrator-fee names in prose. The current OpenAPI document is authoritative for implementation; the discrepancy is recorded in `feedbacks/uniswap.md`.
  - The API permits a customer output recipient distinct from the swapper, but Leg must set and verify the authenticated customer wallet as the customer recipient.
- **Implications**: The server owns the Trading API key and quote lifecycle. Every eligible quote requests the current OAS-defined 10 bps integrator fee to `LegIntegratorFeeRecipient`; a route that cannot prove the exact customer recipient and fee is unavailable. There is no hook or credit fallback.

### Shared host-local SQLite persistence

- **Context**: Trade quotes, receipts, and fee evidence need durable server state that shares Customer Credits' persistent Node host.
- **Sources Consulted**: Customer Credits design and [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
- **Findings**: The persistent Node server host uses Node's built-in `node:sqlite` against the file named by `CREDIT_DATABASE_PATH`. Versioned SQL migrations are committed and applied forward-only, and host-local backup/restore protects durable records.
- **Implications**: Trade-owned tables share `CREDIT_DATABASE_PATH` while remaining separate from credit tables. Apply the committed migration before trade traffic, include the trade records in local backup/restore rehearsals, and store EVM token amounts as validated canonical base-10 text because SQLite `INTEGER` cannot represent all `uint256` values.

## Selected Architecture

- A server quote guard validates and stores each typed quote while the customer signs every action from their own wallet.
- The Uniswap API applies one 10 bps output-token integrator fee to the configured recipient when the route supplies verifiable fee evidence.

## Design Decisions

### Decision: One API-native integrator fee for every trade

- **Context**: Leg needs a transparent 10 bps trade charge without degrading routing or adding a custom on-chain component.
- **Selected Approach**: Every eligible quote supplies the current OAS-defined integrator-fee request at 10 bps with the configured direct recipient address. The quote/action parser verifies the returned recipient, token, amount, and evidence before the wallet is asked to act.
- **Rationale**: The API encodes the charge in the customer-confirmed route, giving one fee and no additional settlement path.
- **Trade-offs**: Availability is reduced when the API cannot return verifiable fee data.
- **Follow-up**: Contract-test current OAS fixtures before implementation and record genuine provider issues in `feedbacks/uniswap.md` only when observed.

### Decision: Customer wallet is the only trade-output recipient

- **Context**: The API supports custom recipients, but Leg has no custody scope.
- **Selected Approach**: Quote requests set the authenticated wallet as customer recipient and validation requires it in every Classic output and every UniswapX order output.
- **Rationale**: This removes a recipient-redirection class without a custody contract.
- **Trade-offs**: Smart-account funding and third-party settlement require a future specification.

## Risks & Mitigations

- API response or OAS drift — validate exact runtime parsers against a current OAS fixture and fail closed on an unrecognized fee or route shape.
- Issuer restriction change — use an explicit per-chain registry revision and invalidate prior quotes on revision change.
- Quote or route tampering — persist a canonical request hash, validated execution payload, expiry, customer recipient, and integrator-fee evidence; never accept client calldata.
- UniswapX is not immediate settlement — keep its receipt pending until its terminal status and related on-chain reference are recorded.

## References

- [Uniswap developer index](https://developers.uniswap.org/llms.txt) — canonical documentation index.
- [Swapping API integration guide](https://developers.uniswap.org/docs/trading/swapping-api/integration-guide) — route discriminators, endpoints, monitoring, and client/server responsibilities.
- [Swapping FAQ](https://developers.uniswap.org/docs/trading/swapping-api/faqs) — supported routes, fees, chain constraints, and API behavior.
- [Setting a fee through the API](https://developers.uniswap.org/docs/changelog/active-notifications/setting-a-fee-through-the-api) — request-scoped integrator-fee semantics.
