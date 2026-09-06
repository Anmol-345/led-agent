# Brief: world-trade-credential

## Problem

Tokenized-stock trading benefits from a friction and anti-bot check before a customer executes through Leg. The optional World Selfie Check must be bound to the connected wallet and cannot be mistaken for regulatory KYC or issuer eligibility.

## Current State

The scaffold has no World ID SDK, proof-request backend, proof verification, nullifier storage, wallet signal binding, or trade-executor check.

## Desired Outcome

Once core trading works, a customer can complete the current World Selfie Check credential flow and have the verified result bound to their wallet. Controlled Leg trades can enforce that verification when the bonus gate is enabled.

## Approach

Use the current World IDKit v4 proof flow: Leg creates a server-side request bound to the connected-wallet signal, the customer completes it in World App, and Leg verifies the proof server-side and records a durable eligibility attestation/nullifier. The controlled Leg executor checks that eligibility; a frontend-only check is insufficient.

## Scope

- **In**: World Credential 11 request/response flow, wallet-bound signal, server-side proof verification, nullifier/attestation handling, user status, optional controlled-executor gate, and progressive feedback documentation.
- **Out**: Government-ID KYC, AML, sanctions, accreditation, suitability, jurisdiction eligibility, and preventing customers from directly using third-party Uniswap interfaces.

## Boundary Candidates

- World proof lifecycle and server-side verification.
- Wallet eligibility record and controlled trade-executor authorization check.

## Out of Boundary

- Token routing, trade fee calculation, credit accounting, financial advice, and issuer compliance decisions.

## Upstream / Downstream

- **Upstream**: Customer wallet identity and the controlled trading boundary.
- **Downstream**: A production configuration may make the verified-attestation check mandatory for Leg-executed trades.

## Existing Spec Touchpoints

- **Extends**: None.
- **Adjacent**: The existing Agent0 identity page is unrelated to World customer credentials.

## Constraints

Selfie Check is beta and a liveness/Sybil signal, not KYC. Use World IDKit v4 and its current verify API; do not use archived pre-v4 examples. Document integration bugs, unexpected behavior, workarounds, reproduction, and resolution in `feedbacks/world.md` progressively.

Durable records use Customer Credits' shared file-backed local SQLite database on the same persistent Node server host. The feature uses Node's built-in `node:sqlite` at `CREDIT_DATABASE_PATH`, contributes committed forward-only migrations, and participates in host-local backup/restore.
