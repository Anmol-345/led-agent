# Implementation Plan

- [ ] 1. Foundation: establish the advisor runtime and durable boundaries
- [x] 1.1 Establish advisor configuration, persistence, and content baseline
  - Add advisor-owned tables and a committed forward-only SQL migration in the shared Node `node:sqlite` sequence at `CREDIT_DATABASE_PATH` for quote, run, citation, calculation, recommendation, checkup, and OAuth state, with wallet/correlation/due-time uniqueness; include the records in the host-local backup/restore rehearsal.
  - Add validated server-only configuration for 0G Router, FMP access, freshness, fixed pricing/context bounds, connector OAuth, and checkup scheduler; publish philosophy v1 for all seven investors and research limitations.
  - Observable: missing/invalid runtime values or unavailable FMP access prevent an advisor quote/run, while philosophy v1 identifies every required investor and research boundary.
  - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 10.2, 10.3_
  - _Boundary: Advisor configuration, persistence, and philosophy_

- [x] 1.2 Establish the server-only Customer Credits adapter
  - Import only the upstream `VerifiedCreditAction` and ledger handoff contracts; do not access credit database, vault, credential, or provider implementation details.
  - Define the advisor correlation, integer micro-USDC quote, context-hash, authorization, and finalization boundary for `serviceType: "advisor"`.
  - Observable: an advisor caller can only supply a matching verified action and normalized three-component completion; a public caller cannot submit provider amounts or mutate credits.
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 10.3_
  - _Boundary: Advisor credit adapter_
  - _Depends: 1.1_

- [x] 2. Core advisor components
- [x] 2.1 (P) Build the private FMP gateway and citation facts
  - Fetch only method-required financial bundles through the server-side key, normalize fields, and retain symbol, period/observation, source, and retrieval time.
  - Return redacted unavailable states for missing, ambiguous, or stale data without exporting raw payloads or provider paths.
  - Observable: a requested fundamental returns a cited normalized fact or an explicit unavailable reason, never a key, raw FMP response, or fabricated value.
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_
  - _Boundary: FMP gateway_
  - _Depends: 1.1_

- [x] 2.2 (P) Build pure deterministic valuation tools
  - Implement the fixed versioned Graham number, margin of safety, owner earnings, Greenblatt earnings yield, and return-on-capital methods using normalized inputs.
  - Preserve method/formula version, inputs, periods, result, and source references; return unavailable for stale, missing, inconsistent, zero, or non-positive required values.
  - Observable: identical valid inputs produce the same result and an invalid denominator produces a named unavailable result rather than a substituted calculation.
  - _Requirements: 3.1, 3.3, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: Valuation tools_
  - _Depends: 1.1_

- [x] 2.3 (P) Build selected wallet portfolio reads
  - Read only configured supported token balances for the authenticated wallet using viem and preserve chain, token, amount, read time, and research mapping state.
  - Mark unsupported, unreadable, or unmapped selections unavailable/unvalued without inferring ticker, price, issuer eligibility, or trade availability.
  - Observable: no portfolio path requests a private key, transaction approval, or custody permission and an unrecognized asset remains explicitly unvalued.
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Portfolio reader_
  - _Depends: 1.1_

- [x] 2.4 Build the 0G Router adapter and bounded research orchestrator
  - Quote every prepared-context segment, bounded tool-result capacity, and completion allowance before action authorization; reject changed/over-budget context rather than silently truncating it.
  - Authorize the matching correlation before FMP/0G calls, invoke one capped Router model, render sourced facts/calculations/generated interpretation/limitations, and finalize normalized actual usage exactly once.
  - Preserve pre-provider rejection, provider failure, invalid Router response, and delayed-usage outcomes without direct credit mutation; record only redacted operational evidence and genuine 0G integration findings.
  - Observable: an expired, declined, mismatched, or unavailable authorization makes zero provider calls; a completed run cites its facts/calculations/philosophy version and a failed run has no fabricated answer.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 5.4, 10.1, 10.2, 10.3_
  - _Boundary: Advisor orchestrator and 0G Router adapter_
  - _Depends: 1.2, 2.1, 2.2, 2.3_

- [x] 2.5 Build wallet-bound expiring research recommendations
  - Create `ValueInvestingRecommendation.v1` only from a completed research run and retain its stable ID, wallet, asset reference, stance, thesis, cited evidence, calculation references, risks, generated time, and expiry.
  - Validate exact shape, version, wallet association, and expiry before returning the immutable handoff; explicitly exclude order construction, signing, routing, eligibility, price guarantees, and confirmation.
  - Observable: an expired, malformed, unsupported, or wrong-wallet recommendation is rejected and cannot be replaced by free-form chat text.
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - _Boundary: Recommendation store_
  - _Depends: 1.1, 2.4_

