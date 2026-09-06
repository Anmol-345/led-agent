# Brief: value-investing-advisor

## Problem

Investors need practical, wallet-aware value-investing guidance rather than generic chat. Leg must apply defined legendary-investor philosophies, assess licensed financial fundamentals, and explain portfolio health while charging fairly for the provider resources it consumes.

## Current State

The scaffold has a Gemini-based chat route, wallet connection, and basic on-chain balance/data pages. It has no 0G inference, FMP gateway, investment philosophy, valuation tools, portfolio analysis, customer billing, scheduled health checkups, or external connector.

## Desired Outcome

After credit authorization, a customer can chat with Leg through leg-agent.xyz and a connector-compatible interface. Leg applies its Markdown investment philosophy, uses 0G inference and the licensed server-side FMP gateway, runs defined valuation/screening tools, considers on-chain holdings, and offers opt-in portfolio-health checkups.

## Approach

Keep orchestration, FMP access, billing authorization, and connector transport in Leg's application service. Use 0G Compute Router for inference, static Markdown for philosophy, small deterministic valuation tools over FMP responses, and on-chain address reads for holdings. The connector protocol is selected during requirements from the target ChatGPT/Claude surfaces.

## Scope

- **In**: Leg philosophy Markdown, 0G inference integration, private FMP gateway, valuation/screening tools, wallet portfolio reads, opt-in checkups, web chat, connector endpoint, citations/explanations, and credit metering.
- **Out**: Downloadable FMP datasets, client-side FMP access, automatic trades, custody, legal investment-advisor registration, and World verification.

## Boundary Candidates

- Billable advisor-request orchestration and provider gateway.
- Deterministic financial-analysis tools and their input/output contracts.
- Chat surfaces and connector transport, sharing one server-side advisor API.

## Out of Boundary

- Customer-credit balance implementation, Uniswap order execution, issuer allowlists, and World trade eligibility.

## Upstream / Downstream

- **Upstream**: Customer credits for authorization and usage accounting; FMP commercial licence.
- **Downstream**: Tokenized-stock trading consumes an explicit recommendation/order-intent boundary, never free-form chat text.

## Existing Spec Touchpoints

- **Extends**: None.
- **Adjacent**: Existing chat route, wallet providers, Graph client, balance/data pages, and Agent0 identity are starting points rather than complete solutions.

## Constraints

FMP use is licensed, server-side only, and never exposed for download. Count full 0G context usage when pricing. Document 0G integration bugs, undocumented behavior, workarounds, reproduction, and resolution in `feedbacks/0g.md` progressively.

Durable records use Customer Credits' shared file-backed local SQLite database on the same persistent Node server host. The feature uses Node's built-in `node:sqlite` at `CREDIT_DATABASE_PATH`, contributes committed forward-only migrations, and participates in host-local backup/restore.
