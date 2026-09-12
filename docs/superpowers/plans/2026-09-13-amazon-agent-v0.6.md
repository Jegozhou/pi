# Amazon Seller Agent V0.6 — Approval + Change Set Plan

## Goal

Turn V0.5 action-plan recommendations into an auditable pre-execution Change Set without adding any Amazon account mutation capability.

V0.6 must make an important safety distinction: a recommendation is not automatically an executable change. If the source data does not contain the identifiers/current values needed to define an exact mutation, the proposal must remain blocked instead of inventing them.

## Product behavior

Flow:

```text
Findings
  -> Seller Action Plan
  -> Change Set draft
  -> readiness check
  -> human approval/rejection
  -> approved change set (still not executed in V0.6)
```

## Required domain model

Add `packages/amazon-agent/src/change-set/` with:

- `types.ts`
- `build-change-set.ts`
- `decide-change-set.ts`

A Change Set contains:

- stable id
- source action-plan item ids
- version
- lifecycle status
- individual change proposals
- evidence inherited from the source finding
- explicit missing inputs
- approval decision metadata

### Lifecycle

Change set status:

- `draft`: created but not ready to request approval
- `awaiting-approval`: all mutating proposals are fully specified
- `approved`: human explicitly approved
- `rejected`: human explicitly rejected

Proposal readiness:

- `blocked`: exact mutation cannot yet be specified from available evidence
- `review-only`: analysis/review action, not an Amazon account mutation
- `ready`: mutation is fully specified

V0.6 does not execute anything.

## Fail-closed mapping from V0.5 actions

Current Search Term / profitability inputs do not carry enough Amazon entity IDs and current settings for safe account mutations. Therefore the initial mapping must be conservative:

- `negative-exact-candidate` -> blocked; needs campaign/ad-group identity or equivalent execution scope
- `reduce-bid-candidate` -> blocked; needs target identity and current/proposed bid
- `exact-target-candidate` -> blocked; needs destination campaign/ad-group identity and proposed bid
- `scale-candidate` -> blocked; needs explicit scale mechanism and before/after value
- `review-profitability-candidate` -> review-only; never represented as an Amazon mutation

This is intentional. Do not infer account IDs, current bids, budgets, or target values from names.

## Decision rules

`requestSellerChangeSetApproval(changeSet)`:

- succeeds only when there is at least one `ready` mutating proposal
- fails if any mutating proposal is `blocked`
- review-only proposals do not block approval
- returns a new immutable value with status `awaiting-approval`

`decideSellerChangeSet(changeSet, decision)`:

- only accepts a set currently `awaiting-approval`
- decision is `approve` or `reject`
- requires non-empty actor and ISO timestamp
- returns a new value; must not mutate the input
- approving does not execute changes

## Tests first

Create `packages/amazon-agent/test/amazon-agent-v0.6.test.ts` before production code.

Required cases:

1. action-plan item becomes a traceable proposal with evidence and source ids
2. PPC candidate is blocked when mutation identifiers/current values are unavailable
3. profitability review is `review-only`
4. blocked mutating proposal prevents approval request
5. review-only-only change set cannot masquerade as an executable approval request
6. a fully specified synthetic ready proposal can enter `awaiting-approval`
7. explicit human approval transitions to `approved` without execution metadata
8. rejection transitions to `rejected`
9. invalid lifecycle transition fails closed
10. decision functions are immutable/deterministic

## Pi integration

Add read-only/domain-only tools:

- `amazon_build_change_set`
- `amazon_request_change_set_approval`
- `amazon_decide_change_set`

These tools only transform supplied JSON/domain values. They must not call Amazon APIs or write external state.

Update `.pi/skills/amazon-seller-agent.md` so the model understands:

- recommendations are not mutations
- blocked proposals require more seller/account data
- approval is explicit
- `approved` means approved for a future executor, not executed

## Non-goals

V0.6 explicitly does not:

- call SP-API or Amazon Ads API
- write bulk files for upload
- modify bids/budgets/keywords/campaigns/listings
- infer missing account IDs
- infer current bid/budget values
- store approvals in a database
- implement authentication/RBAC

## Exit criteria

V0.6 is complete when:

- RED is observed before implementation
- Change Set behavior tests pass
- strict TypeScript check passes for the new domain layer
- PR diff still contains no Amazon account mutation implementation
- PR remains Draft until full repository CI is available
