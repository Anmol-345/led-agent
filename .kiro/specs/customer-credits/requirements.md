# Requirements Document

## Introduction

Leg customers need to prepay, inspect, spend, and redeem credits for Leg's provider-backed services without holding a 0G or FMP provider account. Customer credits are denominated and redeemable 1:1 in native USDC on Base mainnet (chain ID 8453); each balance belongs to one authenticated wallet. Leg remains responsible for its own 0G and FMP provider accounts and bills customers only through this credit experience.

## Boundary Context

- **In scope**: Wallet-bound USDC deposits, available and reserved credit balances, withdrawals, request authorization, usage records, 0G/FMP/Leg-service pricing, provider-cost reconciliation, and protection of provider credentials and licensed data.
- **Out of scope**: Direct customer 0G or FMP accounts, raw FMP-data downloads, trading execution or trade settlement, cross-chain credit settlement, World verification, and use of `AgentWallet` as a customer vault.
- **Adjacent expectations**: `value-investing-advisor` must obtain an authorization using the customer wallet, a correlation identifier, service type, and maximum credit amount, then report the final outcome and 0G, FMP, and Leg-service amounts against that identifier. `tokenized-stock-trading` may use the same handoff only for a disclosed Leg platform-service charge; it must not debit trade consideration, route fees, or the separate 10 bps trading fee. `world-trade-credential` may use the shared wallet identity but receives no authority to debit credits. These downstream specs implement their own requests and must not implement balances, deposits, withdrawals, or provider credential access.

## Requirements

### Requirement 1: Wallet-Bound Credit Accounts

**Objective:** As a customer, I want my credits bound to the wallet I control, so that only I can spend or redeem them.

#### Acceptance Criteria

1. When a customer first performs a credit action with a wallet, the Leg Credits Service shall create or locate that wallet's credit account without requiring a separate provider account.
2. When a customer requests a private account or usage view, the Leg Credits Service shall require a fresh, single-use SIWE proof for a wallet-bound read session; when the customer authorizes a billable request, the service and vault shall require an EIP-712 signature from that wallet over the exact reservation cap and terms; direct deposit and withdrawal transactions remain their own ownership proof.
3. When the Leg Credits Service verifies a customer proof, it shall bind a read proof to Leg, Base, `read-account`, expiry, nonce, and request ID, and shall bind a billing proof to the Base chain, vault, reservation ID, customer, maximum charge, expiry, and canonical terms hash so neither proof can authorize a different or replayed action.
4. If a requested credit action names a wallet other than the authenticated wallet, the Leg Credits Service shall reject the action without changing any balance or invoking a provider.
5. The Leg Credits Service shall keep each credit account separate from Leg's operational `AgentWallet` and from all other customer wallets.
6. The Leg Credits Service shall accept and redeem production credits only as native USDC on Base mainnet (chain ID 8453) and shall show that settlement asset and chain to the customer before a credit action.

### Requirement 2: Deposits and Available Balances

**Objective:** As a customer, I want to fund and inspect my credits, so that I know the amount available for Leg services.

#### Acceptance Criteria

1. When a valid native Base-USDC deposit is mined, the vault shall increase that wallet's live available balance in the same transaction, and the Leg Credits Service shall project the deposit record exactly once.
2. While a mined deposit has not reached the configured confirmation condition, the Leg Credits Service shall show it as pending and shall not make it available for paid-provider authorization; the self-custodied vault shall still permit the depositing wallet to withdraw its unreserved on-chain balance.
3. If a vault deposit transaction reverts, the interface shall show the wallet/RPC failure and no deposit event or credit shall exist; if a previously observed canonical deposit is removed by a Base reorganization, the Leg Credits Service shall mark that event reversed and remove it from provider-eligible credits. A direct token transfer that bypasses `deposit` shall not create credit.
4. When an authenticated customer views their credit account, the Leg Credits Service shall distinguish the wallet's live on-chain withdrawable and reserved credits, the confirmed amount eligible for provider authorization, and deposits still pending provider-authorization confirmation, and shall show the USDC-denominated total for each amount.
5. When the customer repeats a deposit-status request or the system receives the same confirmed deposit more than once, the Leg Credits Service shall preserve one deposit record and one balance credit.

### Requirement 3: Price Disclosure and Request Authorization

**Objective:** As a customer, I want to know the maximum charge before Leg uses paid providers, so that I control my spending.

#### Acceptance Criteria

1. When a billable Leg request is presented for authorization, the Leg Credits Service shall show the service type, maximum credit amount, applicable 0G, FMP, and Leg-service price components, reservation expiry, and a request correlation identifier before provider work starts.
2. When a customer signs the EIP-712 reservation prepared from the exact disclosed correlation identifier, service type, price components, maximum charge, and reservation expiry and has sufficient provider-eligible credits, the Leg Credits Service shall persist that signature before broadcast, reserve no more and no longer than those signed terms, and return a usable authorization only after configured confirmation depth and canonical on-chain reconciliation.
3. If the customer has insufficient provider-eligible credits for the disclosed maximum amount, the Leg Credits Service shall decline authorization, leave balances unchanged, and not permit the downstream service to invoke a paid provider for that request.
4. If a customer does not authorize the disclosed charge, the Leg Credits Service shall not reserve credits or permit provider work for that request.
5. When the same request correlation identifier is authorized more than once, the Leg Credits Service shall return the original authorization or rejection without creating another reservation.
6. The Leg Credits Service shall not require a customer to create, fund, or disclose credentials for a 0G or FMP provider account.

