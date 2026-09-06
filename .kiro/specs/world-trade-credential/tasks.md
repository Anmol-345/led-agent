# Implementation Plan

- [ ] 1. Establish World credential prerequisites

- [ ] 1.1 Add the reviewed IDKit 4 dependency and fail-closed World policy configuration
  - Add only the current reviewed `@worldcoin/idkit` 4.x direct dependency and lock it; do not add a custom camera, proof library, second wallet provider, or test framework.
  - Validate the server-only World app, RP, action, environment, signing key, attestation-age, and gate-enabled settings before issuing a request or enabling the gate.
  - Observable: missing, public, malformed, or environment-mismatched World settings yield a redacted unavailable result and cannot prepare a gated Leg action.
  - _Requirements: 1.1, 1.2, 3.2, 3.4, 4.1, 4.3_
  - _Boundary: World Configuration_

- [ ] 1.2 Add durable challenge, nullifier, and attestation constraints
  - Create World-owned tables and a committed forward-only SQL migration in the shared Node `node:sqlite` sequence at `CREDIT_DATABASE_PATH`, after the Customer Credits and Trading migrations, with conditional challenge state, a validated canonical base-10 256-bit nullifier string, wallet/action ownership, attestation expiry, and database uniqueness for replay prevention; include the records in the host-local backup/restore rehearsal.
  - Exclude raw signal, RP signature, raw IDKit result, World session ID, image, video, face template, and biometric score from durable records.
  - Observable: the schema permits one current wallet/action attestation and rejects a second use of the same action/nullifier pair.
  - _Requirements: 1.1, 1.3, 2.2, 2.4, 2.5, 3.1, 4.3_
  - _Boundary: World Credential Persistence_

- [ ] 2. Build the server-owned World credential lifecycle

- [ ] 2.1 Issue a wallet-bound Credential 11 request
  - Reuse the authenticated Trading wallet context to create one short-lived challenge, derive its signal from the canonical wallet plus a server nonce, persist the expected commitment, and produce the signed RP request context.
  - Use only the current `selfieCheckLegacy`/legacy-proof compatibility request expected by IDKit 4; never accept a browser-selected wallet, signal, action, RP identity, or environment.
  - Observable: only the authenticated wallet can receive an unexpired request, and a mismatched, consumed, or expired request produces no credential attestation.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.3_
  - _Boundary: World Credential Service_
  - _Depends: 1.1, 1.2_

- [ ] 2.2 Verify World results and atomically create the minimum attestation
  - Conditionally claim one pending challenge, validate its nonce/action/environment/signal commitment and accepted Credential 11 result shape, then forward the unmodified result to World’s configured v4 verifier.
  - Consume the request and write the normalized used nullifier plus same-wallet attestation atomically; duplicate nullifiers, verifier failures, malformed payloads, or unavailable dependencies must remain non-verified.
  - Observable: one valid matching fixture creates one time-bounded attestation, while replay, cross-wallet, wrong-context, and verification-failure fixtures create none.
  - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 4.3_
  - _Boundary: World Credential Service_
  - _Depends: 2.1_

- [ ] 2.3 Expose current redacted credential and enabled-gate state
  - Resolve unverified, pending, verified, expired, rejected, and unavailable states solely from the authenticated wallet, challenge, attestation, and server policy.
  - Make the current-attestation operation fail closed for an enabled gate without changing customer credits, issuer conditions, quotes, fees, existing submitted orders, or direct wallet behavior.
  - Observable: a status request never reveals a proof, signal, nullifier, biometric field, or another wallet's credential state, and a missing current attestation returns a stable required/unavailable error.
  - _Requirements: 2.3, 3.1, 3.3, 3.4, 4.1, 4.2, 4.3_
  - _Boundary: World Credential Service_
  - _Depends: 2.2_

- [ ] 3. Integrate the verified flow with the customer and controlled Leg executor

