# Brief: customer-credits

## Problem

Leg customers need a wallet-authenticated way to prepay for inference and licensed financial-data service costs, see their balance and usage, and withdraw unused credits. 0G bills Leg's provider account, so it cannot directly charge each customer.

## Current State

The scaffold connects wallets and has an owner-controlled `AgentWallet`, but no customer ledger, credit vault, billable-usage record, pricing, withdrawal, or provider-cost reconciliation.

## Desired Outcome

A connected customer can deposit credits, authorize a billable Leg request, receive a clear balance/usage record, and withdraw their remaining eligible credits. The system charges enough credits to cover 0G token usage plus licensed FMP and Leg service cost without exposing provider keys or raw FMP downloads.

## Approach

Use a wallet-bound Base-USDC vault as the monetary authority and a narrow Leg ledger as the private billing/audit layer. Meter each provider-backed request before/after execution, reconcile it with provider usage, and keep provider accounts and secrets owned by Leg. Wallet-signed vault transactions remain available independently of the local Leg database.

## Scope

- **In**: Deposits, balances, withdrawals, usage records, request authorization, insufficient-credit handling, 0G/FMP/Leg-service price components, and server-only encrypted provider secrets.
- **Out**: Direct customer 0G accounts, trading execution, revealing FMP data/API credentials, and cross-chain atomic credit/trade settlement.

## Boundary Candidates

- Customer credit-vault and withdrawal contract/accounting boundary.
- Server-side authorization and metering boundary used by every billable provider request.

## Out of Boundary

- Investment recommendations, screening, portfolio health, Uniswap routes, and World verification.

## Upstream / Downstream

- **Upstream**: Connected wallet and existing secret-management conventions.
- **Downstream**: Value-investing advisor and tokenized-stock trading must authorize/debit usage through this feature.

## Existing Spec Touchpoints

- **Extends**: None.
- **Adjacent**: Existing `AgentWallet.sol` remains an agent-owned wallet and is not the customer-credit model.

## Constraints

Credits are public, wallet-bound liabilities in the Base vault; Leg's internal ledger records authentication, billing intent, provider usage, and reconciliation but cannot create or move customer value. 0G and FMP accounts remain separate provider accounts. FMP commercial rights must cover the intended service before production use. Record unexpected 0G behavior in `feedbacks/0g.md` as it is encountered.

Durable private records use a file-backed local SQLite database on the same persistent host as the Node server. Prisma ORM 7.8.0 owns the committed migration history and typed database access. Database/indexer failure stops new provider authorization but never customer withdrawal.
