# Amazon Seller Agent V1.2 Trusted Live Preflight Implementation Plan

> **For agentic workers:** Use the Superpowers execution/TDD workflow task-by-task. This branch is intentionally stacked on `feat/amazon-seller-executor-v1.1` until PR #2 lands.

**Goal:** Add the trusted safety boundary required before any real Amazon Ads mutation adapter can exist: bind an approved execution plan to an exact advertiser account scope, verify current account state through a trusted reader, reserve idempotency through a storage contract, and produce a fail-closed live-execution preflight artifact that still performs zero external writes.

**Architecture:** V1.1 proved execution semantics with caller-owned fake state. V1.2 separates trusted execution inputs from model/user JSON. The domain package gains account-scope authorization, a read-only current-state provider interface, an idempotency-store interface, and a live-preflight coordinator. V1.2 ships only in-memory test implementations; it does not ship an Amazon HTTP client or mutation adapter.

**Current Amazon API boundary:** Amazon Ads describes the Ads API as a programmatic interface for campaign management, reporting, bid/keyword optimization, and other advertising automation. API access requires application/approval, and Amazon Ads APIs use OAuth 2.0 authorization. V1.2 deliberately stops before those credentials and endpoints are introduced.

Official references checked September 2026:
- https://advertising.amazon.com/about-api
- https://advertising.amazon.com/resources/whats-new/amc-api-available-on-amazon-ads-api

## Global Constraints

- No Amazon Ads/Seller Central/SP-API write call in V1.2.
- No OAuth client secret, access token, refresh token, or credential persistence in V1.2.
- No Pi/model tool may accept caller-supplied state and label it `live` or `trusted`.
- A future real executor must never trust the V1.1 caller-owned `processedPlanKeys` cache.
- Account scope must be supplied by a trusted host/connector boundary and bound into execution authorization.
- Current-state checks must come from a `SellerExecutionStateReader`, not from plan JSON or LLM prose.
- Any stale/unavailable mutating operation blocks the whole live-preflight batch. V1.2 does not allow partial real execution.
- Idempotency reservation must be scoped by advertiser account plus plan key.
- Every output must explicitly report `externalWritesPerformed: false`.
- Amazon-specific logic stays outside Pi core.

---

### Task 1: Trusted Account Scope + Execution Authorization Envelope

**Files:**
- Create: `packages/amazon-agent/src/live-execution/account-scope.ts`
- Create: `packages/amazon-agent/src/live-execution/authorization.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.2-authorization.test.ts`

**Contracts:**

```ts
interface SellerAmazonAdsAccountScope {
  profileId: string;
  marketplaceId: string;
  region: "NA" | "EU" | "FE";
}

interface SellerExecutionAuthorization {
  planId: string;
  planIdempotencyKey: string;
  sourceChangeSetId: string;
  sourceChangeSetVersion: number;
  approvedContentDigest: string;
  accountScope: SellerAmazonAdsAccountScope;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  provenance: "trusted-host";
}
```

A signed authorization envelope binds the exact deterministic V1.1 plan to one account scope and a short validity window.

- [ ] Write RED tests for scope validation, deterministic payload canonicalization, signature verification, expiration, scope tampering, plan tampering, and invalid/blank identifiers.
- [ ] Confirm RED because V1.2 exports do not exist.
- [ ] Implement minimal HMAC-backed authorization helpers suitable for trusted-host integration tests. The secret is injected; it is never generated from model input.
- [ ] Confirm GREEN.

### Task 2: Trusted Current-State Reader + Fail-Closed Operation Preflight

**Files:**
- Create: `packages/amazon-agent/src/live-execution/state-reader.ts`
- Create: `packages/amazon-agent/src/live-execution/preflight.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.2-preflight.test.ts`

**Contracts:**

```ts
interface SellerExecutionStateReader {
  readOperationState(
    scope: SellerAmazonAdsAccountScope,
    operation: SellerExecutionOperation,
  ): Promise<SellerTrustedOperationState>;
}
```

Supported trusted state:
- `set-bid`: current target bid or unavailable.
- `add-negative-exact`: whether the exact scoped negative already exists or unavailable.

Per-operation results:
- `ready`
- `already-desired`
- `blocked-stale`
- `blocked-unavailable`

