# Implementation Plan

- [x] 1. Establish the trading foundation

- [x] 1.1 Define the validated trading vocabulary and reviewed asset registry
  - Define exact wallet, amount, recommendation, asset, quote, route, 10 bps integrator-fee, order, receipt, and error contracts without unsafe types or assertions, including adapters that accept only Customer Credits `read-account` identity and Advisor `ValueInvestingRecommendation.v1` handoffs.
  - Add server-only configuration for the 30-second quote ceiling, allowed chains, issuer entries, approved destinations, Uniswap credentials, and direct Leg integrator-fee recipient addresses.
  - Make an invalid, disabled, issuer-step-required, or revision-changed registry entry unavailable before any quote path.
  - Completion is observable when an unexpired `read-account` identity and matching recommendation can reach asset eligibility, while a wrong action, expired/cross-wallet identity, or expired/malformed recommendation returns a specific non-tradeable reason and no trade configuration reads a Customer Credits balance.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.4, 4.1, 7.1, 8.1, 8.2, 9.1, 9.2_
  - _Boundary: Trade Registry, Trading Types and Config_

- [x] 1.2 Add durable quote, order, fee-evidence, receipt, and reconciliation state
  - Add constrained trade-owned tables and a committed forward-only SQL migration in the shared Node `node:sqlite` sequence at `CREDIT_DATABASE_PATH`, with wallet scope, idempotency, registry revision, typed route kind, immutable fee bps/token/amount/recipient, status transitions, and terminal receipt evidence; include the records in the host-local backup/restore rehearsal.
  - Store EVM token amounts as validated canonical base-10 text rather than SQLite `INTEGER`, which cannot represent every `uint256` value.
  - Enforce one order per quote and at most one terminal integrator-fee evidence record per order without reading or writing Customer Credits tables.
  - Completion is observable when duplicate quote, submission, or reconciliation requests leave one consistent order, fee-evidence, and receipt record.
  - _Requirements: 3.2, 6.1, 6.2, 6.3, 6.4, 7.2, 7.3, 8.1, 8.2, 9.1, 9.2_
  - _Boundary: Trade Repository_

- [x] 1.3 Prepare reviewed Uniswap and wallet-chain prerequisites
  - Configure only issuer-registry chains, RPC aliases, server-only Trading API credentials, OAS fixture validation, and additional wagmi chains needed by the registered assets.
  - Fail startup for missing API key, direct fee-recipient address, approved route destination, or RPC configuration.
  - Completion is observable when development configuration accepts only declared chains and rejects missing fee or route prerequisites before a quote request.
  - _Requirements: 2.1, 3.1, 5.2, 7.1, 9.1, 9.2, 9.3_
  - _Boundary: Chain Configuration, Trading Runtime Configuration_

- [x] 2. Build the server-validated trade workflow

- [x] 2.1 Implement the typed Uniswap quote, action, and status gateway
  - Request only same-chain approved protocols with the authenticated wallet as customer output recipient and the current OAS-defined 10 bps integrator-fee request for every eligible route.
  - Parse Classic and UniswapX responses as separate validated variants; reject bridges, chained routes, unapproved destinations, stale or empty execution data, unsafe orders, unknown response shapes, and a fee token, amount, or recipient that differs from the request.
  - Completion is observable when fixtures produce a valid Classic or UniswapX action only if every wallet, chain, token, customer recipient, deadline, router/reactor, and fee field matches policy.
  - _Depends: 1.1, 1.3_
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 7.1, 7.3, 9.1, 9.2, 9.3_
  - _Boundary: Uniswap Gateway_

- [x] 2.2 Implement the recommendation-to-quote guard
  - Bind a quote to the `read-account` verified wallet identity, exact unexpired `ValueInvestingRecommendation.v1`, registry revision, asset pair, amount, customer recipient, immutable integrator fee, and a maximum 30-second expiry.
  - Persist only quotes that prove the configured 10 bps output-token fee and direct recipient; reject a missing, stale, cross-wallet, unsupported, or fee-mismatched route without a credits, hook, or fee-contract fallback.
  - Completion is observable when a persisted quote has one immutable 10 bps API fee and no invalid or changed quote can reach action preparation.
  - _Depends: 1.1, 1.2, 2.1_
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 3.2, 3.4, 3.5, 4.1, 4.2, 7.1, 7.3, 7.4, 8.1, 8.2, 9.1, 9.2, 9.3_
  - _Boundary: Trade Guard and Orchestrator_

