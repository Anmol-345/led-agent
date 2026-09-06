# Research & Design Decisions

## Summary

- **Feature**: `value-investing-advisor`
- **Discovery Scope**: Complex Integration / Extension
- **Key Findings**:
  - The existing application has a Gemini-backed `/api/chat` route, wallet connection, and public balance reads, but no verified advisor identity, durable advisor data, provider gateway, valuation functions, or connector transport.
  - The 0G Router is the recommended server-side integration: it exposes an OpenAI-compatible endpoint, uses a Leg-owned unified balance and API key, supports provider-price caps, and returns account/usage capabilities. Router and Direct balances are separate, so the advisor must not use Direct subaccounts.
  - FMP's published terms prohibit third-party display or use without a specific agreement. A commercial plan alone is not evidence that customer-facing derived analysis and citations are permitted; production must be gated on the documented written commercial right.
  - One authenticated Streamable HTTP MCP server with OAuth 2.1 is the smallest connector transport shared by ChatGPT and Claude. It must still send wallet-specific paid work through a fresh Customer Credits advisor authorization.

## Research Log

### Existing Leg scaffold and Customer Credits boundary

- **Context**: The advisor must extend the scaffold without introducing another customer account or billing flow.
- **Sources Consulted**: `README.md`, `packages/nextjs/app/api/chat/route.ts`, `packages/nextjs/app/page.tsx`, `packages/nextjs/app/api/balances/route.ts`, `packages/nextjs/lib/wagmi-config.ts`, `.kiro/specs/customer-credits/{requirements,design}.md`.
- **Findings**:
  - The current chat uses `ai` and Gemini, and the page already has a minimal accessible chat interface. Wallet connection uses wagmi/RainbowKit; the balance endpoint trusts a posted address and is not an identity boundary.
  - Scaffold secrets are encrypted in `.env.secrets.encrypted` and are made available only to server commands. The project already has `zod`, viem, Next.js 15, and an indirect MCP SDK through Ampersend.
  - Customer Credits owns `CreditAuthService` and the server-only `CreditLedgerService.authorize` / `finalize` contract. Advisor work must use `serviceType: "advisor"`, a `VerifiedCreditAction`, the credit correlation ID, and normalized micro-USDC `0g`, `fmp`, and `legService` components. It may not import credit persistence, vault, or provider-secret implementation details.
- **Implications**: Reuse the chat page and wallet provider, replace only the generic chat orchestration, and import only the upstream server-only credit interfaces. Keep advisor persistence separate from the credit projection.

### 0G Router integration and metering

