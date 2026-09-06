# Requirements Document

## Introduction

Leg Trading lets an authenticated customer turn a valid, wallet-bound value-investing recommendation into a customer-confirmed buy or sell of an issuer-eligible tokenized stock on a supported chain. The feature selects the best eligible approved Uniswap route, presents a short-lived quote, and uses Uniswap's built-in request-scoped 10 bps integrator fee paid directly to Leg's configured fee wallet. It never takes the trade fee from Customer Credits, deploys a hook, takes custody, or trades automatically.

## Boundary Context

- **In scope**: Recommendation handoff, issuer-and-chain eligibility, approved Uniswap routing, transaction-by-transaction wallet confirmation, one API-native 10 bps integrator fee, direct fee-recipient evidence, and trade-status receipts.
- **Out of scope**: Automatic or unattended trading, custody, universal asset availability, issuer KYC/accreditation replacement, unsupported chains, tokenized-credit settlement, Customer Credits reservations or debits for trading, fee-receiver contracts, custom Uniswap hooks, and World verification.
- **Adjacent expectations**: A verified wallet session may be supplied by an upstream capability, but Leg Trading does not read or change a customer's credit balance. The advisor supplies a bounded recommendation but never asserts trade eligibility, price, route, or permission. World may later gate this controlled trade boundary without changing its fee or confirmation rules.

## Requirements

### Requirement 1: Recommendation-bound trade intent

**Objective:** As a customer, I want a recommendation to become a clear trade intent, so that a trade cannot be created from unrelated or stale advice.

#### Acceptance Criteria

1. When a customer starts a trade from a recommendation, Leg Trading shall accept only an unexpired recommendation bound to the authenticated wallet and identify its supported asset, direction, and disclosed risks.
2. If the recommendation is missing, expired, malformed, belongs to another wallet, or names an unsupported asset, Leg Trading shall not create a quote or request a wallet transaction.
3. Leg Trading shall state that a recommendation is not proof of issuer eligibility, route availability, price, or trading permission.

### Requirement 2: Issuer and chain eligibility

**Objective:** As a customer, I want only assets I may trade to be offered, so that Leg does not bypass issuer or chain restrictions.

#### Acceptance Criteria

1. When a customer views assets for a selected supported chain, Leg Trading shall show only registry entries whose issuer, token, chain, and current eligibility conditions are approved for that customer flow.
2. If an issuer, chain, token, jurisdictional condition, transfer restriction, or required issuer step is unavailable or fails validation, Leg Trading shall mark the asset unavailable and shall not request a quote, approval, signature, or swap.
3. When issuer metadata or a supported-chain configuration changes, Leg Trading shall re-evaluate eligibility before creating a new quote.
4. Leg Trading shall not represent its eligibility check as issuer KYC, accreditation, legal, tax, or suitability advice.

### Requirement 3: Exact eligible quotes and API-native fee disclosure

**Objective:** As a customer, I want a current quote with all material amounts disclosed, so that I can decide whether to confirm a trade.

#### Acceptance Criteria

1. When a customer requests a buy or sell quote for an eligible asset, Leg Trading shall obtain only approved same-chain Uniswap routes with a request-scoped 10 bps integrator fee directed to the configured Leg fee wallet and shall present the input amount, expected and minimum output where applicable, gas information, route type, expiry, fee amount, fee token, and fee recipient before requesting confirmation.
2. Leg Trading shall make a quote unusable no later than 30 seconds after issuance and shall require a fresh quote after expiry, material asset, amount, wallet, or chain change, or failed validation.
3. When an integrator fee is taken from the swap output, Leg Trading shall show the customer output and the 10 bps fee as distinct disclosed amounts before the wallet action.
4. Leg Trading shall collect exactly one 10 bps Uniswap integrator fee for an order and shall not add a hook fee, fee-receiver contract fee, or Customer Credits charge for that order.
5. If no route can meet the issuer, chain, amount, slippage, recipient, or 10 bps integrator-fee rules, Leg Trading shall report that the trade is unavailable without requesting a wallet transaction.

### Requirement 4: Server-validated route integrity

**Objective:** As a customer, I want the approved quote to match what my wallet is asked to sign, so that a route response cannot redirect or change my trade.

#### Acceptance Criteria

1. When Leg Trading prepares an approval, signature, order, or transaction from a quote, it shall verify the authenticated wallet, selected chain, approved token pair, amount bounds, customer recipient, integrator-fee recipient, fee amount, deadline, and authorized destination before it is returned to the customer.
2. If a route response is stale, malformed, uses an unapproved chain or destination, changes the customer recipient, fee recipient, token pair, or disclosed bounds, has empty execution data, or lacks the disclosed integrator fee, Leg Trading shall reject it and require a fresh quote.
3. Where a route is Classic, Leg Trading shall preserve its Classic approval and transaction requirements as one validated route type.
4. Where a route is UniswapX, Leg Trading shall preserve its order, customer recipient, integrator-fee output, deadline, and signature requirements as one validated route type and shall not treat it as a Classic transaction.