- [x] 3. Integration: expose the shared customer experience
- [x] 3.1 Replace generic chat with authenticated advisor web research
  - Reuse the existing accessible chat shell for advisor input, selected-holding disclosure, philosophy/citation/calculation distinctions, quote maximum, action authorization, result, limitation, and retry states.
  - Connect the web quote/run path to the shared orchestrator; remove the generic Gemini fallback rather than retaining a second uncited response path.
  - Observable: a valid web request and equivalent connector request receive the same research semantics, while an invalid/missing authorization exposes only an actionable non-provider state.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.4, 3.1, 3.2, 3.3, 3.4, 6.1, 6.3, 8.1_
  - _Boundary: Advisor web API and UI_
  - _Depends: 2.4, 2.5_

- [x] 3.2 Add customer-controlled checkups and pending scheduler work
  - Provide wallet-scoped create/change/pause/delete/inspect operations for selected holdings and cadence, and a protected scheduler that idempotently creates pending checkups only.
  - Route a customer-authorized pending checkup through the same cited quote/run path; paused, deleted, declined, or unapproved checkups never call FMP/0G or debit credit.
  - Observable: a due active checkup appears pending with its selected holdings, and only a fresh matching advisor authorization can move it to completed.
  - _Requirements: 2.1, 2.3, 2.4, 6.1, 7.1, 7.2, 7.3, 7.4, 10.3_
  - _Boundary: Checkup service and protected scheduler_
  - _Depends: 1.1, 2.4, 3.1_

- [x] 3.3 Add the OAuth-bound shared MCP connector
  - Pin the MCP SDK and expose one public Streamable HTTP endpoint with OAuth 2.1/PKCE, dynamic registration, verified metadata/redirect/host, token expiry/revocation, and Customer Credits read-account wallet binding.
  - Expose only bounded research, portfolio, checkup, and recommendation tools. Billable connector work returns a quote-specific browser action until a fresh `authorize-advisor` action is completed, then uses the shared orchestrator.
  - Observable: an expired, cross-wallet, invalid-host, or unsupported-capability connector request returns a bounded error and starts no paid provider or trading action.
  - _Requirements: 2.1, 2.3, 2.4, 6.1, 7.1, 8.1, 8.2, 8.3, 8.4, 9.2, 10.3_
  - _Boundary: MCP connector and OAuth session state_
  - _Depends: 1.1, 1.2, 2.4, 2.5_

- [x] 4. Validation: prove research, billing, and transport safety
- [x] 4.1 Verify deterministic/provider/credit boundary behaviour
  - Add focused tests for every valuation precondition, FMP availability/freshness/redaction, quote context limits, action/correlation replay, no-provider rejection, exact success/failure component finalization, Router invalid output, and redacted operational logs.
  - Confirm observed 0G integration findings use the required redacted feedback format only when a real condition is exercised.
  - Observable: tests fail if a provider runs before authorization, a calculation changes for identical input, an unavailable source is invented, or a secret/raw payload escapes.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 10.1, 10.2, 10.3_
  - _Boundary: Advisor orchestrator, FMP gateway, valuation tools, and Router adapter_
  - _Depends: 2.1, 2.2, 2.4_

- [x] 4.2 Verify portfolio, checkup, recommendation, web, and connector critical flows
  - Test supported/unmapped/read-failed holdings, no-custody reads, opt-in/pause/delete/due/authorize checkup transitions, recommendation expiry/wallet binding, and web/MCP semantic parity.
  - Exercise OAuth PKCE, token expiry/revocation, client/redirect/host rejection, connector action reauthorization, and the absence of a trade execution path.
  - Observable: the end-to-end suite proves one wallet cannot access another's research/checkups/recommendations and a due checkup remains unbilled until the customer completes its own authorization.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4_
  - _Boundary: Portfolio reader, checkup service, recommendation store, web API, and MCP connector_
  - _Depends: 3.1, 3.2, 3.3, 4.1_

## Implementation Notes

- 1.1: design.md names `node:sqlite`, but the shared runtime customer-credits actually established is
  Prisma 7.8 + `@prisma/adapter-better-sqlite3` with forward-only Prisma migrations at
  `CREDIT_DATABASE_PATH`. Advisor models therefore live in `packages/nextjs/prisma/schema.prisma` and
  the SQL in `prisma/migrations/20260726040000_initial_advisor_schema/`, not in
  `lib/advisor/migrations.ts`. A second migration authority on the same file would break
  `verifySqliteStructure` in `lib/credits/db.ts`. Design text needs amending; see revalidation
  triggers.
- 1.1: `lib/advisor/db.ts` reuses the credit client factory but exports `AdvisorPrismaClient` as a
  `Pick<>` of advisor models only, so advisor code structurally cannot read or write a credit table.
  Keep that narrowing when adding models.
