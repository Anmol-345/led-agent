# Research & Design Decisions

## Summary

- **Feature**: `customer-credits`
- **Discovery Scope**: Complex Integration / New Feature
- **Key Findings**:
  - The existing application has wallet connection but no server-verifiable wallet identity, durable customer storage, credit ledger, or customer vault. Posted addresses and `useAccount()` state are not authorization.
  - `AgentWallet` permits its owner or agent to make arbitrary calls and has no customer-fund model; it must remain outside this feature's custody path.
  - The installed viem 2.x stack supports public-client SIWE and EIP-712 verification for EOAs and ERC-1271 contract accounts. SIWE is limited to private account reads; billing uses an on-chain-enforced typed reservation cap.

## Research Log

### Wallet authentication and replay protection

- **Context**: Requirements 1.2–1.4 require server-verifiable, action-bound wallet proof.
- **Sources Consulted**: Existing `packages/nextjs/lib/wagmi-config.ts`, public routes, and [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361); [viem `verifyMessage`](https://viem.sh/docs/actions/public/verifyMessage).
- **Findings**: The current UI only exposes a connected address. ERC-4361 defines domain, chain ID, nonce, issued-at, expiry, and request ID fields; its relying party verifies parsed content and signature. viem's public-client action verifies EOA and ERC-1271 smart-account messages.
- **Implications**: Add server-side, single-use challenge persistence and verify read-only SIWE messages through a Base public client. Build billing as a separate immutable draft whose EIP-712 signature binds reservation ID, customer, cap, expiry, canonical terms hash, chain ID, and vault; verify it off-chain and again in the vault. Never authorize from a client-posted address. Vault mappings, signatures, and events are public Base data, so SIWE protects off-chain customer state rather than promising blockchain privacy.

### Vault and ERC-20 custody safety

- **Context**: Requirements 1.5, 2.1–2.5, and 5.1–5.5 require redeemable USDC without putting customer funds in `AgentWallet`.
- **Sources Consulted**: Existing `packages/foundry/src/AgentWallet.sol`, `network-definitions.ts`, and [OpenZeppelin ERC-20 utilities](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20) and [security utilities](https://docs.openzeppelin.com/contracts/5.x/api/utils).
- **Findings**: Base's native USDC address is already configured as `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. The project has `forge-std` only. OpenZeppelin's `SafeERC20`, `ReentrancyGuard`, role controls, and pause primitive address necessary ERC-20 and reentrancy risks.
- **Implications**: Implement one non-upgradeable Base-only customer vault, pin an audited OpenZeppelin v5 release before Solidity work, and require the project's `ethskills` process before the implementation task starts. The vault holds customer liabilities, enforces available/reserved balances, and keeps withdrawals self-directed.

### Durable accounting and provider boundary

- **Context**: Requirements 3.1–4.7 and 6.1–6.5 require idempotent usage records and delayed provider-cost reconciliation.
- **Sources Consulted**: Existing Next routes and encrypted-secret scripts, [0G AI Coding Context](https://docs.0g.ai/ai-context), and [Prisma's local SQLite guide](https://www.prisma.io/docs/prisma-orm/quickstart/sqlite).
- **Findings**: No durable database or background worker exists. Provider keys are currently intended for encrypted, server-only runtime environment use. Prisma ORM 7.8.0 provides the committed local SQLite migration workflow and generated typed client; its SQLite adapter uses the local database file on the Node host. A local database requires a persistent writable host volume. This spec does not need a direct 0G or FMP client: the advisor owns provider invocation and returns normalized metering.
- **Implications**: Use one file-backed local SQLite projection on the same persistent Node host, with committed Prisma migrations and Prisma Client transactions. Reject an in-memory, missing, or unwritable database path before new provider work, but never put that database in the customer's deposit/withdrawal path. Keep a reservation until final provider metering arrives; if it expires first, release it and make Leg absorb any later provider cost. The credit service exposes server-only authorization/finalization functions; it never forwards raw FMP data or provider credentials.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Onchain vault plus server ledger projection | Vault is authoritative for monetary balances; host-local SQLite stores authentication, pricing, usage, and indexed events through Prisma ORM | Redeemability and balance invariants are enforceable; provider details stay private | Requires one durable host, an indexer, transaction reconciliation, and local migration/backup discipline | Selected |
| Server-only balance ledger | Store all credit value in SQLite | Fewer chain transactions | Cannot enforce self-service redemption or protect against server balance mistakes | Rejected |
| Extend `AgentWallet` | Add customer accounting to the operational agent wallet | Fewer contracts | Broad owner/agent execution authority is incompatible with customer custody | Rejected |

## Design Decisions

### Decision: One Base-USDC vault and one server ledger

- **Context**: Credits must be redeemable while usage, provider costs, and authentication are private.
- **Alternatives Considered**:
  1. A server-only ledger.
  2. Multiple token or chain vaults.
- **Selected Approach**: A non-upgradeable vault accepts only Base native USDC and records available/reserved credit units; a file-backed local SQLite projection on the Node host stores private request and usage details.
- **Rationale**: It meets the selected first-release settlement boundary without cross-chain or multi-asset complexity.
- **Trade-offs**: Reservations and settlements require Base transactions. A scheduled indexer is a runtime prerequisite.
- **Follow-up**: Verify the canonical USDC contract and production signer/multisig addresses during deployment.

### Decision: Read-only SIWE, EIP-712 billing caps, and direct customer vault calls

- **Context**: A connected browser wallet is not an authorization boundary.
- **Alternatives Considered**:
  1. Trust a posted address.
  2. Use a generic long-lived browser session for all credit mutations.
- **Selected Approach**: Verify single-use, short-lived SIWE challenges only for private reads. For billing, persist an immutable draft, verify and store the customer's EIP-712 reservation signature before broadcast, and have the vault verify the same exact cap and terms. Deposits and withdrawals are direct wallet-signed vault calls; the vault accepts deposits and returns funds only to `msg.sender`.
- **Rationale**: It removes billing authority from a generic browser session and prevents the billing role from inventing a customer cap.
- **Trade-offs**: Customers sign a typed reservation before billable provider work, and the signature is public transaction calldata.
- **Follow-up**: Keep EOA, ERC-1271, cross-chain, cross-vault, and field-tampering vectors in the regression suite.

### Decision: Reservation is the single provider-cost cap

- **Context**: A provider can report final usage after work completes.
- **Alternatives Considered**:
  1. Charge an estimate then correct any amount later.
  2. Keep a maximum reservation until final metering or expiry.
- **Selected Approach**: The vault reserves the displayed maximum; only a final amount at or below that reservation can settle. A provisional record never releases the reservation. Expiry releases it and later costs are Leg's responsibility.
- **Rationale**: The customer never receives an unbounded retrospective charge.
- **Trade-offs**: Leg bears delayed-cost risk after expiry.
- **Follow-up**: Calibrate authorization expiry and confirmation depth from production observations.

## Risks & Mitigations

- Vault or service-signer compromise — use separated multisig admin, dedicated billing signer, pausing of deposits/new reservations, non-upgradeable code, Foundry fuzz/invariant testing, and independent security review before production custody.
- Chain reorganization or duplicate event — require configurable confirmation depth, persist block hash/cursor, and use `(chainId, transactionHash, logIndex)` uniqueness.
- Provider usage arrives too late — hold reservations through expiry; release only after expiry and record post-expiry provider costs as Leg expense.
- FMP rights or secret leakage — require a production licence flag, server-only encrypted runtime secrets, normalized metering only, and deny raw download routes.
- Database outage or local data loss — reject new authorization before provider invocation; keep an explicit local backup/restore rehearsal; customer vault deposits and withdrawals remain contract-controlled.

## References

- [ERC-4361: Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) — wallet authentication, nonce, expiry, and request binding.
- [EIP-712: Typed structured data](https://eips.ethereum.org/EIPS/eip-712) — exact reservation-domain and field binding.
- [viem `verifyMessage`](https://viem.sh/docs/actions/public/verifyMessage) — EOA and contract-account verification in the installed stack family.
- [OpenZeppelin ERC-20 utilities](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20) — safe token transfers and ERC-20 behavior.
- [OpenZeppelin security utilities](https://docs.openzeppelin.com/contracts/5.x/api/utils) — reentrancy guard and pausing primitives.
- [0G AI Coding Context](https://docs.0g.ai/ai-context) — integration context to be consulted by the downstream 0G implementation.
- [Prisma SQLite guide](https://www.prisma.io/docs/prisma-orm/quickstart/sqlite) — local SQLite migrations, generated client, and typed access.
