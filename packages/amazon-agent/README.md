# Amazon Seller Agent

A file-first Amazon seller decision engine built on Pi. It turns supported seller reports into deterministic metrics, evidence-backed findings, ranked actions, auditable Change Sets, host-confirmed human approval, signed execution plans, and zero-external-write fake execution receipts.

This package is intentionally not an Amazon-themed chatbot. Numerical facts and state transitions are produced by deterministic TypeScript; the LLM chooses tools, interprets results, asks for missing seller inputs, and explains decisions.

## Current scope

The merged V1.0 baseline supports two core workflows:

- Sponsored Products PPC diagnosis from Search Term reports.
- ASIN/SKU known-contribution profitability diagnosis from seller-provided cost data.

V1.1 adds an execution safety layer after approval:

- compile a signed approval envelope into a deterministic `SellerExecutionPlan`;
- attach exact stale-state preconditions and deterministic idempotency keys;
- execute only against caller-supplied in-memory fake Amazon Ads state;
- return explicit operation receipts for applied fake state, stale state, duplicates, simulated failures, and skipped operations;
- keep `externalWritesPerformed: false` for every fake execution receipt.

V1.1 still does **not** connect to Amazon Ads or Seller Central, store Amazon credentials, or write account changes. `approved` means the host UI recorded a human decision for an exact sealed Change Set. A fake receipt status of `applied` means only that the local fake state changed.

## Core pipeline

```text
seller request
→ report inspection / parsing
→ deterministic data-quality validation
→ deterministic metrics
→ deterministic diagnostic rules
→ ranked Action Plan
→ Change Set
→ target identity enrichment
→ deterministic bid policy where applicable
→ awaiting approval
→ host UI human confirmation
→ signed approval envelope
→ execution Dry Run or deterministic Execution Plan
→ FakeAmazonAdsExecutor
→ explicit zero-external-write receipt
```

## Inputs

### Sponsored Products Search Term report

Required semantic fields include campaign name, ad group name, customer search term, impressions, clicks, spend, and attributed sales. Orders, targeting, match type, currency, and related fields improve diagnosis.

Header-only reports are insufficient. Malformed numeric values, negative advertising metrics, and blank required numeric values stop PPC diagnosis rather than silently becoming business facts.

### Profitability input

At minimum provide ASIN or SKU plus gross sales. Stronger profitability claims require units, refunds, Amazon fees, fulfillment/storage fees, advertising spend, COGS/unit, and other variable costs. Missing costs remain explicit; partial data is never called net profit.

A header-only profitability report is insufficient and invalid numeric values stop diagnosis.

### Target snapshot

For account-object resolution provide non-empty campaign name + ID and ad group name + ID. Targeting, match type, target ID, positive current bid, and state enable target-level bid preparation.

Blank IDs are never considered valid identity. If duplicate rows for one target ID disagree on scope, targeting, match type, bid, or state, resolution fails ambiguous instead of choosing the last row.

CSV and TSV are the current first-class file formats. XLSX is not part of the verified release yet.

### Fake execution state

V1.1 fake execution uses explicit caller-supplied local state. A Pi tool input can look like:

```json
{
  "bidsByTargetId": {
    "3001": 1.2
  },
  "negativeExactByScope": []
}
```

This is simulation state only. It is never fetched from or synchronized with Amazon.

## Pi tools

The project-local Amazon extension exposes:

- `amazon_inspect_report`
- `amazon_diagnose_ppc`
- `amazon_diagnose_profit`
- `amazon_build_action_plan`
- `amazon_build_change_set`
- `amazon_enrich_change_set`
- `amazon_simulate_bid_change`
- `amazon_request_change_set_approval`
- `amazon_decide_change_set`
- `amazon_build_execution_dry_run`
- `amazon_build_execution_plan`
- `amazon_fake_execute_plan`

Use the project Skill at `.pi/skills/amazon-seller-agent.md` to teach the model when to call each tool and where the safety boundaries are.

## Deterministic bid proposal

For a high-ACOS bid-down candidate, the current product policy is:

```text
rawBid = currentBid × targetACOS ÷ observedACOS
```

This is not an Amazon-provided formula and is not represented as optimal or guaranteed. The default policy caps a single decrease at 20%, applies a minimum bid floor, and rounds deterministically.

Example:

```text
current bid:   $1.20
observed ACOS: 60%
target ACOS:   30%
raw bid:       $0.60
20% guardrail: $0.96
proposal:      $1.20 → $0.96
```

The proposal still requires host-confirmed human approval.

## Approval integrity

`amazon_request_change_set_approval` only moves a complete draft to `awaiting-approval`.

