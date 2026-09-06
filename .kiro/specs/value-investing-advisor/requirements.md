# Requirements Document

## Introduction

Leg customers need a wallet-aware value-investing advisor that turns company fundamentals, deterministic calculations, and their selected on-chain holdings into explainable research. The advisor is educational research, not an investment-advisory registration, suitability determination, custody service, or trade executor. It uses Leg-owned 0G and FMP provider access while Customer Credits remains the only customer authorization, reservation, settlement, and usage-accounting authority.

## Boundary Context

- **In scope**: Investment-philosophy content, paid advisor-request authorization and metering calls, 0G-backed response generation, FMP-derived analysis, deterministic valuation/screening, selected on-chain portfolio reads, customer-controlled checkup subscriptions, web chat, a shared ChatGPT/Claude connector, citations, and a structured recommendation handoff.
- **Out of scope**: Customer-credit accounts or ledger transitions, raw FMP data or credentials, provider-account sharing, automatic trading, custody, issuer eligibility/allowlists, trade routing, World verification, and legal registration or suitability advice.
- **Adjacent expectations**: Every provider-backed advisor run obtains the authenticated wallet's Customer Credits authorization using its correlation identifier, service type, and disclosed maximum before paid work, then reports final 0G, FMP, and Leg-service components through the same identifier. Tokenized-stock trading consumes only the defined structured recommendation handoff and still obtains separate issuer eligibility and explicit customer confirmation.

## Requirements

### Requirement 1: Value-Investing Philosophy and Research Boundaries

**Objective:** As an investor, I want Leg to apply a transparent value-investing philosophy, so that I can understand the principles behind its research.

#### Acceptance Criteria

1. When Leg answers an investment-research request, the Leg Advisor shall ground its response in the published philosophy version covering Benjamin Graham, Warren Buffett, Charlie Munger, Peter Lynch, John Templeton, Joel Greenblatt, and Walter Schloss.
2. When Leg presents a conclusion influenced by a philosophy principle, the Leg Advisor shall identify the applicable principle and philosophy version in the response.
3. When a customer asks for an action beyond research, the Leg Advisor shall state that it does not provide suitability, legal, tax, custody, or automatic-trading services and shall not portray research as a personalized guarantee.

### Requirement 2: Customer-Credit Preflight and Metered Completion

**Objective:** As a customer, I want to approve the maximum provider-backed cost before research runs, so that I control credit spending.

#### Acceptance Criteria

1. When a customer starts a provider-backed advisor request, the Leg Advisor shall present the Customer Credits disclosure for the authenticated wallet, correlation identifier, service type, maximum charge, and 0G, FMP, and Leg-service components before paid provider work begins.
2. When the disclosed 0G component is calculated, the Leg Advisor shall include the full context it will send for the request, including applicable conversation, philosophy, and tool-result context, within the disclosed maximum.
3. When Customer Credits authorizes the advisor request, the Leg Advisor shall use that authorization only for the matching advisor correlation identifier and shall report the final succeeded or failed outcome and all three charge components to Customer Credits.
4. If Customer Credits declines, expires, or cannot authorize a request, the Leg Advisor shall not invoke a paid provider and shall show an actionable credit or authorization state.
5. If provider work fails after chargeable usage, the Leg Advisor shall report only the incurred normalized components and shall show the failed outcome without attempting to alter the customer's credit account directly.

### Requirement 3: Explainable Provider-Backed Advice

**Objective:** As an investor, I want evidence and uncertainty alongside advice, so that I can evaluate its basis.

#### Acceptance Criteria

1. When Leg completes an advisor request, the Leg Advisor shall distinguish sourced facts, deterministic calculations, and generated interpretation in the response.
2. When Leg uses financial fundamentals or a market price, the Leg Advisor shall cite the symbol, reporting period or observation time, source, and retrieval time that support the result.
3. If a source is unavailable, stale beyond the configured freshness policy, ambiguous, or insufficient for a requested conclusion, the Leg Advisor shall identify the limitation and shall not invent a value, citation, or conclusion.
4. When the configured 0G inference service is unavailable or returns an invalid result, the Leg Advisor shall preserve the customer's request outcome, avoid a fabricated answer, and show a retryable failure state.

### Requirement 4: Private Financial-Data Access

**Objective:** As a Leg operator, I want financial-data access kept private, so that customer research does not expose protected provider access.

#### Acceptance Criteria

1. When Leg uses FMP-backed fundamentals or prices for a customer request, the Leg Advisor shall obtain the required facts through Leg's server-side provider access.
2. When a customer requests financial research, the Leg Advisor shall provide derived and cited research needed for the response without exposing an FMP credential, encrypted secret material, raw downloadable response, or a direct provider-access path.
3. If a required FMP field cannot be obtained, the Leg Advisor shall prevent the affected paid research operation and shall explain the unavailable capability without revealing protected details.

### Requirement 5: Deterministic Valuation and Screening

**Objective:** As an investor, I want repeatable value-investing calculations, so that I can inspect the numerical basis for a research conclusion.

#### Acceptance Criteria

