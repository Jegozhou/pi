# Amazon Seller Agent

A file-first Amazon seller decision engine built on Pi. It turns supported seller reports into deterministic metrics, evidence-backed findings, ranked actions, auditable Change Sets, host-confirmed human approval, and zero-write execution dry runs.

This package is intentionally not an Amazon-themed chatbot. Numerical facts and state transitions are produced by deterministic TypeScript; the LLM chooses tools, interprets results, asks for missing seller inputs, and explains decisions.

## V1.0 scope

V1.0 supports two core workflows:

- Sponsored Products PPC diagnosis from Search Term reports.
- ASIN/SKU known-contribution profitability diagnosis from seller-provided cost data.

The pipeline can also resolve local Amazon Ads target identity from a supplied target snapshot, simulate guarded bid reductions, prepare Change Sets, request host-confirmed approval/rejection, and build an execution dry run from a signed approval envelope.

V1.0 does **not** connect to Amazon Ads or Seller Central, store Amazon credentials, or write account changes. `approved` means the host UI recorded a human decision for an exact sealed Change Set. `dry-run` means no write occurred.

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
→ execution Dry Run
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

CSV and TSV are the current first-class file formats. XLSX is not part of the verified V1.0 release candidate yet.

## Pi tools

The project-local Amazon extension currently exposes tools for:

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

Use the project Skill at `.pi/skills/amazon-seller-agent.md` to teach the model when to call each tool and where the safety boundaries are.

## Deterministic bid proposal

For a high-ACOS bid-down candidate, V1.0 uses an explicit product policy:

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

A conversational “approve” and the model-provided `actor` label are not approval proof.

For an approval, the system:

1. records host UI provenance and a host-generated timestamp;
2. computes a canonical SHA-256 digest over the exact approved Change Set content;
3. signs the approval with an ephemeral per-extension HMAC key;
4. returns a signed approval envelope.

`amazon_build_execution_dry_run` accepts that signed envelope, not a bare approved Change Set. Any post-approval edit to proposal scope, target IDs, before/after values, decision content, digest, or signature fails verification.

The signing key is intentionally ephemeral. An extension reload/process restart requires fresh human approval rather than replaying an unverifiable old envelope.

## LLM responsibility

The LLM may:

- interpret a seller's natural-language goal;
- choose and sequence Amazon tools;
- explain structured findings and evidence;
- ask for missing seller targets/costs;
- request that the host display the exact approval confirmation dialog.

The LLM is not authoritative for:

- ACOS/ROAS/CTR/CVR/CPC arithmetic;
- contribution-profit calculations;
- data-quality acceptance;
- rule firing;
- target ID resolution;
- bid-policy math;
- approval proof;
- Amazon account execution.

Those responsibilities stay in deterministic code and the trusted host boundary.

## Evaluation fixtures

Synthetic V1.0 fixtures live under `test/fixtures/v1.0/`. The acceptance scenario covers:

- zero-sales PPC waste;
- high-ACOS bid-down;
- efficient search-term migration/scale detection;
- negative known contribution profit;
- target identity resolution;
- `$1.20 → $0.96` guarded bid proposal;
- explicit approval state transition;
- two-operation zero-write dry run.

Additional V1.0 regression suites cover release blockers and data-quality hardening, including approved-content tampering, blank identifiers, conflicting target snapshots, empty reports, invalid/negative numeric data, non-positive bids, missing scale target context, and Change Set ID collisions.

## Safety contract

Every mutation proposal preserves `humanApprovalRequired: true`.

The system fails closed when identifiers, current values, targets, before/after states, report data, or approval proof are missing, invalid, ambiguous, stale, or modified. It must never claim an Amazon change was executed unless a future real executor returns and records that result.

## Current release limitations

The V1.0 file-first operator still has explicit gaps that should not be hidden:

- no verified XLSX adapter;
- no persistent seller profile/store policy persistence;
- no real Amazon Ads/SP-API connector;
- no scheduled daily execution;
- no web/WorkBuddy operational UI;
- full monorepo CI has not yet been observed on the current fork/PR.

See `docs/amazon-seller-agent-v1.0-release-checklist.md` before moving the PR out of Draft.