`amazon_decide_change_set` is model-callable only as a request to open the Pi host confirmation dialog. The tool itself requires a dialog-capable host. The human sees the exact Change Set ID/version and each proposal's before/after state and must click confirm before an approval or rejection is recorded.

A conversational “approve” and a model-provided actor label are not approval proof.

For an approval, the system:

1. records host UI provenance and a host-generated timestamp;
2. computes a canonical SHA-256 digest over the exact approved Change Set content;
3. signs the approval with an ephemeral per-extension HMAC key;
4. returns a signed approval envelope.

`amazon_build_execution_dry_run` and `amazon_build_execution_plan` accept that signed envelope, not a bare approved Change Set. Any post-approval edit to proposal scope, target IDs, before/after values, decision content, digest, or signature fails verification.

The signing key is intentionally ephemeral. An extension reload/process restart requires fresh human approval rather than replaying an unverifiable old envelope.

## Execution plan and idempotency

`amazon_build_execution_plan` reuses the same signed-envelope verification and operation validation as the zero-write dry-run boundary.

Supported plan mutations are currently:

- `set-bid`
- `add-negative-exact`

A set-bid operation contains an exact `expectedCurrentBid` precondition. An add-negative-exact operation carries the exact campaign/ad-group scope and negative term.

Plan and operation idempotency keys are derived deterministically from the exact approved content. If separately approved mutation content changes, the keys change too.

The fake adapter stores prior receipts by plan key in caller-owned state. Replaying the same plan returns the prior receipt instead of applying fake state changes twice.

## Fake execution receipts

`amazon_fake_execute_plan` applies the plan only to in-memory fake state and returns `externalWritesPerformed: false`.

Operation statuses are explicit:

- `applied`: applied to fake in-memory state only;
- `blocked-stale`: current fake state did not match the approved precondition;
- `already-applied`: the desired fake end-state already existed;
- `simulated-failure`: a forced fake failure used to test failure handling;
- `skipped-after-failure`: a later operation was not attempted after a prior simulated failure.

Partial fake execution is preserved operation-by-operation rather than compressed into an overall success boolean.

See `docs/amazon-seller-agent-v1.1-execution.md` for the full execution-safety contract.

## LLM responsibility

The LLM may:

- interpret a seller's natural-language goal;
- choose and sequence Amazon tools;
- explain structured findings and evidence;
- ask for missing seller targets/costs;
- request that the host display the exact approval confirmation dialog;
- explain execution-plan preconditions and fake receipts.

The LLM is not authoritative for:

- ACOS/ROAS/CTR/CVR/CPC arithmetic;
- contribution-profit calculations;
- data-quality acceptance;
- rule firing;
- target ID resolution;
- bid-policy math;
- approval proof;
- idempotency identity;
- Amazon account execution.

Those responsibilities stay in deterministic code and the trusted host boundary.

## Evaluation and regression coverage

Synthetic V1.0 fixtures live under `test/fixtures/v1.0/`. The baseline acceptance scenario covers:

- zero-sales PPC waste;
- high-ACOS bid-down;
- efficient search-term migration/scale detection;
- negative known contribution profit;
- target identity resolution;
- `$1.20 → $0.96` guarded bid proposal;
- explicit approval state transition;
- two-operation zero-write dry run.

V1.1 regression suites add coverage for:

- deterministic execution-plan compilation;
- signed-envelope tamper rejection;
- deterministic plan and operation idempotency keys;
- unsupported ready mutation rejection;
- fake bid application;
- stale bid rejection;
- duplicate exact negative detection;
- immutable execution plans;
- plan replay receipt caching;
- forced simulated failure and later-operation skipping;
- partial-failure receipts;
- actual Pi extension registration of V1.1 tools;
- host-approved envelope → execution plan → fake execution with zero external writes.

## Safety contract

Every mutation proposal preserves `humanApprovalRequired: true`.

The system fails closed when identifiers, current values, targets, before/after states, report data, approval proof, or execution preconditions are missing, invalid, ambiguous, stale, or modified.

V1.1 contains no Amazon Ads/Seller Central mutation client, OAuth execution flow, access token, refresh token, or live executor. It must never claim a fake receipt represents a live Amazon change.

## Current release limitations

The V1.1 file-first operator still has explicit gaps that should not be hidden:

- no verified XLSX adapter;
- no persistent seller profile/store policy persistence;
- no real Amazon Ads/SP-API connector or live mutation executor;
- no persistent production idempotency/receipt store;
- no live state refetch, retry/rate-limit layer, or rollback support;
- no scheduled daily execution;
- no web/WorkBuddy operational UI;
- root monorepo CI may still be affected by the pre-existing upstream Pi core type error already documented in V1.0; the dedicated Amazon release gate is the package-specific release signal.
