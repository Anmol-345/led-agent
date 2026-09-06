# Roadmap

## Overview

Leg Agent is a wallet-authenticated value-investing advisor. Customers prepay redeemable Leg credits in a self-custodied Base-USDC vault, receive advice grounded in Leg's investment philosophy and licensed FMP data, and may confirm tokenized-stock trades. 0G supplies inference; Leg operates the provider accounts and records private billing intent and usage without making its local database the monetary authority.

The first trading release supports only issuer-approved assets on the EVM chains where they are available. It uses a route-aware Uniswap integration with one API-native 10 bps Leg fee per completed order and a World Selfie Check trade gate delivered afterwards as a bonus.

## Approach Decision

- **Chosen**: Use Uniswap's request-scoped 10 bps integrator fee for every eligible supported route. The customer-confirmed route pays it directly to the configured Leg fee-recipient wallet.
- **Why**: The API-native fee preserves route flexibility while avoiding a v4 hook, fee-custody contract, and a separate Customer Credits trade charge.
- **Rejected alternatives**: Hook-based or credit-ledger trade fees add unnecessary settlement and security surface. A frontend-only World check is bypassable. Direct customer 0G accounts do not provide the required common prepaid-credit experience.

## Scope

- **In**: Wallet-bound prepaid credits and withdrawals; metered 0G inference and Leg's FMP/service charge; private server-side FMP access; 0G chat, value-investing tools, portfolio health and checkups; web and connector chat surfaces; customer-confirmed tokenized-stock trades; the 10 bps fee; optional World Selfie Check; progressive provider feedback documentation.
- **Out**: Exposing FMP data/API keys, automatic trading without a wallet confirmation, a claim that World Selfie Check is KYC/AML/suitability, support for unapproved assets or jurisdictions, and custody of customer trading assets.

## Constraints

- FMP commercial terms must explicitly permit the intended licensed, customer-facing use of data and derived analysis. Its key remains encrypted and server-only.
- 0G inference (chain 16661) and Uniswap trading run in separate chain domains. Credits cannot atomically settle arbitrary trades without explicit cross-chain design.
- Each supported issuer and chain controls asset availability, transfer restrictions, and eligibility. Route/asset discovery must be chain-specific.
- The Trading API fee request, returned customer recipient, fee recipient, token, amount, and executable route must be validated against its current OpenAPI schema. A route without verifiable 10 bps fee evidence is unavailable; no hook or credits fallback is used.
- Use the existing Next.js/TypeScript, Foundry, viem, wagmi, and scaffold-agent patterns. Do not use `any`, unsafe assertions, or client-side secrets.
- Before Solidity work, follow the project's required `https://ethskills.com/SKILL.md` guidance. Use the official 0G, Uniswap, and World documentation during their integrations.
- Initialize and progressively update `feedbacks/0g.md`, `feedbacks/uniswap.md`, and `feedbacks/world.md` when their integrations encounter a bug, undocumented behavior, or workaround.

## Boundary Strategy

- **Why this split**: Credits form the advisor's shared authorization and accounting primitive. Advisor capabilities consume credits but do not execute trades. Trading consumes recommendations and user confirmation without reading or changing credit balances, while World adds an optional authorization layer after the core trade flow works.
- **Shared seams to watch**: One connected-wallet identity; an immutable usage-record schema; a signed recommendation/order boundary; exact one-fee routing semantics; issuer eligibility before quoting; and a controlled executor if World must become a hard on-chain gate.

## Specs (dependency order)

- [x] customer-credits -- Wallet-bound prepaid credits, metering, withdrawal, and provider-cost accounting. Dependencies: none
- [ ] value-investing-advisor -- 0G/FMP-backed Leg advice, portfolio analysis, chat surfaces, and connector. Dependencies: customer-credits
- [ ] tokenized-stock-trading -- Issuer-aware Uniswap trading, confirmed orders, and 10 bps fee collection. Dependencies: customer-credits, value-investing-advisor
- [ ] world-trade-credential -- Optional World Selfie Check verification for controlled Leg trade execution. Dependencies: customer-credits, tokenized-stock-trading
