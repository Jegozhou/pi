# Amazon Seller Agent V1.1 Execution Safety Layer

V1.1 extends the merged V1.0 file-first operator with a deterministic execution contract and an in-memory fake Amazon Ads adapter. It is intentionally still a zero-external-write release.

## Lifecycle

```text
seller reports
→ deterministic diagnosis
→ ranked Action Plan
→ Change Set
→ target identity enrichment
→ guarded bid simulation
→ awaiting approval
→ host UI human confirmation
→ signed approval envelope
→ deterministic Execution Plan
→ FakeAmazonAdsExecutor
→ explicit execution receipt
```

Nothing in this V1.1 lifecycle calls Amazon Ads, Seller Central, SP-API, or any external mutation endpoint.

## Execution Plan

`amazon_build_execution_plan` accepts only the signed approval envelope returned after host UI confirmation. The same ephemeral in-process approval secret used for V1.0 approval verification is used to compile the plan.

The plan preserves:

- source Change Set ID and approved version;
- approval actor, timestamp, and content digest;
- deterministic plan-level idempotency key;
- deterministic operation-level idempotency keys;
- exact before/after values;
- exact stale-state preconditions;
- review-only proposal IDs that were intentionally skipped.

Supported execution-plan mutations remain deliberately narrow:

- `set-bid`
- `add-negative-exact`

Unsupported ready mutation types fail closed rather than being omitted silently.

### Set-bid precondition

A bid operation records the approved current bid as `expectedCurrentBid`.

```text
approved before bid = 1.20
approved after bid  = 0.96
precondition        = current bid must still equal 1.20
```

If fake current state is now `0.80`, the operation returns `blocked-stale` and the fake executor does not overwrite it.

### Negative exact precondition

An `add-negative-exact` operation records campaign ID, ad-group ID, and the exact negative term. If the same scoped negative is already present in fake state, the result is `already-applied` rather than adding a duplicate.

## Deterministic idempotency

Plan and operation keys are derived from the exact approved content using SHA-256. The same signed approval produces the same execution-plan keys. A separately approved content change produces different keys.

The fake executor keeps a caller-owned `processedPlanKeys` receipt cache. Replaying the same plan key returns the prior receipt and does not reapply state changes.

This is the V1.1 safety model for retryable execution. A future live adapter must persist equivalent idempotency receipts outside process memory before it is allowed to mutate Amazon.

## Fake state

The Pi fake-execution tool accepts explicit JSON state such as:

```json
{
  "bidsByTargetId": {
    "3001": 1.2
  },
  "negativeExactByScope": []
}
```

The domain adapter represents the same state as:

```ts
interface FakeAmazonAdsState {
  bidsByTargetId: Map<string, number>;
  negativeExactByScope: Set<string>;
  processedPlanKeys: Map<string, SellerExecutionReceipt>;
}
```

This state is local test state only. It is not read from or synchronized with Amazon.

## Receipt semantics

Every fake receipt declares:

```text
externalWritesPerformed = false
```

Operation statuses are explicit:

| Status | Meaning |
| --- | --- |
| `applied` | The operation changed only the supplied fake in-memory state. |
| `blocked-stale` | Fake current state no longer matched the approved precondition. Nothing was overwritten. |
| `already-applied` | The desired fake end-state already existed, such as an existing exact negative. |
| `simulated-failure` | The fake adapter was explicitly instructed to fail this proposal for testing. |
| `skipped-after-failure` | A prior operation failed, so this later operation was not attempted. |

The word `applied` in a fake receipt must never be described as applied in Amazon.

## Partial failure example

Given two operations:

```text
1. set-bid
2. add-negative-exact
```

If the second operation is forced to fail, the receipt is explicit:

```text
set-bid            → applied in fake state
add-negative-exact → simulated-failure
external writes    → false
```

If the first operation is forced to fail:

```text
set-bid            → simulated-failure
add-negative-exact → skipped-after-failure
external writes    → false
```

No overall boolean hides the partial state.

## Pi tools

V1.1 adds two tools to the existing Amazon extension:

- `amazon_build_execution_plan`
- `amazon_fake_execute_plan`

The safe flow is:

```text
amazon_request_change_set_approval
→ amazon_decide_change_set
→ host human confirmation
→ signed approval envelope
→ amazon_build_execution_plan
→ amazon_fake_execute_plan
```

`amazon_build_execution_dry_run` remains available as the simpler static preflight artifact. Execution Plan is the more explicit contract intended for adapters.

## What V1.1 still does not do

V1.1 contains no:

- Amazon Ads write API client;
- Seller Central mutation client;
- SP-API mutation client;
- OAuth flow for Amazon execution;
- access token or refresh token handling;
- live account-state refetch;
- persistent idempotency store;
- live execution receipt store;
- rollback implementation.

A real Amazon Ads executor should not be added until account scoping, OAuth, live precondition refetch, persistent idempotency, retry/rate-limit behavior, audit receipts, and partial-failure recovery are designed and independently reviewed.
