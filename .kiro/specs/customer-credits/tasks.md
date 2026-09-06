# Implementation Plan

- [x] 1. Foundation: establish durable credit prerequisites
- [x] 1.1 Establish the Node runtime and local credit configuration
  - Pin the credit server to Node 24.11.x and validate the server-only local SQLite path and Prisma runtime configuration before any credit route loads.
  - Read the server-only `CREDIT_DATABASE_PATH`; reject in-memory, missing, invalid, or unwritable paths and prohibit `NEXT_PUBLIC_*` credit secrets.
  - Validate the server-only canonical app origin, Base RPC, vault, deployment block, confirmation depth, scheduler secret, billing signer, and FMP-licence configuration before the corresponding credit boundary starts.
  - Observable: an unsupported Node runtime or missing, invalid, in-memory, or unwritable local database configuration prevents a billable action before any provider or vault call.
  - _Requirements: 2.2, 3.1, 3.3, 4.2, 6.2, 6.3_
  - _Boundary: Credit runtime configuration_

- [x] 1.2 Establish Prisma local credit persistence and recovery
  - Add the shared Prisma 7.8.0 schema, generated client, and migration workflow for file-backed local SQLite challenges, sessions, authorizations, usage, corrections, events, and the indexer cursor; credit routes run only on the same persistent Node host as the database.
  - Bind an initialized projection to one chain, vault address, and deployment block so a restored database from another deployment fails closed instead of affecting a live vault view or provider authorization.
  - Apply committed Prisma migrations to the configured persistent local path, and validate the local path before any database client is created.
  - Add an explicit local backup and restore rehearsal that proves constrained credit records survive a clean restore to a separate path and are verified through Prisma Client.
  - Observable: a Prisma migration creates constrained credit records at the configured persistent path, and a backup/restore rehearsal reproduces and reads those records at a separate local path.
  - _Requirements: 2.2, 2.5, 4.2, 4.3, 4.6, 6.3, 6.4, 6.5_
  - _Boundary: Prisma local credit persistence and recovery_

- [x] 1.3 Prepare the vault dependency and security baseline
  - Complete the required `ethskills` process before Solidity work and pin a reviewed OpenZeppelin v5 release with the required Foundry remapping.
  - Establish the fixed Base-native-USDC, non-upgradeable-vault, and separated admin/billing/treasury role configuration.
  - Observable: Foundry resolves the reviewed dependency and the contract implementation has no unreviewed custody dependency or configurable production settlement token.
  - _Requirements: 1.5, 1.6, 5.1, 5.2, 5.5_
  - _Boundary: CustomerCreditVault security baseline_

- [x] 2. Core credit components
- [x] 2.1 (P) Build the Base-USDC customer credit vault
  - Implement customer deposits, available-only withdrawals, reservations, final settlement, release, customer expiry, and revenue withdrawal in integer micro-USDC units.
  - Enforce unique reservation IDs, EIP-712 EOA/ERC-1271 customer signatures over the exact cap/domain/terms, final charge caps, separated roles, event emission, and an emergency pause that does not block customer withdrawal/release/expiry.
  - Generate the vault ABI artifact from the compiled contract for later typed Base reads and writes; do not hand-edit deployment values.
  - Observable: on a local Foundry chain, a customer can receive only their own available funds and cannot withdraw a reservation or customer liability as revenue.
  - _Requirements: 1.5, 1.6, 2.1, 2.3, 2.4, 3.2, 3.3, 3.5, 4.1, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: CustomerCreditVault_
  - _Depends: 1.3_

- [x] 2.2 (P) Build read-only wallet authentication
  - Issue, verify, and atomically consume short-lived SIWE proofs bound to Leg origin, Base, wallet, `read-account`, request ID, expiry, and nonce.
  - Persist a `read-account` session only as a one-way secret hash tied to its consumed challenge, wallet, action, request ID, expiry, and revocation state; billing uses no SIWE session authority.
  - Support EOA and ERC-1271 verification and issue only a secure wallet-bound read session; never use a posted address as identity.
  - Observable: a wrong, expired, replayed, revoked, or billing-scoped proof cannot yield a session or invoke a credit action, and no persisted record contains the raw session secret.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.4_
  - _Boundary: Credit Authentication_
  - _Depends: 1.1, 1.2_

