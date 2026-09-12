# Amazon Seller Agent V1.1 Fake Execution Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert a signed, human-approved V1.0 Change Set into a deterministic execution plan that can be safely exercised against an in-memory fake Amazon Ads adapter with stale-state checks, idempotency, explicit receipts, and no real Amazon writes.

**Architecture:** Keep Amazon execution logic in `packages/amazon-agent`. A signed approval envelope is first compiled into an immutable `SellerExecutionPlan` with exact preconditions and deterministic idempotency keys. A `SellerExecutionAdapter` contract executes that plan; V1.1 provides only `FakeAmazonAdsExecutor`, backed by caller-owned in-memory state. Every operation returns an auditable receipt and fail-closed status. Pi exposes plan/fake-execute tools, but V1.1 still performs zero external writes.

**Tech Stack:** TypeScript, Node crypto, Vitest, existing Pi extension APIs.

**Spec:** `docs/superpowers/specs/2026-09-12-amazon-seller-agent-design.md` §18 Safety and Execution Policy.

## Global Constraints

- No Amazon Ads API, SP-API, Seller Central HTTP mutation, OAuth credential, access token, or refresh token in V1.1.
- All authoritative arithmetic and state checks remain deterministic TypeScript code.
- Execution requires the exact signed `SellerApprovalEnvelope`; unsigned approved JSON must fail closed.
- Every mutating operation preserves `humanApprovalRequired=true` provenance through the signed Change Set.
- No LLM may invent target IDs, bids, campaign IDs, ad-group IDs, or execution outcomes.
- Replaying the same execution plan must be idempotent.
- Stale live/fake state must not be overwritten silently.
- Partial failures must be explicit in receipts; no generic `success` field may imply all operations applied.
- Amazon-specific logic must remain outside Pi core.

---

### Task 1: Execution Plan Contract

**Files:**
- Create: `packages/amazon-agent/src/execution/plan-types.ts`
- Create: `packages/amazon-agent/src/execution/build-plan.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.1.test.ts`

**Interfaces:**
- Consumes: `SellerApprovalEnvelope`, `SellerApprovalSecret`, V1.0 approved `SellerChangeSet` proposals.
- Produces: `buildSellerExecutionPlan(envelope, secret, options?) => SellerExecutionPlan`.

`SellerExecutionOperation` supports only:

```ts
type SellerExecutionOperation =
  | {
      proposalId: string;
      operation: "set-bid";
      targetId: string;
      before: { bid: number };
      after: { bid: number };
      preconditions: { expectedCurrentBid: number };
      idempotencyKey: string;
    }
  | {
      proposalId: string;
      operation: "add-negative-exact";
      campaignId: string;
      adGroupId: string;
      negativeExact: string;
      preconditions: { mustNotAlreadyExist: true };
      idempotencyKey: string;
    };
```

`SellerExecutionPlan` contains exact Change Set ID/version, approval actor/time/digest, deterministic plan idempotency key, operations, and skipped review-only proposal IDs.

- [ ] **Step 1: Write failing tests** proving valid signed envelopes compile into stable operations; tampered envelopes fail; unsupported ready operations fail; plan and operation idempotency keys are deterministic and change when approved content changes.
- [ ] **Step 2: Run the targeted V1.1 test and confirm RED** because plan exports do not yet exist.
- [ ] **Step 3: Implement minimal plan types and compiler** by reusing the strict V0.9 operation validation rules and deriving keys with SHA-256 over canonical operation identity plus source Change Set ID/version/digest.
- [ ] **Step 4: Run targeted test and confirm GREEN.**
- [ ] **Step 5: Commit** `feat(agent): add seller execution plan contract`.

### Task 2: Fake Amazon Ads State and Adapter Contract

**Files:**
- Create: `packages/amazon-agent/src/execution/adapter.ts`
- Create: `packages/amazon-agent/src/execution/fake-amazon-ads-executor.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.1.test.ts`

**Interfaces:**
- Consumes: `SellerExecutionPlan`.
- Produces:

```ts
interface SellerExecutionAdapter {
  readonly name: string;
  execute(plan: SellerExecutionPlan): Promise<SellerExecutionReceipt>;
}
```

Fake state:

```ts
interface FakeAmazonAdsState {
  bidsByTargetId: Map<string, number>;
  negativeExactByScope: Set<string>;
  processedPlanKeys: Map<string, SellerExecutionReceipt>;
}
```

