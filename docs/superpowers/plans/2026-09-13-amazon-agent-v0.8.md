# Amazon Seller Agent V0.8 — Bid Simulator / Bid Policy

## Goal

Turn enriched `set-bid` Change Set proposals from `blocked` into deterministic, explainable `ready` proposals when the required inputs are available, without calling Amazon APIs or predicting future sales/ACOS.

## Scope

V0.8 only handles `set-bid` proposals produced by the existing PPC high-ACOS rule and enriched by V0.7 with `targetId` and `currentBid`.

It does not execute changes, select placement multipliers, modify campaign bidding strategy, change budgets, or calculate bids for exact-target creation/scaling proposals.

## Bid policy

The initial policy is an explicit proportional controller, not an Amazon-provided formula:

`rawBid = currentBid × targetAcos ÷ observedAcos`

The proposal is then constrained by seller-configurable guardrails:

- `maxDecreaseFraction`: maximum allowed decrease from the current bid in a single change. Default `0.20`.
- `minimumBid`: absolute floor. Default `0.02`.
- `currencyDecimals`: deterministic rounding precision. Default `2`.

For a bid-down proposal:

1. Require `currentBid > 0`.
2. Require `observedAcos > targetAcos > 0`.
3. Calculate `rawBid`.
4. Calculate the one-step floor: `currentBid × (1 - maxDecreaseFraction)`.
5. Use `max(rawBid, one-step floor, minimumBid)`.
6. Round to `currencyDecimals`.
7. Never produce a proposed bid greater than or equal to current bid for a bid-down proposal.
8. Never predict future ACOS, sales, conversions, impressions, or ranking.

## Data propagation

V0.8 needs the original PPC decision inputs to survive into the Action Plan / Change Set:

- observed ACOS from the Finding metrics
- target ACOS from the Finding thresholds

Add an optional, typed decision context to seller action/change proposals instead of parsing numbers from rationale text.

## Output model

Add a deterministic bid simulation record with at least:

- `currentBid`
- `observedAcos`
- `targetAcos`
- `rawBid`
- `proposedBid`
- `absoluteDelta`
- `percentDelta`
- `guardrailApplied`
- policy values used

After applying the policy successfully, the `set-bid` proposal becomes:

- `readiness: "ready"`
- `missingInputs: []`
- `before`: target identity + current bid
- `after`: same target identity + proposed bid

## Fail-closed behavior

Keep the proposal `blocked` when any of these is true:

- target identity missing
- current bid missing/invalid/non-positive
- observed ACOS missing/invalid/non-positive
- target ACOS missing/invalid/non-positive
- observed ACOS is not above target ACOS
- policy options are invalid
- rounding/guardrails would not create a real decrease
- Change Set is not in `draft`

Never infer missing metrics from prose.

## TDD cases

1. Proportional formula generates the raw bid.
2. Maximum single-step decrease clamps aggressive reductions.
3. Minimum bid floor is honored.
4. Proposed bid is rounded deterministically.
5. Successful policy application makes a resolved `set-bid` proposal `ready`.
6. Missing target ACOS keeps proposal blocked.
7. Missing observed ACOS keeps proposal blocked.
8. ACOS at/below target does not create a bid-down mutation.
9. Invalid policy values fail closed.
10. Input Change Set remains immutable and version increments.
11. Non-draft Change Sets cannot be simulated.
12. No future-performance prediction fields exist.

## Pi integration

Add a read-only/domain-state tool `amazon_simulate_bid_change` that accepts an enriched Change Set JSON and optional policy overrides. It returns the updated draft plus bid simulation diagnostics.

The tool must not read credentials or call Amazon.

## Safety rule

`ready` means the proposed bid is fully specified and can be presented for human approval. It never means the change has been sent to Amazon.
