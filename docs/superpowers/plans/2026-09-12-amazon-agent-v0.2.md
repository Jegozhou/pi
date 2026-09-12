# Amazon Agent V0.2 Implementation Plan

**Goal:** Add a deterministic PPC diagnostic engine that turns normalized advertising rows into auditable seller findings using seller-configurable policy.

**Architecture:** Keep diagnosis inside `packages/amazon-agent`. Rules consume normalized rows plus deterministic metrics and return structured `Finding` objects. Rules never mutate Amazon state and never let the LLM decide arithmetic thresholds.

**Spec:** `docs/superpowers/specs/2026-09-12-amazon-seller-agent-design.md`

## Task 1 — Policy and finding contracts

Create:
- `packages/amazon-agent/src/diagnostics/types.ts`
- `packages/amazon-agent/src/diagnostics/policy.ts`

Contracts:
- `PpcPolicy` with `targetAcos`, `minimumClicksNoSale`, `minimumSpendNoSale`, `minimumOrdersScale`, `highAcosMultiplier`, `lowAcosScaleMargin`.
- `Finding` with stable `ruleId`, category, priority, confidence, entity, metrics, evidence, rationale, recommended action, and `humanApprovalRequired: true`.
- Starter policy is explicit metadata, never hidden business truth.

## Task 2 — Waste-without-sales rule

Create:
- `packages/amazon-agent/src/diagnostics/rules/waste-without-sales.ts`

Behavior:
- Fire only when attributed sales are exactly zero and either configured click or spend evidence threshold is met.
- Missing sales (`null`) must not be treated as zero.
- Search-term entity => negative-exact candidate.
- Preserve source file/source row evidence.

## Task 3 — High-ACOS bid-down rule

Create:
- `packages/amazon-agent/src/diagnostics/rules/high-acos.ts`

Behavior:
- Require seller target ACOS.
- Require at least one attributed order to avoid acting on noise.
- Fire when observed ACOS >= targetAcos * highAcosMultiplier.
- Recommendation remains a candidate, not an executed bid mutation.

## Task 4 — Efficient-term migration and scaling rules

Create:
- `packages/amazon-agent/src/diagnostics/rules/efficient-search-term.ts`

Behavior:
- Exact-migration candidate: enough orders, ACOS <= target, and discovery match context is broad/phrase/auto-like when known.
- Scale candidate: enough orders and ACOS <= targetAcos * (1 - lowAcosScaleMargin).
- Never infer campaign budget exhaustion from Search Term Report data.

## Task 5 — Diagnosis orchestration

Create:
- `packages/amazon-agent/src/diagnostics/diagnose-ppc.ts`
- export from `packages/amazon-agent/src/index.ts`

Behavior:
- `diagnosePpc(rows, policy)` calculates deterministic metrics, applies rules, returns findings in stable priority order.
- Findings disclose policy thresholds used.
- No LLM dependency.

## TDD acceptance scenarios

Tests must prove:
1. high spend/clicks + zero sales => waste finding;
2. zero sales below thresholds => no finding;
3. missing sales => no waste finding;
4. high ACOS with sufficient conversion evidence => bid-down finding;
5. high ACOS with no orders => no high-ACOS finding;
6. efficient broad term with enough orders => exact-migration finding;
7. efficient term far below target => scale finding;
8. each finding includes source evidence, rule ID, thresholds, and human approval flag;
9. stable priority ordering is deterministic.
