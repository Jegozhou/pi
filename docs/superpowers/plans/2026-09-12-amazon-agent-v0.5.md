# Amazon Seller Agent V0.5 — Action Plan + Skill

## Goal

Turn deterministic PPC and profitability findings into one seller-facing, prioritized action plan, then teach Pi when and how to use the Amazon tools through a project skill.

## Constraints

- No Amazon API writes.
- No claim that a recommendation has already been executed.
- Every action item must preserve its source finding ID and evidence rows.
- Every action item remains `humanApprovalRequired: true`.
- Missing seller targets must never be invented.
- Partial profitability data must stay visibly partial.
- Prioritization is deterministic code, not LLM judgment.
- Do not modify Pi core production code.

## Deterministic action-plan model

Add `packages/amazon-agent/src/action-plan/` with:

- `types.ts` — action-plan contracts.
- `build-action-plan.ts` — deterministic merge, dedupe, priority and limit logic.

Public API:

```ts
buildSellerActionPlan({
  ppcFindings,
  profitabilityFindings,
  limit,
})
```

Each item contains:

- stable `id`
- `rank`
- `source`: `ppc | profitability`
- `stage`: `stop-loss | optimize | grow`
- original priority/confidence/data quality
- entity
- rationale
- recommended action
- evidence
- source finding ID/rule ID
- `humanApprovalRequired: true`

Priority order:

1. known negative contribution profit
2. PPC spend with no attributed sales
3. high-ACOS / profitability margin risk
4. exact-migration candidates
5. scale candidates

Ties are deterministic by source file, source row, source finding ID.

## Pi tool

Add a read-only `amazon_build_action_plan` tool to `.pi/extensions/amazon-seller/index.ts`.

The tool accepts already-computed finding arrays and returns a ranked plan. It does not write files, modify campaigns, or call Amazon APIs.

## Project Skill

Add `.pi/skills/amazon-seller-agent.md` with valid frontmatter. The description should match requests about Amazon advertising diagnosis, search-term reports, ASIN/SKU profitability, wasted spend, ACOS, and seller action plans.

The skill instructs Pi to:

1. inspect uncertain report inputs first;
2. call deterministic tools before reasoning about seller actions;
3. ask for seller target ACOS/margin only when the requested rule depends on them;
4. clearly label missing/partial data;
5. build an action plan when multiple findings exist;
6. explain evidence and thresholds in seller language;
7. never claim an action was executed;
8. never bypass `humanApprovalRequired`.

## TDD acceptance cases

1. Negative known contribution outranks PPC waste.
2. PPC waste outranks bid-down/migration/scale.
3. Partial profitability remains partial in the plan.
4. Evidence and human-approval flags are preserved exactly.
5. Limit is applied after sorting.
6. Ordering is deterministic for ties.
7. Empty findings returns an empty plan, not invented advice.
8. Skill frontmatter has a valid lowercase-hyphen name and non-empty description.

## Verification

- Run V0.5 behavior tests in isolation.
- Run package TypeScript build if the local environment provides repo dependencies.
- Inspect PR diff for accidental Pi core changes.
- Check GitHub Actions for the new head; do not claim full monorepo CI without a successful run.
