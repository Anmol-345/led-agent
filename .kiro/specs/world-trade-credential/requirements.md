# Requirements Document

## Introduction

Leg World Trade Credential lets a customer optionally complete World Selfie Check, Credential 11, and bind its verified result to the wallet already authenticated for Leg Trading. The feature gives Leg a privacy-preserving liveness and Sybil-resistance signal that an operator may require before the controlled Leg trade executor returns a customer wallet action. It does not change the customer's wallet ownership, issuer asset rules, route policy, fee model, or need to confirm every trade action.

## Boundary Context

- **In scope**: Wallet-bound World proof-request and verification lifecycle, minimum credential attestation and replay protection, customer-visible status, an optional hard gate in the controlled Leg trade executor, and progressive observed-issue feedback.
- **Out of scope**: KYC, AML, sanctions, accreditation, suitability, jurisdiction, issuer eligibility, government-ID assessment, biometric-data collection, custody, trading-route changes, and blocking direct use of Uniswap or another third-party interface.
- **Adjacent expectations**: Customer Credits remains the authoritative wallet identity/session provider and grants no World credit-debit authority. Tokenized-Stock Trading retains recommendation, issuer, quote, fee, and customer-confirmation policy; it queries this feature only from its controlled execution path. World Selfie Check is a low-assurance liveness/Sybil signal, not a regulatory or issuer-eligibility determination.

## Requirements

### Requirement 1: Wallet-Bound World Proof Requests

**Objective:** As a customer, I want a World verification request tied to my connected Leg wallet, so that another wallet cannot use or complete my trade credential request.

#### Acceptance Criteria

1. When an already authenticated Leg Trading customer starts World Selfie Check, the Leg World Credential Service shall create one short-lived proof request bound to that exact upstream wallet, a server-generated nonce or session, the configured World action, and a signal for that same request.
2. When a proof request is created, the Leg World Credential Service shall return only the request data needed to open the World flow and shall not expose a World relying-party signing key or let the browser choose the wallet, signal, action, environment, or relying-party identity.
3. If the upstream wallet identity is absent, the request is expired or consumed, or a later submission names a different wallet, the Leg World Credential Service shall reject the request without creating a credential attestation.
4. While a proof request is pending, the Leg World Credential Service shall show it as pending only to its bound wallet and shall not report the wallet as World-verified.
5. The Leg World Credential Service shall describe Selfie Check only as an optional low-assurance liveness and Sybil-resistance signal and shall not present it as KYC, AML, accreditation, suitability, jurisdiction, issuer eligibility, or financial advice.

### Requirement 2: Server-Verified Credential Attestations

**Objective:** As a customer, I want Leg to accept only a valid World result for my request, so that a browser-provided result cannot unlock controlled trade execution.

#### Acceptance Criteria

1. When the Leg World Credential Service receives a completed World result, it shall accept it only for the active bound request after server-side verification confirms the configured action, environment, request nonce, expected signal, and Selfie Check credential result.
2. When a World result verifies successfully, the Leg World Credential Service shall atomically consume the bound request and record a durable, wallet-bound credential attestation containing only the minimum verification evidence and its current validity state.
3. If a World result is invalid, incomplete, expired, duplicated, from the wrong environment, or cannot be verified, the Leg World Credential Service shall create no verified attestation and shall show a retryable or unavailable status without exposing proof contents.
4. When a verified World result contains a nullifier already recorded for the configured action, the Leg World Credential Service shall reject the replay and shall not use it to attest another wallet or a second request.
5. The Leg World Credential Service shall not retain biometric images, video, face templates, raw biometric scores, or raw proof payloads after verification, and shall limit customer-visible and operational records to redacted credential status and minimum audit identifiers.

### Requirement 3: Status and Controlled Leg Trade Gate

**Objective:** As a customer, I want a clear World status and an optional Leg execution gate, so that I know when verification is needed before Leg prepares a trade action.

#### Acceptance Criteria

1. When a customer views the World credential state for their authenticated wallet, the Leg World Credential Service shall show whether it is unverified, pending, verified, expired, rejected, or unavailable and shall provide an appropriate next action without displaying sensitive proof data.
2. Where the operator enables the World trade gate, when the controlled Leg trade executor prepares an approval, transaction, order, or signature request, the Leg World Credential Service shall require a current verified attestation for the same authenticated wallet before that action is returned.
3. If the World trade gate is enabled and the attestation is absent, expired, invalid, or unavailable, the controlled Leg trade executor shall return no actionable wallet request and shall preserve a truthful non-executed trade state that explains World verification is required or unavailable.
4. Where the operator disables the World trade gate, the controlled Leg trade executor shall preserve its existing authenticated recommendation, issuer, route, fee, expiry, and explicit-wallet-confirmation checks without requiring a World attestation.
5. The Leg World Credential Service shall state that the gate applies only to Leg-controlled execution and does not stop a customer from interacting directly with Uniswap or another third-party interface.

### Requirement 4: Fail-Closed Configuration, Privacy, and Feedback

**Objective:** As a Leg operator, I want the World integration to fail safely and leave usable evidence, so that an unavailable or misconfigured credential check cannot silently weaken a mandatory gate.

#### Acceptance Criteria

1. If the configured World application, relying-party identity, action, environment, signing material, server verification service, persistence, or upstream authenticated wallet context is unavailable or inconsistent, the Leg World Credential Service shall reject new World attestations and, when the gate is enabled, shall prevent only new controlled Leg trade actions from being prepared.
2. While the World verification dependency is unavailable, the Leg World Credential Service shall preserve the latest truthful credential and trade status and shall not fabricate a verified state, retry a customer trade action, or alter an existing submitted trade.
3. The Leg World Credential Service shall keep World signing material and verification communication server-side and shall redact credential identifiers from customer-visible errors and operational logs except where a minimal identifier is necessary to investigate an outcome.
4. When an observed World SDK, World App, Developer Portal, or environment behavior causes a bug, undocumented behavior, or workaround, the Leg World Credential Service shall append its redacted reproduction and resolution evidence to `feedbacks/world.md` as the issue is encountered.

## Review Gate

Requirements review passed: all requirement headings and acceptance criteria use numeric IDs and EARS syntax; the scope covers wallet binding, server verification, replay protection, customer state, controlled-executor gating, privacy, and operational failure without prescribing implementation structure. The boundary explicitly excludes regulatory claims, issuer eligibility, and direct-Uniswap blocking.
