# Brief: tokenized-stock-trading

## Problem

Customers who accept Leg's advice need a safe, wallet-confirmed way to buy or sell eligible tokenized stocks with the best available approved Uniswap route. Leg needs one transparent 10 bps fee that is collected in the swap, without a custom hook, fee-custody contract, or debit from the customer's prepaid credits.

## Current State

The scaffold has only Graph queries for Uniswap data. It has no asset registry, issuer-eligibility handling, Trading API quote/routing client, token approval, order confirmation, fee validation, or trade receipt.

## Desired Outcome

A customer can review a structured Leg recommendation, see an exact quote and one 10 bps Uniswap integrator fee, and explicitly sign a purchase or sale. The application chooses the best eligible supported route, the Trading API directs the fee to Leg's configured fee-recipient address as part of the swap, and the application records the confirmed outcome.

## Approach

Use issuer- and chain-specific asset discovery, then request approved Uniswap routes with the current API-native integrator-fee request structure set to exactly 10 bps and Leg's configured fee recipient. Validate that the returned quote and terminal evidence preserve the customer recipient and the stated fee. If a route cannot prove the requested fee, make it unavailable. Do not deploy or use a Uniswap hook, a fee-receiver contract, or Customer Credits in the trade flow.

## Scope

- **In**: Structured recommendation handoff, eligible asset/chain discovery, issuer restrictions, Uniswap quote/route comparison, approvals, wallet confirmation, signed execution, receipts, pricing disclosure, API-native 10 bps integrator-fee collection, and direct fee-recipient evidence.
- **Out**: Automatic trading, a claim of universal tokenized-stock availability, issuer KYC/accreditation replacement, unsupported chains, fee collection twice per order, custom Uniswap hooks, fee-custody or withdrawal contracts, Customer Credits charges or balance changes, and World verification implementation.

## Boundary Candidates

- Recommendation-to-order contract, with explicit asset, chain, amount, expiry, and risk disclosure.
- Route/eligibility service that validates issuer and chain conditions before a customer can sign.
- Server-validated API integrator-fee request and evidence boundary, with a configured direct fee-recipient address.

## Out of Boundary

- Credit balances, free-form investment advice, FMP access, World Credential verification, custom Uniswap hooks, fee contracts, and fee withdrawals.

## Upstream / Downstream

- **Upstream**: Customer Credits' `CreditAuthService` `read-account` identity only (never its ledger or balances); `ValueInvestingRecommendation.v1` from the Advisor recommendation store; issuer asset/eligibility metadata.
- **Downstream**: World credential feature may gate controlled Leg trade execution.

## Existing Spec Touchpoints

- **Extends**: None.
- **Adjacent**: Existing viem/wagmi wallet setup and Graph data client; these do not execute swaps.

## Constraints

0G is not a Uniswap swap chain; deploy/configure per supported asset chain. Ondo, xStocks, and Robinhood assets have distinct chains and eligibility rules. Keep the Uniswap API key server-only, follow the current Trading API OpenAPI schema for the integrator-fee request, and document observed integration bugs, undocumented behavior, or workarounds in `feedbacks/uniswap.md` progressively.

Durable records use Customer Credits' shared file-backed local SQLite database on the same persistent Node server host. The feature uses Node's built-in `node:sqlite` at `CREDIT_DATABASE_PATH`, contributes committed forward-only migrations, and participates in host-local backup/restore.
