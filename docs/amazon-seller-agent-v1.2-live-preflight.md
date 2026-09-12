# Amazon Seller Agent V1.2 Trusted Live Preflight

V1.2 adds the safety boundary required **before** a real Amazon Ads mutation adapter can be introduced. It still performs zero external writes.

The central rule is that model/user-provided JSON is not trusted live account state. A future live executor may proceed only after an authenticated host or connector binds the exact approved execution plan to an exact Amazon Ads account scope, trusted current state is re-read, and a scoped idempotency reservation succeeds.

## What V1.2 adds

V1.2 introduces four domain boundaries:

1. **Trusted account scope and signed execution authorization**
   - `profileId`
   - `marketplaceId`
   - region (`NA`, `EU`, or `FE`)
   - exact V1.1 execution plan ID and idempotency key
   - canonical SHA-256 digest of the complete execution plan, including operations and preconditions
   - exact source Change Set ID/version and approved-content digest
   - issued/expires timestamps and nonce
   - `trusted-host` provenance
   - HMAC-SHA256 proof

2. **Read-only trusted current-state reader**
   - `SellerExecutionStateReader` can only read state.
   - It exposes no mutation methods.
   - `set-bid` reads the current target bid.
   - `add-negative-exact` reads whether the exact scoped negative already exists.

3. **Trusted idempotency-store contract**
   - the namespace is Amazon Ads account scope + plan idempotency key;
   - first identical request is `reserved`;
   - exact replay is `replay`;
   - same scoped key with different authorized content is `conflict`;
   - the included in-memory implementation is test/development infrastructure, not a production persistence layer.

4. **Full-batch live-preflight coordinator**
   - verifies the signed authorization before reading account state;
   - reads trusted current state for every operation;
   - blocks the whole batch on stale or unavailable state;
   - skips reservation when all desired end-state already exists;
   - reserves idempotency only after state preflight is safe;
   - returns `ready-for-live-adapter` only after all gates pass;
   - always returns `externalWritesPerformed: false`.

## Trust flow

```text
LLM / chat
  ↓ intent only
host / future authenticated connector
  ↓ supplies trusted account scope
approved V1.1 SellerExecutionPlan
  ↓ exact plan content + scope bound together
signed SellerExecutionAuthorizationEnvelope
  ↓ verify signature + expiry + plan identity + full plan content digest
SellerExecutionStateReader
  ↓ trusted current state
full-batch state preflight
  ├─ blocked-stale
  ├─ blocked-unavailable
  ├─ already-desired
  └─ ready
       ↓
SellerExecutionIdempotencyStore.reserve(...)
  ├─ conflict
  ├─ replay
  └─ reserved
       ↓
ready-for-live-adapter
       ↓
STOP — V1.2 performs no Amazon mutation
```

## Account-scope authorization

The authorization envelope is created by a trusted boundary, not by the model. It binds one exact plan to one exact account scope for a limited time.

The envelope includes `executionPlanContentDigest`, a canonical SHA-256 digest over the complete `SellerExecutionPlan`. This means authorization is bound not only to the plan ID but also to the actual operation list, target IDs, before/after values, preconditions, operation idempotency keys, approval metadata, and skipped-review IDs.

Verification fails if:

- the account scope is edited;
- the plan ID/idempotency key changes;
- any execution-plan operation or precondition changes while the identity fields are preserved;
- the source Change Set identity/version changes;
- the approved-content digest changes;
- the plan-content digest changes;
- the authorization content digest or signature changes;
- the authorization has not reached `issuedAt`;
- the authorization has expired.

This is the first hard boundary against applying an otherwise valid seller decision to the wrong Amazon Ads profile or executing mutated operation content after authorization.

## Trusted state semantics

Per-operation preflight statuses are:

- `ready`: trusted current state still equals the approved before-state and the mutation is still needed;
- `already-desired`: trusted state already equals the approved desired end-state;
- `blocked-stale`: trusted state changed to a different value since approval;
- `blocked-unavailable`: current state could not be trusted/read/validated.