### Requirement 5: Explicit customer confirmation and wallet execution

**Objective:** As a customer, I want to approve each wallet action myself, so that Leg cannot trade or grant spending authority automatically.

#### Acceptance Criteria

1. When Leg Trading requests an approval transaction, permit signature, swap transaction, or UniswapX order signature, it shall show the customer the action, chain, target, amount, expiry, and integrator fee and shall require a new explicit wallet confirmation.
2. When the connected wallet is not on the selected eligible chain, Leg Trading shall request a wallet chain switch before requesting the next transaction or signature.
3. If the wallet rejects, disconnects, switches to a different chain, or does not confirm an action, Leg Trading shall not submit or retry that action automatically and shall preserve an actionable non-executed status.
4. Leg Trading shall never hold a customer private key, submit a customer transaction without the corresponding confirmation, or execute a trade from a saved approval alone.

### Requirement 6: Terminal outcome and receipt

**Objective:** As a customer, I want an accurate receipt after I confirm a trade, so that I can distinguish a submitted action from a settled trade.

#### Acceptance Criteria

1. When a Classic transaction is broadcast, Leg Trading shall show its submitted transaction identifier and wait for the configured chain confirmation before recording it as settled, reverted, or pending.
2. When a UniswapX order is signed or accepted, Leg Trading shall show its order identifier and distinguish acceptance, pending fill, filled, expired, cancelled, and failed outcomes rather than claiming immediate settlement.
3. When an order reaches a terminal outcome, Leg Trading shall provide the authenticated wallet with a receipt containing the asset pair, chain, route type, confirmed amounts when available, the one applicable 10 bps integrator fee, fee token, fee recipient, terminal status, and on-chain transaction or order reference.
4. If confirmation or order-status retrieval is temporarily unavailable, Leg Trading shall retain a pending status and shall not fabricate a receipt or repeat customer execution automatically.

### Requirement 7: Direct integrator-fee evidence

**Objective:** As a Leg operator, I want the direct fee destination and evidence to be auditable, so that trade fees are transparent without creating a custody contract.

#### Acceptance Criteria

1. Leg Trading shall direct every 10 bps integrator fee to the configured Leg fee wallet through the selected Uniswap route and shall make the recipient visible in quote and receipt data.
2. When a route reaches a terminal outcome, Leg Trading shall record a fee event only when provider or on-chain evidence matches the quoted fee token, amount, configured fee wallet, chain, and transaction or order reference.
3. If fee evidence is missing, mismatched, duplicated, or inconsistent with the quoted 10 bps amount, Leg Trading shall retain a pending or rejected outcome and shall not create a fee record or claim that Leg collected a fee.
4. Leg Trading shall not deploy, operate, or use a fee-receiver contract or fee-withdrawal path for an order.

### Requirement 8: Credits remain outside trading

**Objective:** As a customer, I want my prepaid Leg credits kept outside my token trade, so that credits cannot become hidden swap funds or fees.

#### Acceptance Criteria

1. Leg Trading shall not use Customer Credits as a swap input, output, allowance, recipient, authorization, reservation, debit, settlement, or source of the 10 bps trade fee.
2. Leg Trading shall not present a Customer Credits charge, balance change, or cross-chain settlement claim in a trade quote, confirmation, receipt, or order history.

### Requirement 9: Security, validation, and release evidence

**Objective:** As a Leg operator, I want trade execution to fail closed and be tested before release, so that invalid inputs and fee routing cannot silently affect customer funds.

#### Acceptance Criteria

1. If authentication, eligibility, quote validation, fee configuration, route service, chain status, or persistence is unavailable, Leg Trading shall fail closed for new execution while preserving the latest truthful pending or rejected status.
2. Leg Trading shall validate all externally supplied wallet, token, chain, amount, signature, quote, fee, recipient, and order-status inputs before use and shall log only redacted operational identifiers needed to investigate an outcome.
3. When the Trading API's current schema or route behavior cannot prove the required 10 bps fee, customer recipient, or executable action, Leg Trading shall keep the route unavailable until its integration is updated and validated.
4. Before an issuer-chain entry is enabled for customer trading, Leg Trading shall require automated evidence covering route parsing, fee disclosure, fee-recipient validation, customer confirmation, rejection handling, and terminal receipt reconciliation.