### Requirement 4: Metering, Debiting, and Usage History

**Objective:** As a customer, I want an understandable record of each charge, so that I can reconcile my credit balance.

#### Acceptance Criteria

1. When an authorized billable request completes, the Leg Credits Service shall convert its reservation into a final charge no greater than the authorized maximum, release any unused reservation, and update the available balance.
2. When a provider-backed request incurs billable 0G, FMP, or Leg-service usage, the Leg Credits Service shall record the corresponding charge components and their total against the request correlation identifier.
3. When a customer views usage history, the Leg Credits Service shall show the request correlation identifier, service type, completion status, charge components, total, timestamp, and the resulting credit-balance change without exposing provider credentials or raw FMP downloads.
4. If a request fails before any billable provider usage is incurred, the Leg Credits Service shall release its full reservation and record that no charge was made.
5. If a request fails after billable provider usage is incurred, the Leg Credits Service shall charge only the recorded incurred amount, release the unused reservation, and show the failed status and charge to the customer.
6. When final provider usage is unavailable at request completion, the Leg Credits Service shall mark the usage record provisional and reconcile it when the provider usage becomes available without charging more than the customer's authorized maximum.
7. When a correction is needed for a recorded charge, the Leg Credits Service shall retain the original usage record and show a separately identifiable correction and its reason.

### Requirement 5: Withdrawal of Eligible Credits

**Objective:** As a customer, I want to withdraw unused credits, so that prepaid funds remain redeemable.

#### Acceptance Criteria

1. When a customer wallet signs a vault withdrawal, the vault shall allow withdrawal of that wallet's available, unreserved USDC credits up to its available balance without depending on a server session or local database.
2. When an eligible withdrawal completes, the vault shall reduce the caller's available balance exactly once and return the withdrawn USDC only to that same calling wallet on Base mainnet.
3. If a wallet-signed withdrawal exceeds the available unreserved balance, the vault shall revert it atomically and leave the balance unchanged.
4. While a withdrawal is pending or incomplete in the active customer interface, the interface shall show its status and disable another submission; the vault shall serialize mined transactions so the same available amount cannot be paid twice.
5. If a withdrawal reverts, EVM atomicity shall preserve the customer's vault balance; if its submitted outcome cannot yet be determined, the interface shall retain the transaction hash, keep another submission disabled, and require receipt reconciliation before offering a retry.

### Requirement 6: Provider Cost and Licensed-Data Safeguards

**Objective:** As a Leg operator, I want provider-backed charges and credentials controlled by Leg, so that customer billing covers service costs without exposing protected access.

#### Acceptance Criteria

1. When Leg makes a 0G or FMP provider request for a customer, the Leg Credits Service shall associate the provider cost with an authorized customer request while keeping the provider account under Leg's control.
2. If FMP commercial rights for the intended customer-facing service have not been confirmed, the Leg Credits Service shall not authorize FMP-backed requests for production use.
3. The Leg Credits Service shall prevent customers and client applications from retrieving FMP credentials, 0G credentials, encrypted secret material, or raw FMP downloads through the credit experience.
4. When an operator changes a price that can affect future customer charges, the Leg Credits Service shall retain the effective pricing information used for each later authorization and usage record.
5. If provider-cost reconciliation detects a discrepancy, the Leg Credits Service shall preserve the customer-facing record, show any resulting correction, and retain enough operator-visible information to reconcile the provider charge without revealing protected credentials or licensed raw data.

### Requirement 7: Downstream Service Handoffs and Scope Protection

**Objective:** As a downstream Leg feature, I want one reliable authorization and completion handoff, so that all paid services use the same customer accounting rules.

#### Acceptance Criteria

1. When `value-investing-advisor` requests provider-backed work, the Leg Credits Service shall accept an authorization request containing the authenticated customer wallet, correlation identifier, service type, and maximum charge, and shall accept completion information containing that identifier, outcome, and 0G, FMP, and Leg-service charge amounts.
2. When `tokenized-stock-trading` requests a Leg platform-service charge, the Leg Credits Service shall apply the same authorization and completion handoff only to that disclosed service charge and shall reject an attempt to use it for trade consideration, route fees, or the 10 bps trading fee.
3. When `world-trade-credential` reads a connected-wallet identity, the Leg Credits Service shall not treat that read as a credit authorization or grant it credit-debit authority.
4. The Leg Credits Service shall not execute trades, make investment recommendations, determine issuer eligibility, verify World credentials, or expose FMP data as part of a credit action.

## Review Gate

Requirements review passed: numeric requirement IDs are present; every acceptance criterion uses an EARS pattern; the requirements cover deposits, balance states, authorization, metering, reconciliation, withdrawals, provider safeguards, and downstream boundaries without prescribing implementation architecture.