- 1.1: `just credits-migrate` now applies the advisor migration too — it is one shared sequence.
- 1.1: run tests with `npx tsx --test "lib/<area>/*.test.ts"` from `packages/nextjs`; plain
  `node --test` cannot resolve the repo's extensionless imports. There is no `test` npm script.
- 1.1: `advisor_checkup_subscriptions` was added beyond design.md's Data Models table; the checkup
  state diagram needs opt-in state (active/paused) separate from instance state
  (pending/completed/skipped).
- 1.1: the upstream credit runtime rejects a `tmpdir()` database path when `NODE_ENV=production`, so
  tests that exercise production gates need a database path outside `tmpdir()`.
- 1.2: **upstream gap for 2.4** — `CreditActionType` in `lib/credits/auth.ts` is only `"read-account"`;
  `CreditAuthService` cannot issue the `authorize-advisor` proof that requirements 2.1/2.3 and the
  design's connector flow assume, even though the Prisma `CreditAction` enum already has
  `AUTHORIZE_ADVISOR`. The adapter therefore binds an action to a quote by wallet + `requestId` ==
  correlation + expiry, which is what the contract supports today. Route the missing action type back
  to the customer-credits spec before task 2.4 starts paid runs; do not add an advisor-local action
  type.
- 1.2: `AdvisorCreditLedger` is `Pick<CreditLedgerService, "prepareAuthorization" | "authorize" |
  "finalize">`. It keeps the adapter inside the handoff contract and lets tests run with a fake
  ledger — no credit database, vault, or RPC. Keep that narrowing.
- 1.2: money never crosses the adapter's public surface. Callers pass measured token counts and an
  `fmpRequested` flag; micro-USDC is derived from the configured rate snapshot with ceiling division.
  Do not add a parameter that accepts a component amount.
- 1.2: the upstream ledger treats `components: null` as *provisional*, not released. To release a
  reservation after a pre-provider rejection, finalize `outcome: "failed"` with all-zero components
  and a `null` provider reference.

- 2.1: **verify before production** — `fieldSources` in `lib/advisor/fmp.ts` is the single table binding
  an advisor field to an FMP bundle and JSON member (`eps`, `operatingIncome`, `bookValuePerShare`,
  `ownersEarnings`, `enterpriseValue`, `propertyPlantEquipmentNet`, `totalCurrentAssets`/
  `totalCurrentLiabilities`, `price`/`timestamp`). FMP's stable docs return 403 to automated fetches,
  so these member names were not confirmed against the live schema. Check them during the
  non-production provider verification step; a rename shows up only here.
- 2.1: the FMP key travels as an `apikey` request header, never a query parameter, so it cannot reach
  a URL or access log. Base URL is `https://financialmodelingprep.com/stable`.
- 2.2: all financial arithmetic is fixed-point bigint at scale 1e8 (`lib/advisor/decimal.ts`), never
  JS floats. Excess precision truncates toward zero. This is what makes identical inputs reproduce a
  result exactly; do not introduce `Number` arithmetic into a formula.
- 2.3: `ADVISOR_SUPPORTED_ASSETS` ships only assets whose mapping is verified — currently Base USDC,
  deliberately unmapped. `PortfolioReader` accepts an injected `assets` table so the mapped path is
  testable without inventing an issuer address; real tokenized-stock mappings arrive with the
  downstream trading spec, which owns issuer eligibility.
- 2.4: the quote reserves `ADVISOR_MAX_TOOL_RESULT_TOKENS` of capacity rather than actual tool output,
  because FMP is itself a paid call that cannot run before authorization. At run time the rendered
  tool results must fit that capacity or the run fails `context` — never truncated after pricing.
- 2.4: `estimatePromptTokens` is a deliberately over-counting character heuristic (marked with a
  `ponytail:` comment). Ceiling: it can reserve more credit than a real tokenizer would. Upgrade to
  the Router model's tokenizer once its vocabulary is pinned.
- 2.4: `startRun` is recorded before the context and authorization checks so every attempt leaves
  redacted evidence and `failRun` always has a row to update.
- 2.4: a source failure releases the reservation (`outcome: "failed"`, all-zero components, null
  provider reference); a provider failure after FMP ran reports the incurred `fmp` component with
  `legService` at zero. Leg never charges its service fee for work that failed.
- 2.5: `validateRecommendationHandoff` takes `unknown`, not a typed artifact — recommendations arrive
  from the database and connector as untrusted data, so compile-time types prove nothing there. Keep
  the runtime type guard.
- 2.4/2.5: no advisor module imports credit db, vault, api, indexer, or generated Prisma except
  `lib/advisor/db.ts`, which narrows the shared client to advisor models.

## Task Plan Review Gate

Task plan review passed locally: all 38 requirement IDs map to executable work; foundation establishes the credit/configuration/persistence prerequisites; parallel core work has separate boundaries; integration keeps web, checkup, and connector responsibilities explicit; and validation covers provider, privacy, billing, wallet, and connector failure paths.