- **Context**: The advisor needs decentralized inference while Leg, rather than each customer, owns provider access and credits must cover full context usage.
- **Sources Consulted**: [0G AI Coding Context](https://docs.0g.ai/ai-context), [0G Router overview](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview), [0G Router quickstart](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/quickstart), [0G Router provider routing](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/routing).
- **Findings**:
  - 0G recommends Router for server-side apps. The Router endpoint is `https://router-api.0g.ai/v1`, accepts a Router inference API key, uses a unified Router balance, and provides OpenAI-compatible chat completions. Its Direct SDK path instead requires provider subaccounts and wallet signing; its balance is separate and is unsuitable for this Leg-owned server workflow.
  - Router supports request headers that cap prompt and completion price, a model list, and account balance/usage endpoints. 0G mainnet is chain ID 16661, but this feature uses the Router service and does not introduce a customer on-chain 0G flow.
  - The completion response usage is the final metering source. Before authorization, a conservative context budget must include every system/philosophy, conversation, tool-output, and response token that the run can send. A request whose full prepared context exceeds the policy cap must be rejected before provider work rather than silently truncated after pricing.
- **Implications**: Use one configured Router model and a single server-side `fetch` adapter. Snapshot the configured max prompt/completion price and context budget in the credit quote, set Router price caps, and finalize from the returned usage with the matching snapshot. Append redacted observed issues to `feedbacks/0g.md` during integration.

### FMP commercial data and financial-analysis bundle

- **Context**: The advisor needs cited fundamentals without exposing a key, raw download, or a licence-prohibited data-display path.
- **Sources Consulted**: [FMP stable API documentation](https://site.financialmodelingprep.com/developer/docs/stable), [FMP quickstart](https://site.financialmodelingprep.com/developer/docs/quickstart), [FMP terms of service](https://site.financialmodelingprep.com/developer/docs/terms-of-service), [FMP formula documentation](https://site.financialmodelingprep.com/developer/docs/formula).
- **Findings**:
  - FMP's stable API exposes search, quote, income statement, balance sheet, cash-flow statement, TTM key-metrics/ratios, owner earnings, enterprise-value, and financial-score endpoints. Its API key can be supplied in a request header, which avoids putting it in a URL or application log.
  - The public terms restrict sharing credentials, third-party access, commercial analysis, and displaying data in multi-user applications unless specifically approved. The applicable order form/account permission controls the licence scope.
  - Fundamental periods and live price timestamps differ. The advisor must keep retrieved observation time and statement period alongside each normalized value, never present a market price as a filing-period metric, and never persist arbitrary raw provider payloads.
- **Implications**: Gate production FMP calls on an encrypted server key and an operator-set commercial-rights reference that confirms the intended customer-facing derived/cited use. Fetch only the analysis bundle required by the selected method, normalize allowed fields in memory, retain source metadata and permitted derived facts only, and return redacted errors.

### Deterministic value-investing calculations

- **Context**: Generated prose must not be the calculator for a financial conclusion.
- **Sources Consulted**: The FMP statement/metrics documentation above; project brief and roadmap; published formula descriptions linked by FMP.
- **Findings**:
  - The required first-release methods can be calculated from the targeted FMP bundle without a scoring framework: Graham number (`sqrt(22.5 × EPS × book value per share)`), margin of safety against a stated intrinsic value, owner earnings, Greenblatt earnings yield (`EBIT / enterprise value`), and return on capital (`EBIT / (net working capital + net fixed assets)`).
  - A formula should return an unavailable result when a denominator is zero/non-positive or a required input is absent. Owner earnings is reported separately when FMP supplies it; a fallback must be visibly labelled as an approximation and is not silently interchangeable with reported owner earnings.
- **Implications**: Implement a small pure valuation module with named formula versions, decimal-safe input normalization, explicit preconditions, and calculation references. Do not add a generic rules engine, dynamic formula editor, or model-generated numeric tool.

### Shared ChatGPT and Claude connector

- **Context**: The connector needs a selected transport that works across both target surfaces without duplicating advisor logic or accepting free-form orders.
- **Sources Consulted**: [OpenAI Developers](https://developers.openai.com/) (Apps SDK uses MCP), [OpenAI remote MCP reference](https://platform.openai.com/docs/api-reference/realtime-server-events/conversation/item/input_audio_transcription/completed), [Anthropic MCP connector](https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector), [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization), [MCP transport changes](https://modelcontextprotocol.io/specification/2025-03-26/changelog), and the installed `@modelcontextprotocol/sdk` declarations.
- **Findings**:
  - ChatGPT Apps and Claude support MCP. Claude's remote connector requires a publicly reachable HTTP server and supports Streamable HTTP/OAuth. MCP Streamable HTTP replaced the prior HTTP+SSE transport and MCP authorization specifies OAuth 2.1, PKCE, Authorization Server Metadata, bearer authorization on every request, and 401 for invalid/expired tokens.
  - The installed SDK has Node Streamable HTTP transport and OAuth server contracts, including dynamic registration, token issuance/revocation, protected-resource metadata, host/origin checks, and token verification. It expects Node request/response objects, which fit a Node-runtime Next Pages API route better than an App Router web `Request` adapter.
  - An OAuth connector token proves a connector session, not authority to debit credits. The Leg authorization page can bind a connector token to a wallet through the existing `read-account` Credit Auth action; every paid research run still requires a quote-specific `authorize-advisor` action and ledger preflight.
- **Implications**: Select one public HTTPS Streamable HTTP MCP endpoint plus OAuth 2.1/PKCE and dynamic client registration; expose only `quote_advisor_research`, `run_advisor_research`, `read_portfolio`, `manage_checkups`, and `get_recommendation` tools. Use a Next Node Pages API adapter and promote the existing MCP SDK to a direct locked dependency.

### Scheduled portfolio checkups

- **Context**: The roadmap requires opt-in checkups, but the upstream credit contract requires a fresh authenticated advisor action before every billable provider request.
- **Sources Consulted**: `.kiro/specs/customer-credits/requirements.md` requirements 3 and 7, `.kiro/specs/customer-credits/design.md` Credit Authentication and Credit Ledger Service contracts, and this feature brief.
- **Findings**:
  - Customer Credits has no recurring-debit or subscription authorization. Its advisor authorization is action-bound, short-lived, correlation-specific, and must reserve the disclosed maximum before provider work.
  - A scheduler may safely create an unbilled pending checkup and notify the customer, but it cannot invoke FMP or 0G or settle a charge without a fresh customer action.
- **Implications**: An opt-in subscription stores selected assets and cadence only. Due work creates a pending review; the customer opens it, receives a normal advisor quote, completes the normal credit action, and then receives the same analysis as interactive chat. This avoids changing the account/ledger model or silently debiting credit.

### Shared host-local SQLite persistence

- **Context**: Advisor runs, citations, recommendations, checkups, and connector state require durable records that share Customer Credits' persistent Node host.
- **Sources Consulted**: Customer Credits design and [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
- **Findings**: The persistent Node server host uses Node's built-in `node:sqlite` against the file named by `CREDIT_DATABASE_PATH`. Versioned SQL migrations are committed and applied forward-only, and host-local backup/restore protects durable records.
- **Implications**: Advisor-owned tables share `CREDIT_DATABASE_PATH` while remaining separate from credit tables. Apply the committed migration before advisor traffic and include the advisor records in local backup/restore rehearsals.

## Selected Architecture

- One server-side advisor orchestrator prepares context, calls the upstream credit handoff, fetches normalized FMP data, runs pure valuations, calls 0G, and returns a cited artifact for web, MCP, and checkups.

## Design Decisions

### Decision: Preserve Customer Credits as the sole billing controller

- **Context**: Paid advisor work consumes 0G and FMP resources but the upstream specification owns customer balances and durable usage accounting.
- **Selected Approach**: The advisor requests a quote, obtains the upstream `VerifiedCreditAction`, calls `CreditLedgerService.authorize` before FMP/0G work, and calls `finalize` with normalized `0g`, `fmp`, and `legService` micro-USDC components exactly once.
- **Rationale**: It maintains the shared reservation cap and all customer accounting invariants.
- **Trade-offs**: Checkups require a user action per billable run; the advisor must prepare its full context bound before authorization.
- **Follow-up**: Validate an authorization timeout and idempotency retry against the upstream implementation before enabling production providers.

### Decision: 0G Router plus conservative full-context pricing

- **Context**: The provider must be Leg-owned, metered, and unable to exceed the displayed customer maximum.
- **Selected Approach**: Use one pinned Router model. Quote the complete prepared request context and configured completion allowance, cap Router request prices, and use returned usage with the immutable quote rate snapshot for finalization.
- **Rationale**: Router is the documented server-side path and the quote covers the same full context the service sends.
- **Trade-offs**: Conservative budgeting can reserve more than final use; unused credit is released by Customer Credits.
- **Follow-up**: Measure Router usage semantics and record any mismatch or undocumented behavior in `feedbacks/0g.md`.

### Decision: One standards-based MCP connector with OAuth wallet binding

- **Context**: ChatGPT and Claude must reach the same advisor behavior without sharing cookies or provider credentials.
- **Selected Approach**: Public Streamable HTTP MCP with OAuth 2.1/PKCE. OAuth authorization binds the connector session to a wallet through Customer Credits' `read-account` proof. Billable tools return a quote-specific action URL and cannot run until a fresh `authorize-advisor` proof is consumed.
- **Rationale**: It is the supported common protocol and preserves the credit action boundary.
- **Trade-offs**: The first connector run requires a browser redirect; this is intentional user control rather than a hidden recurring grant.
- **Follow-up**: Exercise dynamic client registration and both ChatGPT/Claude connection flows in a non-production environment.

### Decision: Small pure valuation module and immutable recommendation artifact

- **Context**: Value calculations and the downstream trade seam need repeatability independent of chat prose.
- **Selected Approach**: Ship five named formula versions with explicit unavailable states. Persist a wallet-bound, expiring `ValueInvestingRecommendation.v1` only when a response offers a possible trade research stance.
- **Rationale**: It gives users inspectable numbers and gives trading a narrow, validated handoff without taking trading responsibility.
- **Trade-offs**: New formulas require a later spec/version; no generic formula language is included.
- **Follow-up**: Confirm the downstream trading spec consumes the exact artifact and adds its own eligibility, route, quote, and confirmation controls.

## Risks & Mitigations

- FMP entitlement does not permit displayed derived research — retain the signed commercial-rights reference, gate production requests, and do not infer permission from a plan name.
- Router usage/pricing behavior differs from documented assumptions — send request price caps, retain a quote snapshot and redacted usage evidence, fail closed, and log progressive findings in `feedbacks/0g.md`.
- Full advisor context exceeds an affordable budget — quote the whole prepared context before authorization and require the customer to shorten/start a fresh context instead of truncating after approval.
- MCP OAuth or dynamic registration is abused — validate PKCE, redirect URI/client metadata, resource binding, scope, expiry, token revocation, host/origin, and use rate limits; test invalid and cross-wallet tokens.
- Token metadata is spoofed or lacks a recognized financial mapping — display the raw selected chain/token/balance as unvalued and never infer ticker, issuer eligibility, or trade availability.
- Scheduled checkups silently spend credits — make due checks pending only and require the normal fresh credit action before any paid provider call.

## References

- [0G AI Coding Context](https://docs.0g.ai/ai-context) — Router/server-side recommendation, endpoint, usage, and pricing-cap capabilities.
- [0G Router overview](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview) — Router configuration and account capabilities.
- [FMP stable API documentation](https://site.financialmodelingprep.com/developer/docs/stable) — targeted financial-statement, quote, metric, score, and owner-earnings endpoints.
- [FMP terms of service](https://site.financialmodelingprep.com/developer/docs/terms-of-service) — commercial and third-party-display licence gate.
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization) — OAuth 2.1, PKCE, metadata, bearer-token requirements.
- [OpenAI Developers](https://developers.openai.com/) — Apps SDK/MCP integration direction.
- [Anthropic MCP connector](https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector) — remote HTTP/SSE connector and OAuth support.
- [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) — file-backed `DatabaseSync`, migration, and host-runtime constraints.