For a real-execution boundary, partial execution is not allowed at preflight time. If any operation is `blocked-stale` or `blocked-unavailable`, the full batch is blocked and no idempotency reservation is created.

Examples:

```text
approved set-bid: 1.20 → 0.96
trusted current bid = 1.20  => ready
trusted current bid = 0.96  => already-desired
trusted current bid = 0.80  => blocked-stale
cannot read target            => blocked-unavailable
```

```text
approved add-negative-exact: "free trail shoes"
trusted scoped negative absent  => ready
trusted scoped negative exists  => already-desired
cannot verify scoped negatives  => blocked-unavailable
```

## Idempotency semantics

The V1.2 idempotency storage key is scoped by:

```text
Amazon Ads account scope + planIdempotencyKey
```

Stored reservation content also binds:

- plan ID;
- approved-content digest;
- execution-authorization content digest.

That gives three explicit outcomes:

- `reserved`: first matching request for this account/plan;
- `replay`: exact same authorized content was already reserved;
- `conflict`: the same account-scoped plan key is being reused with different authorized content.

A future production store must provide durable/atomic semantics. The current in-memory implementation intentionally does not claim production durability.

## Coordinator statuses

`buildSellerLiveExecutionPreflight(...)` can return:

- `ready-for-live-adapter`: trusted authorization, state, and idempotency gates all passed and at least one mutation is still needed;
- `already-desired`: every operation is already at the approved desired state, so no reservation or future mutation is needed;
- `blocked-stale`: at least one trusted before-state no longer matches;
- `blocked-unavailable`: trusted current state could not be established;
- `blocked-idempotency-conflict`: the scoped plan key conflicts with different authorized content;
- `replay`: the same authorized account-scoped plan was already reserved.

Every result includes `externalWritesPerformed: false`.

## Why V1.2 is not exposed as a Pi model tool

V1.2 deliberately does **not** register a model-callable `live` tool. The current Pi chat surface cannot turn caller JSON into trusted Amazon account identity/current state simply by naming it `live`.

A future connector/host integration must provide:

- authenticated Amazon Ads account/profile context;
- OAuth credentials outside model control;
- a trusted state reader backed by the authenticated account;
- a durable/atomic idempotency store.

Only then should a host-controlled live-preflight entrypoint be wired into the product.

## What V1.2 does not contain

There is no:

- Amazon Ads mutation HTTP client;
- Seller Central or SP-API mutation client;
- OAuth access token or refresh token handling;
- `updateBid` implementation;
- negative-keyword creation implementation;
- production database-backed idempotency store;
- retry/rate-limit layer for Amazon mutations;
- production audit-receipt persistence;
- rollback/recovery engine.

`ready-for-live-adapter` therefore means only: **the deterministic safety prerequisites have passed**. It does not mean anything was changed in Amazon.

## Gate before a future V1.3 real adapter

Do not add real mutation calls until all of the following exist and are independently tested:

- OAuth/account connection is resolved outside model control;
- authenticated profile/marketplace/region is supplied by the connector;
- current target/negative state is fetched from that authenticated scope immediately before mutation;
- persistent atomic idempotency reservation exists;
- operation receipts are durably recorded;
- rate-limit/retry behavior is explicit;
- partial-failure/recovery semantics are explicit;
- real mutations remain bound to the exact approved Change Set and V1.2 authorization.

Amazon Ads describes its API as a programmatic interface for advertising management and requires API access approval; Amazon Ads APIs use OAuth 2.0 authorization. Those capabilities belong in the future authenticated connector/executor layer, not in the LLM or V1.2 domain preflight.

References checked September 2026:

- https://advertising.amazon.com/about-api
- https://advertising.amazon.com/resources/whats-new/amc-api-available-on-amazon-ads-api