- [x] 2.3 Expose authenticated asset, quote, action-preparation, submission, and receipt APIs
  - Return only the verified wallet's registry entries, quotes, actions, orders, and receipts; never accept browser calldata, customer recipient, fee, or arbitrary provider payload as authority.
  - Require a fresh stored quote before returning an approval, Classic transaction, or UniswapX signing request, and make submissions idempotent and wallet scoped.
  - Completion is observable when expired, invalid, cross-wallet, or mismatched requests fail before a wallet action is returned, while a valid request returns the exact stored action and fee disclosure.
  - _Depends: 2.2_
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.3, 6.3, 7.1, 8.1, 8.2, 9.1, 9.2_
  - _Boundary: Trade API_

- [x] 2.4 Add idempotent order reconciliation, fee evidence, and truthful receipts
  - Reconcile Classic receipts through the selected RPC and UniswapX order states through the status API without resubmitting a trade or treating order acceptance as settlement.
  - Persist terminal receipt and one fee-evidence record only when the terminal route matches the stored 10 bps token, amount, recipient, chain, and order reference; preserve pending state during dependency outage or fee mismatch.
  - Completion is observable when the customer can retrieve one wallet-scoped receipt that distinguishes pending, reverted, accepted, open, filled, expired, cancelled, and failed outcomes without a false fee claim.
  - _Depends: 1.2, 2.1, 2.3_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.2, 7.3, 8.1, 8.2, 9.1, 9.2_
  - _Boundary: Trade Repository and Reconciler_

- [x] 3. Deliver the customer confirmation and receipt experience

- [x] 3.1 Build the eligibility and quote review experience
  - Show recommendation boundary language, issuer-chain availability, unavailable reasons, exact input/output limits, route kind, customer recipient, one 10 bps fee amount/token/recipient, expiry countdown, and pending or terminal status.
  - Remove an expired or registry-changed quote from the actionable state and require the customer to obtain a new quote.
  - Completion is observable when the interface offers no confirmation control for an unavailable or expired trade, shows exactly one direct API fee, and shows no Customer Credits charge or balance change.
  - _Depends: 2.3_
  - _Requirements: 1.3, 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 6.3, 7.1, 8.2_
  - _Boundary: Trade Panel_

- [x] 3.2 Implement explicit wallet action, chain switch, and receipt handling
  - Require a separate direct customer click for each approval transaction, permit signature, Classic transaction, and UniswapX order signature, after aligning the wallet to the quote chain.
  - Handle rejection, disconnect, timeout, wrong chain, submitted Classic hash, and UniswapX acceptance without auto-submission or automatic retry; poll only the authenticated order status.
  - Completion is observable when a wallet must approve every action itself and the UI accurately distinguishes a Classic confirmation from a pending UniswapX order and a terminal receipt.
  - _Depends: 2.3, 2.4, 3.1_
  - _Requirements: 4.1, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 9.1_
  - _Boundary: Trade Panel, Wallet Execution_

- [x] 4. Validate the complete direct-fee trading boundary

- [x] 4.1 Test server policy, API, and customer-flow rejection paths
  - Cover recommendation, wallet, issuer, and chain binding; registry changes; quote expiry; customer-recipient and fee validation; Classic and UniswapX parsing; duplicate submission; and outage-safe pending state.
  - Include API and UI checks that prove no client input can redirect execution, bypass a per-action customer confirmation, remove or replace the 10 bps API fee, or read/write Customer Credits.
  - Completion is observable when every tested invalid path produces no provider action, no wallet action, no fee-evidence record, and no credit-balance mutation.
  - _Depends: 2.4, 3.2_
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4_
  - _Boundary: Trade API, Trade Panel, Trade Guard_

- [x] 4.2 Verify end-to-end Classic and UniswapX trade lifecycles
  - Rehearse a supported Classic route and a supported UniswapX order with a 10 bps API-native integrator fee, direct recipient evidence, pending-to-terminal reconciliation, and a wallet-scoped receipt.
  - Verify quote expiry, customer rejection, chain switch, fee mismatch rejection, and no Customer Credits balance change in the integrated system.
  - Completion is observable when each successful rehearsal produces exactly one direct 10 bps fee evidence record and a terminal receipt without a hook, fee contract, credit debit, or server-side customer signing.
  - _Depends: 3.2, 4.1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4_
  - _Boundary: Trade Integration_