Receipt statuses are explicit: `applied`, `blocked-stale`, `already-applied`, `simulated-failure`, `skipped-after-failure`. The receipt declares `externalWritesPerformed: false`.

- [ ] **Step 1: Add failing tests** for successful fake bid change, successful fake negative exact addition, stale bid rejection, duplicate negative behavior, and immutable caller plan.
- [ ] **Step 2: Run targeted test and confirm RED.**
- [ ] **Step 3: Implement adapter/receipt contracts and fake executor** with exact equality preconditions; no fuzzy comparisons and no network calls.
- [ ] **Step 4: Run targeted test and confirm GREEN.**
- [ ] **Step 5: Commit** `feat(agent): add fake amazon ads executor`.

### Task 3: Idempotency and Failure Semantics

**Files:**
- Modify: `packages/amazon-agent/src/execution/fake-amazon-ads-executor.ts`
- Modify: `packages/amazon-agent/src/execution/adapter.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.1.test.ts`

**Interfaces:**
- Consumes: plan-level and operation-level deterministic idempotency keys.
- Produces: stable replay receipts and explicit partial-failure behavior.

- [ ] **Step 1: Add failing tests** proving replaying the same plan returns the prior receipt without reapplying mutations; a duplicate negative matching the desired end state becomes `already-applied`; stale bid becomes `blocked-stale`; a forced simulated failure does not masquerade as applied.
- [ ] **Step 2: Run targeted test and confirm RED.**
- [ ] **Step 3: Implement receipt replay cache and configurable fake failure injection** keyed by proposal ID. Default behavior is deterministic sequential execution; after a `simulated-failure`, later operations are `skipped-after-failure` so receipt state is unambiguous.
- [ ] **Step 4: Run targeted test and confirm GREEN.**
- [ ] **Step 5: Commit** `feat(agent): add execution idempotency and receipts`.

### Task 4: Pi Tools for Plan + Fake Execute

**Files:**
- Create: `.pi/extensions/amazon-seller/execution-plan-tool.ts`
- Create: `.pi/extensions/amazon-seller/fake-execution-tool.ts`
- Modify: `.pi/extensions/amazon-seller/index.ts`
- Modify: `.pi/skills/amazon-seller-agent.md`
- Test: `packages/amazon-agent/test/amazon-agent-v1.1-host.test.ts`

**Interfaces:**
- Tool `amazon_build_execution_plan`: consumes signed `approvalEnvelopeJson`, verifies it with the same in-process approval secret, returns plan JSON.
- Tool `amazon_fake_execute_plan`: consumes plan JSON plus explicit fake-state fixture JSON and optional forced failure proposal IDs; returns receipt with `externalWritesPerformed=false`.

- [ ] **Step 1: Write failing host tests** that load the actual Amazon extension, capture registered tools, prove unsigned input cannot build an execution plan, prove fake execution never reports external writes, and prove the tool surface exposes no live executor.
- [ ] **Step 2: Run host test and confirm RED.**
- [ ] **Step 3: Implement the two tools and register them in the existing single extension factory** so the approval secret lifecycle remains shared and process-local.
- [ ] **Step 4: Update the skill** to teach `approval → signed envelope → execution plan → fake execute`; explicitly state that fake execution is simulation and never Amazon-account execution.
- [ ] **Step 5: Run host test and full Amazon package test/build; confirm GREEN.**
- [ ] **Step 6: Commit** `feat(agent): expose V1.1 fake execution tools`.

### Task 5: V1.1 Release Gate and Documentation

**Files:**
- Modify: `packages/amazon-agent/README.md`
- Create: `docs/amazon-seller-agent-v1.1-execution.md`
- Modify: `.github/workflows/amazon-seller-agent-v1.yml`
- Test: existing Amazon release suite plus V1.1 tests.

- [ ] **Step 1: Document exact V1.1 lifecycle**, fake state schema, receipt meanings, stale-state examples, idempotency guarantees, and explicit non-goals for real Amazon writes.
- [ ] **Step 2: Extend the dedicated Amazon workflow** so V1.1 tests and host tests are included by the existing package test command and formatting/build gates remain mandatory.
- [ ] **Step 3: Run Biome, all Amazon tests, package build, and `git diff --check` in CI.**
- [ ] **Step 4: Independently review the branch for accidental network clients, credentials, approval bypasses, nondeterministic keys, swallowed partial failures, and stale-state bypasses.**
- [ ] **Step 5: Open a Draft PR to `main`** with exact verification evidence and keep it Draft until independent review reports no P0/P1 blocker.