- [ ] 3.1 (P) Add authenticated request, verify, and status endpoints
  - Route all three operations through the existing verified Trading wallet context, return no-store redacted responses, and accept only a request ID plus the typed IDKit result at verification.
  - Map identity, request-state, verification, gate, and dependency failures to actionable redacted responses without returning signing material or proof contents.
  - Observable: browser-supplied wallet/action/signal/RP/environment fields cannot change the stored request or obtain another wallet's state.
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.3, 3.1, 4.1, 4.2, 4.3_
  - _Boundary: World API_
  - _Depends: 2.3_

- [ ] 3.2 (P) Build the World credential panel
  - Render the standard IDKit request widget from server-issued values and submit its result through server verification before presenting success.
  - Show all redacted credential states, the low-assurance liveness/Sybil description, and the statement that direct Uniswap or third-party interfaces are outside this gate.
  - Observable: a server-rejected verification cannot appear successful in the panel, and the panel exposes no credential identifier, signal, raw proof, or biometric data.
  - _Requirements: 1.2, 1.4, 1.5, 2.3, 3.1, 3.5, 4.3_
  - _Boundary: World Credential Panel_
  - _Depends: 2.3_

- [ ] 3.3 Add the hard gate to controlled trade action preparation
  - Call the current-attestation operation only after the existing Trade Guard validates its authenticated wallet, recommendation, issuer, route, recipient, fee mode, and quote freshness, and immediately before it returns an approval, transaction, order, or signature request.
  - When enabled, return no actionable wallet request for absent, expired, rejected, or unavailable status; when disabled, leave existing Trading behavior unchanged. Keep asset discovery, quote creation, order reconciliation, fee paths, contracts, direct wallet broadcasts, and direct Uniswap outside the gate.
  - Observable: an enabled missing-attestation path returns no prepared action, whereas a matching current attestation reaches the unchanged customer-confirmation path.
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 4.2_
  - _Boundary: Controlled Trade Gate, Trade Orchestrator, Trade Panel_
  - _Depends: 3.1, 3.2_

- [ ] 4. Verify the credential and gate boundaries

- [ ] 4.1 Test request, verification, replay, privacy, and configuration failure paths
  - Run Node native tests through the existing `tsx` runtime with reviewed Credential 11-compatible fixtures and a controlled World verifier response.
  - Cover challenge expiry/consumption, wallet/signal/nonce/action/environment mismatch, concurrent verify attempts, duplicate nullifiers, attestation expiry, no-store redaction, missing configuration, and verifier/database outage.
  - Observable: every invalid path leaves no verified attestation and no stored raw proof/biometric data, while the valid path creates exactly one matching current attestation.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 4.1, 4.2, 4.3_
  - _Boundary: World Credential Service and World API_
  - _Depends: 3.1_

- [ ] 4.2 Verify the controlled-executor integration and record observed provider evidence
  - Test enabled and disabled gate behavior at the existing Trading prepare endpoint, proving no approval, transaction, order, or signature request is returned without a current matching attestation and that all normal Trading validation still applies after it passes.
  - Confirm World has no Customer Credits debit path and that asset discovery, quote display, submitted-order reconciliation, direct wallet execution, and direct Uniswap use are not represented as blocked by World.
  - During real World integration, append each observed bug, undocumented behavior, workaround, reproduction, and resolution to `feedbacks/world.md` with no secret, raw proof, nullifier, or biometric data.
  - Observable: the integration suite distinguishes `world_verification_required` from `world_verification_unavailable`, preserves truthful existing order state, and shows no World-based claim over a third-party Uniswap interface.
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.4_
  - _Boundary: Controlled Trade Gate, Trade API, World Feedback_
  - _Depends: 3.3, 4.1_

## Task Plan Review Gate

Task plan review passed: all requirements map to an executable task; the dependency order makes World configuration and durability precede request/verification, then API/UI, then the single Trading integration point; the two parallel tasks have separate API and UI boundaries; every task has an observable outcome. A bounded local task-graph sanity check found no hidden prerequisite beyond the explicitly recorded World partner/RP setup and completed upstream Customer Credits/Trading seams.
