# Research & Design Decisions

## Summary

- **Feature**: `world-trade-credential`
- **Discovery Scope**: Complex integration and controlled-execution extension.
- **Key Findings**:
  - World Credential 11, Selfie Check, is a low-assurance liveness and facial-similarity Sybil signal. It is not a government-ID, KYC, AML, accreditation, suitability, jurisdiction, or issuer-eligibility result.
  - The current compatible SDK path is IDKit 4.x with `selfieCheckLegacy`, `allow_legacy_proofs: true`, server-generated RP context, and `POST /api/v4/verify/{rp_id}`. Current official documentation states that Selfie Check still returns a legacy World ID 3.0 Face proof while 4.0 support rolls out.
  - Customer Credits already defines the verified wallet/session boundary, while Tokenized-Stock Trading defines the only controlled route-to-wallet-action boundary. The smallest safe addition is a server-side attestation check in trade action preparation; no new wallet login, trade executor contract, or Uniswap integration is needed.

## Research Log

### Credential 11 and IDKit 4 compatibility

- **Context**: The brief requires current World IDKit v4 and Credential 11 guidance.
- **Sources Consulted**: [Selfie Check Credential 11](https://docs.world.org/world-id/credentials/11), [IDKit credentials](https://docs.world.org/world-id/idkit/credentials), [World ID 4.0 migration](https://docs.world.org/world-id/4-0-migration), and [IDKit React](https://docs.world.org/world-id/idkit/react).
- **Findings**: Credential 11 is Selfie Check Beta: a device-camera liveness and facial-similarity signal. The official v4 SDK guide currently uses `selfieCheckLegacy({ signal })` with `allow_legacy_proofs: true`; it returns a legacy Face proof. The React request widget supports the mobile deep-link and desktop QR paths without a custom connector. Credential 11 access is currently limited to select partners.
- **Implications**: Use the current IDKit 4.x React package and legacy-compatibility request only. Do not add a custom camera, collect biometrics, implement invite-code flow, or make regulatory claims. Partner enablement is a release prerequisite, not a reason to substitute another credential.

### Server signing, proof verification, and signal binding

- **Context**: A browser result cannot itself authorize a trade action; the proof must bind to the already authenticated wallet.
- **Sources Consulted**: [IDKit integration guide](https://docs.world.org/world-id/idkit/integrate), [RP signatures](https://docs.world.org/world-id/idkit/signatures), and [Verify API](https://docs.world.org/api-reference/developer-portal/verify).
- **Findings**: World ID 4 requests require an RP context containing RP ID, nonce, creation time, expiry, and a server signature. The signing key must remain server-side. The backend forwards the IDKit result unchanged to `POST https://developer.world.org/api/v4/verify/{rp_id}`. Signals bind app context such as a wallet address and the backend must enforce that value; the v3 completion shape includes a signal commitment and a nullifier.
- **Implications**: The server derives the signal from the authenticated wallet plus a one-time server challenge, persists only the expected commitment and request context, and compares it before granting an attestation. It forwards the received result without field remapping to the World verifier. The browser never supplies authority for the wallet, action, environment, RP ID, or signal.

### Replay protection and minimum retention

- **Context**: A valid proof must not be replayed for another wallet or second request.
- **Sources Consulted**: [IDKit integration guide: store the nullifier](https://docs.world.org/world-id/idkit/integrate#step-6-store-the-nullifier) and [World ID 4.0 migration](https://docs.world.org/world-id/4-0-migration).
- **Findings**: World requires relying parties to persist used nullifiers. The documentation recommends normalizing the 0x-prefixed 256-bit value to a `NUMERIC(78,0)` value and placing a unique constraint on `(action, nullifier)`. SQLite `INTEGER` cannot represent that full range. IDKit v4 distinguishes one-time nullifiers from session continuity; this feature needs neither a World login nor session continuity.
- **Implications**: Persist a validated canonical base-10 nullifier string with an `(action, nullifier)` unique constraint and a minimal wallet attestation atomically. Retain no raw result payload, image, video, face template, Sybil score, or World session ID. A duplicate constraint is a rejection, never an upsert.

### Existing Leg boundaries

- **Context**: World must extend core trading without redefining upstream authorization.
- **Sources Consulted**: `customer-credits` and `tokenized-stock-trading` requirements, design, and task plans; `packages/nextjs/lib/wagmi-config.ts`; `packages/nextjs/package.json`; and `README.md`.
- **Findings**: Customer Credits owns action-bound wallet verification and server-side sessions. Trading consumes that verified wallet context in `Trade API` and `Trade Guard`, then returns only fresh, recipient-bound wallet actions. It is not an on-chain executor and customers can still use a direct Uniswap interface. The repository has no World SDK or application test runner, but the root workspace already includes `tsx`.
- **Implications**: Reuse the upstream authenticated trade context without defining another sign-in, cookie, or wallet-proof flow. Call the World status check only from `lib/trading/orchestrator.ts` during action preparation. Use the existing `tsx` runtime with Node's native test runner instead of adding a second test framework.

### Shared host-local SQLite persistence

- **Context**: World challenge, nullifier, and attestation state must join Customer Credits' durable local database on the persistent Node server host.
- **Sources Consulted**: Customer Credits design and [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
- **Findings**: The persistent Node server host uses Node's built-in `node:sqlite` against the file named by `CREDIT_DATABASE_PATH`. Versioned SQL migrations are committed and applied forward-only, and host-local backup/restore protects durable records.
- **Implications**: World-owned tables share `CREDIT_DATABASE_PATH` while remaining separate from credit tables. Apply the committed World migration after the Customer Credits and Trading migrations, then include the World records in local backup/restore rehearsals.

## Selected Architecture

- The server verifies and persists the World result, then the Trade Guard requires the attestation before Leg returns a controlled action.

## Design Decisions

### Decision: One challenge ties the World signal to the existing trade wallet

- **Context**: The signal must be wallet-bound without asking the customer for another wallet proof.
- **Selected Approach**: Read the authenticated wallet from the existing trade context, create one short-lived server challenge, derive its signal from that canonical wallet and a random challenge nonce, and persist the expected signal commitment, World nonce, action, environment, and expiry.
- **Rationale**: It makes the existing wallet identity the sole authority and gives replay/mix-up checks one durable state transition.
- **Trade-offs**: A customer must create a new World request after expiry or rejection.
- **Follow-up**: Validate the legacy signal-commitment calculation against the current World protocol test vector before enabling the gate.

### Decision: Adopt World verification; retain only an attestation and used nullifier

- **Context**: World handles proof validation and biometric processing; Leg needs only a trade-gate result.
- **Selected Approach**: Send the result unchanged to the official v4 verification endpoint, then atomically store the used normalized nullifier and a wallet/action attestation with a policy expiry.
- **Rationale**: It follows the official verifier path, prevents replay, and avoids retaining biometric or unnecessary World data.
- **Trade-offs**: The configured attestation maximum age must be compatible with World action policy; a new action version may be needed for a later re-verification campaign.
- **Follow-up**: Confirm the selected partner's action verification limit and staged/production environment before production activation.

### Decision: Hard-gate only action preparation in Leg Trading

- **Context**: The product needs a mandatory option without claiming control over third-party swaps.
- **Selected Approach**: When `WORLD_TRADE_GATE_ENABLED` is true, the existing Trade Guard checks the matching current attestation immediately before its controlled action-preparation path returns an approval, transaction, or order-signature request.
- **Rationale**: This is the one Leg-controlled decision point before a customer wallet action and leaves issuer, route, fee, and confirmation policy owned by Trading.
- **Trade-offs**: A previously returned transaction can be broadcast outside Leg; this feature must say so plainly and never represent the gate as a Universal Uniswap block.
- **Follow-up**: Re-run Trading integration tests whenever the guarded prepare contract or its verified-wallet context changes.

## Risks & Mitigations

- Credential 11 partner access or RP registration is unavailable — keep the gate disabled and report the feature unavailable; do not silently accept a different credential.
- Staging/production or action mismatch — persist the expected environment/action per challenge, validate both, and fail closed for a mandatory gate.
- Replay, wallet mix-up, or concurrency — conditionally claim each challenge and use database uniqueness for `(action, nullifier)` and `(wallet, action)` attestation ownership.
- SDK/API shape drift — pin a reviewed IDKit 4.x lockfile version, parse only the accepted result shape, run fixtures through the real server verifier contract, and record genuine deviations in `feedbacks/world.md`.
- Sensitive-data leakage — no custom camera, raw-proof persistence, biometric persistence, client secret, or raw proof logging; return redacted statuses only.
- Scope expansion into compliance or universal trading control — retain the in-product low-assurance notice and confine the check to `Trade Guard` action preparation.

## References

- [World Credential 11: Selfie Check](https://docs.world.org/world-id/credentials/11) — assurance boundary and user flow.
- [IDKit Credentials](https://docs.world.org/world-id/idkit/credentials) — current `selfieCheckLegacy` compatibility and signal behavior.
- [IDKit Integration Guide](https://docs.world.org/world-id/idkit/integrate) — RP context, unchanged backend verification, and nullifier storage.
- [World Developer Portal Verify API](https://docs.world.org/api-reference/developer-portal/verify) — `POST /api/v4/verify/{rp_id}` contract.
- [World ID 4.0 Migration](https://docs.world.org/world-id/4-0-migration) — IDKit 4.x request changes and proof/nullifier lifecycle.
- [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) — file-backed `DatabaseSync`, migration, and host-runtime constraints.
