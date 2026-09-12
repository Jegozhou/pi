# Amazon Seller Agent V1.0 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the completed V0.1-V0.9 domain pipeline into a usable, reviewable, file-first V1.0 release candidate with deterministic evaluation fixtures, an end-to-end acceptance test, clear setup/example documentation, and an explicit release checklist.

**Architecture:** Keep all Amazon-specific business logic inside `packages/amazon-agent` and project-local Pi extensions/skills. V1.0 closure adds no Amazon credentials or network mutation capability; it proves that the existing file-first workflow is stable from report ingestion through approved dry-run output.

**Tech Stack:** TypeScript, Vitest, Pi project extensions/skills, CSV/TSV fixtures.

**Spec:** `docs/superpowers/specs/2026-09-12-amazon-seller-agent-design.md`

## Global Constraints

- V1.0 remains file-first and advisory; no Seller Central or Amazon Ads writes.
- Deterministic code remains authoritative for metrics, diagnostics, bid simulation, state transitions, and dry-run generation.
- Missing data is never fabricated or silently converted to zero.
- Every mutation candidate preserves source evidence and `humanApprovalRequired: true`.
- No real LLM keys, Amazon credentials, or paid provider calls in automated tests.
- Keep Amazon-specific logic outside Pi core.
- Do not claim full repository CI success unless GitHub actually reports a passing run for the current head.

---

### Task 1: Representative V1.0 Evaluation Corpus

**Files:**
- Create: `packages/amazon-agent/test/fixtures/v1.0/search-term-report.csv`
- Create: `packages/amazon-agent/test/fixtures/v1.0/profitability.csv`
- Create: `packages/amazon-agent/test/fixtures/v1.0/target-snapshot.csv`
- Create: `packages/amazon-agent/test/fixtures/v1.0/README.md`

**Interfaces:**
- Consumes: current CSV parsers and deterministic diagnostic rules.
- Produces: stable synthetic fixtures used by the V1.0 acceptance test and documentation.

- [ ] Add one high-ACOS converting search term, one zero-sales waste term, and one efficient discovery term.
- [ ] Add one ASIN with complete supplied costs and negative known contribution profit.
- [ ] Add a target snapshot that uniquely resolves the PPC campaign/ad-group/target identities and current bids.
- [ ] Document that all fixture data is synthetic and contains no seller credentials or private business data.

### Task 2: End-to-End V1.0 Acceptance Test

**Files:**
- Create: `packages/amazon-agent/test/amazon-agent-v1.0.test.ts`

**Interfaces:**
- Consumes: `buildPpcDiagnosisResult`, `buildProfitDiagnosisResult`, `buildSellerActionPlan`, `buildSellerChangeSet`, `normalizeTargetSnapshot`, `enrichSellerChangeSet`, `applyBidPolicyToChangeSet`, `requestSellerChangeSetApproval`, `decideSellerChangeSet`, `buildSellerExecutionDryRun`.
- Produces: a deterministic release-gate scenario proving the complete file-first workflow.

- [ ] Write the acceptance test against fixture files.
- [ ] Verify PPC findings include waste, high-ACOS bid-down, exact migration, and scale candidates.
- [ ] Verify negative known contribution profitability is detected.
- [ ] Limit the ranked action plan to profitability review + waste + bid-down so the supported approval/execution path is fully resolvable.
- [ ] Verify enrichment resolves the negative scope and target/current bid.
- [ ] Verify the bid policy turns the bid-down proposal into `ready` with `$1.20 -> $0.96` under the default 20% step guardrail.
- [ ] Verify request/decision transitions produce an approved Change Set.
- [ ] Verify the final dry run contains exactly two mutating operations, skips the profitability review, preserves evidence-derived IDs, and reports `writesPerformed: false`.

### Task 3: Package README and Example Workflow

**Files:**
- Create: `packages/amazon-agent/README.md`
- Create: `docs/amazon-seller-agent-v1.0-workflow.md`

**Interfaces:**
- Consumes: current Pi tools and safety contract.
- Produces: copy-pasteable operator instructions for a seller or reviewer.

- [ ] Explain what V1.0 can and cannot do.
- [ ] Document required report categories and supported CSV/TSV behavior.
- [ ] Show the tool sequence from inspection through dry run.
- [ ] Explain deterministic-code vs LLM responsibilities.
- [ ] Include a concrete example showing `ACOS 60%`, target `30%`, current bid `$1.20`, proposed bid `$0.96` after the guardrail.
- [ ] State clearly that approved/dry-run does not mean executed in Amazon.

### Task 4: V1.0 Release Checklist

**Files:**
- Create: `docs/amazon-seller-agent-v1.0-release-checklist.md`

**Interfaces:**
- Consumes: original design acceptance criteria and current repository verification state.
- Produces: a final go/no-go checklist for moving the PR from Draft to Ready.

- [ ] Map all ten original V1 acceptance criteria to evidence in code/tests/docs.
- [ ] Track remaining gaps separately: XLSX adapter, seller-profile persistence, full-repo CI, and real Amazon API executor.
- [ ] Keep real Amazon mutation explicitly outside V1.0 release scope.
- [ ] Require successful targeted tests/type-check plus independent review before marking the PR ready.

### Task 5: Final Verification and PR Update

- [ ] Run the new V1.0 acceptance test in an available environment.
- [ ] Run strict TypeScript checks for the Amazon package where available.
- [ ] Inspect the V0.9 -> V1.0 diff for accidental network/credential/executor additions.
- [ ] Check GitHub CI/status for the exact head and report the result accurately.
- [ ] Update PR title/body to V1.0 release-candidate status only after the release artifacts and acceptance test exist.
