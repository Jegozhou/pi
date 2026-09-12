# Amazon Seller Agent V0.9 Execution Plan

Date: 2026-09-13
Branch: `feat/amazon-seller-agent`
Scope: Executor interface and dry-run execution planning only. No Amazon credentials, network calls, or mutations.

## Goal

Turn an explicitly approved `SellerChangeSet` into a deterministic, auditable dry-run execution plan that a future Amazon Ads executor adapter can consume without changing the upstream diagnosis, policy, or approval pipeline.

## Safety contract

V0.9 must not:

- call Amazon Ads or Seller Central APIs;
- store or request Amazon credentials;
- mark a mutation as executed;
- accept draft, awaiting-approval, or rejected Change Sets;
- accept a stale Change Set version when the caller supplies an expected version;
- execute `review-only` proposals;
- silently skip blocked mutating proposals;
- infer missing before/after identifiers or values;
- mutate the approved Change Set.

## Domain model

Add `src/execution/` with:

- `types.ts`
- `build-dry-run.ts`

The dry run is an immutable artifact containing:

- execution mode fixed to `dry-run`;
- source Change Set ID and exact approved version;
- approval actor and timestamp;
- ordered executable operations;
- skipped analytical/review-only proposal IDs;
- validation checks for every operation;
- `writesPerformed: false`.

### Supported operations in V0.9

1. `set-bid`
   - requires target ID;
   - requires finite positive current bid;
   - requires finite positive proposed bid;
   - records before/after exactly as approved.

2. `add-negative-exact`
   - requires campaign ID;
   - requires ad group ID;
   - requires non-empty negative-exact value;
   - records the new negative target exactly as approved.

Other mutating operations (`create-exact-target`, `scale`) remain unsupported for dry-run execution planning until they receive their own fully specified contracts.

## Preflight validation

`buildSellerExecutionDryRun(changeSet, options?)` must fail closed unless:

1. `changeSet.status === "approved"`;
2. `changeSet.decision?.outcome === "approved"`;
3. at least one supported ready mutating proposal exists;
4. no mutating proposal is `blocked`;
5. each executable proposal has complete before/after data;
6. optional `expectedVersion` equals the approved Change Set version;
7. proposal `humanApprovalRequired` remains true.

Unsupported but ready mutating operations must fail rather than be silently ignored.

## Output contract

Example:

```ts
{
  id: "dryrun:changeset:v1:...:4",
  mode: "dry-run",
  sourceChangeSetId: "changeset:v1:...",
  sourceChangeSetVersion: 4,
  approvedBy: "seller@example",
  approvedAt: "2026-09-13T00:00:00.000Z",
  writesPerformed: false,
  operations: [
    {
      proposalId: "change:...",
      operation: "set-bid",
      targetId: "3001",
      before: { bid: 1.2 },
      after: { bid: 0.96 },
      checks: [
        "approved-change-set",
        "proposal-ready",
        "target-id-present",
        "before-value-present",
        "after-value-present"
      ]
    }
  ],
  skippedReviewOnlyProposalIds: []
}
```

This is a plan, not an execution result.

## TDD slices

### RED 1: approval/version gate

Tests must prove:

- draft rejected;
- awaiting approval rejected;
- rejected Change Set rejected;
- approved status without approved decision rejected;
- expected version mismatch rejected.

### RED 2: operation validation

Tests must prove:

- ready `set-bid` becomes a dry-run operation;
- ready `add-negative-exact` becomes a dry-run operation;
- blocked mutation rejects the whole dry run;
- incomplete target/before/after values reject;
- unsupported ready mutation rejects;
- review-only proposals are preserved as skipped analytical items.

### RED 3: execution semantics

Tests must prove:

- source Change Set is immutable;
- `writesPerformed` is always false;
- there is no executed/success/applied state in the artifact;
- operation order follows proposal order for auditability.

## Pi integration

Add one project extension tool:

`amazon_build_execution_dry_run`

Input:

- approved `SellerChangeSet` JSON;
- optional exact expected version.

Output:

- dry-run artifact only.

The tool description and Amazon Skill must explicitly say it performs zero Amazon writes.

## Verification

After GREEN:

- run isolated behavior checks for the execution domain;
- run strict TypeScript checking for the execution domain and Change Set types;
- compare V0.8 → V0.9 diff and confirm no network client, credential handling, or Amazon mutation adapter exists;
- keep PR Draft while full monorepo CI remains unavailable.