1. When a customer requests a supported valuation or screen, the Leg Advisor shall return its named method, formula version, normalized inputs, source periods, result, and any unmet precondition.
2. When the same valid inputs and formula version are evaluated again, the Leg Advisor shall return the same deterministic result.
3. If a required financial input is missing, non-positive where the formula requires a positive value, internally inconsistent, or stale, the Leg Advisor shall mark that method unavailable rather than substitute an invented value.
4. When a deterministic calculation is used in a generated response, the Leg Advisor shall preserve its result and calculation reference so the response can cite it without recomputation drift.

### Requirement 6: Wallet Portfolio Reads

**Objective:** As a wallet holder, I want Leg to consider holdings I select, so that portfolio research reflects my on-chain position without giving Leg control of my assets.

#### Acceptance Criteria

1. When an authenticated customer selects a wallet holding for portfolio research, the Leg Advisor shall read the selected supported on-chain asset balance for that authenticated wallet and show its chain, token, amount, and read time.
2. If a selected asset cannot be read, has no recognized research mapping, or has an unsupported chain, the Leg Advisor shall identify it as unavailable or unvalued and shall not infer a holding, ticker, price, or issuer eligibility.
3. When Leg includes an on-chain holding in research, the Leg Advisor shall keep the on-chain balance observation distinct from the financial-data price and from any trading availability claim.
4. The Leg Advisor shall not request a private key, transfer approval, or custody permission to read a portfolio.

### Requirement 7: Customer-Controlled Portfolio Health Checkups

**Objective:** As an investor, I want to opt into periodic portfolio-health review prompts, so that I can revisit selected holdings without unexpected charges.

#### Acceptance Criteria

1. When a customer creates, changes, pauses, or deletes a portfolio-health checkup, the Leg Advisor shall show the selected wallet holdings, schedule, and current opt-in state.
2. When an opted-in checkup becomes due, the Leg Advisor shall create a pending checkup for the authenticated customer and shall not invoke a paid provider until the customer authorizes that specific advisor request through Customer Credits.
3. When the customer authorizes a due checkup, the Leg Advisor shall run the same cited portfolio and valuation analysis as an interactive request and shall record the resulting checkup state for the customer to inspect.
4. If a customer has paused, deleted, or not authorized a due checkup, the Leg Advisor shall not produce a paid provider-backed analysis or debit credits for that checkup.

### Requirement 8: Shared Web and Connector Chat Surfaces

**Objective:** As a customer, I want to use the same Leg research service on the web and through supported AI clients, so that my authenticated advisor experience is consistent.

#### Acceptance Criteria

1. When a customer sends a valid web-chat request, the Leg Advisor shall return the same cited research, credit-authorization state, and recommendation semantics available through the supported connector.
2. When a supported ChatGPT or Claude client invokes the Leg connector, the Leg Advisor shall require the customer to complete the Leg authorization flow before exposing wallet-specific research or starting a billable request.
3. When a connector client requests a capability outside the advisor boundary, the Leg Advisor shall return a bounded error and shall not expose provider secrets, raw financial data, another customer's data, or a trading-execution capability.
4. If a connector session expires or its authorization is invalid, the Leg Advisor shall require reauthorization before returning wallet-specific data or invoking a paid provider.

### Requirement 9: Structured Recommendation Handoff

**Objective:** As a downstream trading feature, I want a validated research recommendation artifact, so that trade intent never has to be inferred from free-form chat.

#### Acceptance Criteria

1. When Leg presents a research conclusion that may be considered for a tokenized-stock trade, the Leg Advisor shall create a `ValueInvestingRecommendation.v1` artifact containing its stable identifier, authenticated wallet, asset reference, research stance, thesis, cited evidence, deterministic calculation references, risks, generated time, and expiry.
2. When a customer chooses to continue from a recommendation, the Leg Advisor shall hand off the exact `ValueInvestingRecommendation.v1` artifact without constructing, signing, submitting, or confirming an order.
3. If a recommendation is expired, malformed, unsupported, or no longer associated with the authenticated wallet, the Leg Advisor shall reject the handoff and shall require fresh research rather than reuse free-form chat text.
4. The Leg Advisor shall not claim that a recommendation establishes issuer eligibility, a route, a price guarantee, or permission to trade.

### Requirement 10: Operational Safety and 0G Feedback

**Objective:** As a Leg operator, I want advisor-provider failures traceable without leaking customer or provider secrets, so that the service can be safely improved.

#### Acceptance Criteria

1. When a 0G integration bug, undocumented behavior, or workaround is encountered, the Leg Advisor shall progressively record its symptom, redacted reproduction, impact, workaround, and resolution state in the project 0G feedback log.
2. When Leg records advisor operational events, the Leg Advisor shall retain correlation identifiers, outcome, provider usage summary, and redacted diagnostic context without recording wallet signatures, prompts, FMP credentials, 0G keys, or raw FMP payloads.
3. If an advisor dependency is unavailable, the Leg Advisor shall fail closed for new paid work while preserving the customer's existing credit and checkup state for a later retry.

## Review Gate

Requirements review passed: all requirement headings use numeric IDs; every acceptance criterion follows an EARS pattern; the draft covers philosophy, Customer Credits preflight/finalization, 0G/FMP boundaries, deterministic calculations, wallet reads, opt-in checkups, shared chat surfaces, the structured trading handoff, and progressive 0G feedback without assigning ledger ownership or prescribing implementation architecture.