Batch rule: if any mutation is stale/unavailable, the full live-preflight is blocked. `already-desired` is safe but does not create a mutation.

- [ ] Write RED tests for exact bid match, stale bid, missing target state, duplicate negative, unavailable negative lookup, mixed batch fail-closed behavior, and reader exceptions converted to explicit unavailable results.
- [ ] Implement preflight with no mutation method in the reader interface.
- [ ] Confirm GREEN.

### Task 3: Trusted Idempotency Store Contract

**Files:**
- Create: `packages/amazon-agent/src/live-execution/idempotency-store.ts`
- Create: `packages/amazon-agent/src/live-execution/in-memory-idempotency-store.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.2-idempotency.test.ts`

**Contract goals:**
- key space includes account scope + plan idempotency key;
- reserve exactly once;
- same scope/key/content returns replay metadata;
- same scope/key with conflicting content fails closed;
- another account scope cannot reuse another account's reservation;
- in-memory implementation is explicitly test/dev only.

Suggested interface:

```ts
interface SellerExecutionIdempotencyStore {
  reserve(request: SellerExecutionIdempotencyReservation): Promise<
    | { status: "reserved"; reservation: SellerExecutionReservation }
    | { status: "replay"; reservation: SellerExecutionReservation }
    | { status: "conflict" }
  >;
}
```

- [ ] Write RED tests for first reserve, replay, conflict, account isolation, and immutability.
- [ ] Implement storage contract plus in-memory adapter.
- [ ] Confirm GREEN.

### Task 4: Live-Execution Preflight Coordinator

**Files:**
- Create: `packages/amazon-agent/src/live-execution/build-live-preflight.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.2-live-preflight.test.ts`

**Input:**
- V1.1 `SellerExecutionPlan`
- valid signed V1.2 execution-authorization envelope
- trusted `SellerExecutionStateReader`
- trusted `SellerExecutionIdempotencyStore`

**Output:**

```ts
interface SellerLiveExecutionPreflight {
  status:
    | "ready-for-live-adapter"
    | "blocked-stale"
    | "blocked-unavailable"
    | "replay";
  accountScope: SellerAmazonAdsAccountScope;
  planId: string;
  planIdempotencyKey: string;
  reservationId: string | null;
  operations: SellerLiveOperationPreflight[];
  externalWritesPerformed: false;
}
```

Safety order:
1. verify authorization signature + expiry;
2. verify plan identity/digest/scope binding;
3. read trusted current state for every operation;
4. fail whole batch if stale/unavailable;
5. reserve scoped idempotency only after preflight is safe;
6. return `ready-for-live-adapter`; still perform zero writes.

- [ ] RED tests for valid ready batch, expired auth, wrong account scope, plan mismatch, stale mixed batch, unavailable state, replay reservation, and conflict.
- [ ] Implement coordinator.
- [ ] Confirm GREEN.

### Task 5: Release Gate + Real-Executor Readiness Documentation

**Files:**
- Create: `docs/amazon-seller-agent-v1.2-live-preflight.md`
- Modify: `packages/amazon-agent/README.md`
- Test: all Amazon package suites.

Document the exact trust boundary:

```text
LLM / chat
   ↓ requests intent only
host / connector
   ↓ supplies authenticated account scope
signed approved plan
   ↓
trusted current-state reader
   ↓
full-batch live preflight
   ↓
trusted idempotency reservation
   ↓
ready-for-live-adapter
   ↓
NO WRITE IN V1.2
```

A future V1.3 real Amazon Ads adapter may be added only after:
- OAuth/account connection is implemented outside model control;
- account profile/scope is resolved by the connector;
- live state is re-read immediately before mutation;
- a persistent atomic idempotency store exists;
- rate-limit/retry policy exists;
- operation receipts are persisted;
- partial-failure/recovery semantics are explicitly designed;
- the adapter passes the same contract suite against a non-production test account or Amazon-supported sandbox/test path if available.

- [ ] Run dedicated Amazon formatting, full package tests, package build, and whitespace gate.
- [ ] Review diff for any network client, credential material, model-controlled trust input, or accidental mutation capability.
- [ ] Keep the V1.2 PR Draft until all package-specific gates pass and no P0/P1 blocker remains.