- [x] 2.3 Verify vault transitions and custody invariants
  - Add Foundry unit, fuzz, and invariant coverage for valid and rejected deposits, reservations, settlement, release, expiry, withdrawal, revenue, roles, pause, duplicate IDs, and reentrant token behavior.
  - Assert that the vault token balance always covers customer liability plus unwithdrawn revenue and that `AgentWallet` has no customer-custody authority.
  - Observable: the Foundry suite fails for excessive settlement, duplicate accounting, wrong-recipient withdrawal, and any liability invariant breach.
  - _Requirements: 1.5, 2.1, 2.3, 2.5, 3.2, 3.5, 4.1, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: CustomerCreditVault tests_

- [x] 2.4 Build the typed Base vault client
  - Use the generated vault ABI to provide typed Base reads, EIP-712 EOA/ERC-1271 reservation verification, confirmation-depth receipts, and event decoding for credit services.
  - Keep reserve, settle, and release writes owned by the credit ledger service rather than this adapter.
  - Observable: the client decodes a vault event and reads a vault balance using the generated artifact without hand-authored ABI or deployment data.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.3, 5.2, 5.4, 5.5_
  - _Boundary: Base Vault Client_
  - _Depends: 2.1_

- [x] 2.5 Build the confirmed vault-event projection
  - Add a serialized, crash-safe event indexer with confirmation depth, unique event identity, cursor persistence, and unfinalized reorganization recovery.
  - Fetch long log windows in bounded contiguous RPC ranges, then use a database compare-and-swap cursor update so concurrent scheduler processes cannot commit stale projection work.
  - Keep deposits ineligible for paid-provider authorization until configured confirmation depth, provide an on-demand index-through-head snapshot for authorization/account reads, project no duplicate credit movement, and retain a customer-safe reason when a previously observed canonical deposit is reversed. Failed calls remain wallet transaction errors because they emit no event; other-contract or undecodable logs have no authenticated vault customer and must not be invented as customer records.
  - Observable: duplicate/replayed logs produce one record, a not-yet-confirmed mined deposit remains self-withdrawable but visibly pending for provider authorization, a reorged deposit is visible as reversed with its reason, and a failed deposit call leaves no credit.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.3, 5.2, 5.4, 5.5_
  - _Boundary: Vault Indexer_
  - _Depends: 1.2, 2.4_

- [x] 2.6 Build the server-only credit ledger handoff
  - Persist an immutable pending draft before signing; bind its random authorization/reservation IDs, wallet, Base vault domain, correlation ID, service type, price version, components, maximum, and reservation expiry to the customer's EIP-712 signature; persist that signature before broadcast and reserve those exact terms before returning an authorization to a paid service.
  - Record normalized 0G, FMP, and Leg-service components as provisional, settled, released, failed, or append-only correction history; retain a reservation through delayed metering and make Leg absorb post-expiry cost.
  - Enforce the FMP production-licence gate, server-only secret boundary, advisor/trading service scope, and the absence of a World debit capability.
  - Observable: an authorization is usable only after reservation; an over-cap amount, insufficient balance, invalid service type, or public caller cannot settle a customer charge.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4_
  - _Boundary: Credit Ledger Service_
  - _Depends: 2.4_

- [x] 3. Integration: expose the credit experience and controlled seams
- [x] 3.1 Expose the authenticated credit account experience
  - Provide challenge, session, and account operations that return only the verified wallet's Base-USDC balances, reservations, pending deposits, and redacted usage/correction history.
  - Map invalid proof, insufficient credit, unavailable dependency, and rejected action states to actionable client responses.
  - Observable: an authenticated account response contains no provider credentials, raw FMP data, or another wallet's credit information.
  - _Requirements: 1.2, 1.4, 1.6, 2.2, 2.4, 3.1, 4.3, 6.3_
  - _Boundary: Credits API_
  - _Depends: 2.2, 2.5, 2.6_

- [x] 3.2 Add the direct-wallet credit interface
  - Show the fixed Base-USDC asset/chain, live on-chain available/reserved amounts, deposits pending provider-authorization confirmation, redacted usage, and transaction/error state. Keep pre-authorization price disclosure in the exact human-readable terms used to reconstruct the downstream EIP-712 reservation rather than adding a public provider-pricing endpoint.
  - Use only customer wallet approval/deposit/withdrawal transactions; show pending or failed withdrawal state and prevent a pending amount from being offered again; do not add provider, treasury, or arbitrary destination controls to the browser.
  - Observable: the interface never offers reserved or pending-withdrawal credit for withdrawal and displays the same settlement asset/chain before each credit action.
  - _Requirements: 1.6, 2.2, 2.4, 3.1, 4.3, 5.1, 5.4_
  - _Boundary: Credits API and UI_
  - _Depends: 2.1, 3.1_

- [x] 3.3 Wire protected scheduled indexing
  - Use the generated vault artifact for typed application use and add a secret-protected periodic indexer trigger with no customer mutation capability.
  - Connect the scheduled trigger to the durable cursor and preserve fail-closed behavior when its runtime dependencies are unavailable.
  - Observable: an authorized schedule advances the indexer cursor while an unauthenticated request fails without changing customer state.
  - _Requirements: 2.1, 2.2, 2.5, 4.3, 5.2, 5.4, 5.5, 6.3_
  - _Boundary: Vault Indexer and Credits API_
  - _Depends: 2.5, 3.1_

- [x] 3.4 Validate the downstream seam without downstream implementation
  - Exercise the server-only advisor and trading-platform authorization/finalization handoffs using test consumers, without adding advisor or trading behavior to this feature.
  - Reject trade consideration, route charges, and the separate 10 bps trading fee; verify World has no credit-debit route.
  - Observable: public/API callers cannot submit provider amounts, and an unsupported downstream charge cannot change a credit balance.
  - _Requirements: 3.3, 3.6, 6.1, 7.1, 7.2, 7.3, 7.4_
  - _Boundary: Credit Ledger Service_
  - _Depends: 2.6, 3.1_

- [x] 4. Validation: prove financial and provider-boundary safety
- [x] 4.1 Verify server authorization, privacy, and failure paths
  - Test EOA/ERC-1271 proof verification, action/nonce replay rejection, FMP licence gating, insufficient-credit preflight, failed/provisional/expiry/correction states, and redacted account data.
  - Confirm that failed authorization invokes no provider callback and that logs/DTOs expose no protected provider field.
  - Observable: the test suite demonstrates no provider invocation or customer debit after each rejected authorization path.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.3, 3.4, 3.6, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4_
  - _Boundary: Credit Authentication and Credit Ledger Service_
  - _Depends: 2.2, 2.6, 3.1_

- [x] 4.2 Verify confirmed customer credit flows
  - Test pending-to-confirmed and reorganization-reversed deposit projection, reverted deposit calls with no projection, authorized success/failure settlement, available-only withdrawals, reverted or unknown withdrawal receipt reconciliation, duplicate event handling, and reorganization recovery across the exposed customer flow.
  - Run the relevant Foundry and application validation commands after integration.
  - Observable: the complete flow preserves matching displayed and vault balances across retries, reverted or unknown transaction receipts, and event replay.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.5, 4.1, 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: CustomerCreditVault, Vault Indexer, Credits API and UI_
  - _Depends: 2.3, 3.2, 3.3, 4.1_

## Task Plan Review Gate

Task plan review passed after an independent task-graph sanity review. All requirements map to at least one executable task; the Node runtime, Prisma-managed local SQLite persistence and recovery, contract security, ABI generation, authentication, indexing, server-only provider authorization, customer UI, downstream seam validation, and financial regression coverage have explicit boundaries, dependencies, and observable deliverables.
