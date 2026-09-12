# Amazon Seller Agent V1.0 Release Checklist

Use this checklist before moving PR #1 from Draft to Ready for review.

## Original V1 acceptance criteria

1. Supported report types are identified correctly.
   - Evidence: Search Term report inspection/normalization and profitability parser tests.
   - Status: implemented and covered by the current Amazon package test suite.

2. Unsupported or insufficient data fails clearly.
   - Evidence: missing-field checks, ambiguous header-alias rejection, header-only report rejection, invalid/negative numeric rejection, blank identity rejection, and conflicting target-resolution fail-closed behavior.
   - Status: implemented and passing on the current PR head.

3. Metrics are calculated deterministically.
   - Evidence: TypeScript metrics engine for CTR/CVR/CPC/ACOS/ROAS and known contribution economics.
   - Status: implemented and passing.

4. Findings are rule-based and preserve source evidence.
   - Evidence: stable rule IDs, source file/row references, thresholds, rationale, recommended action.
   - Status: implemented and passing.

5. Fact, estimate, and hypothesis are distinguished.
   - Evidence: no LLM-authoritative arithmetic, partial profitability labels, no unsupported future-performance prediction, bid policy described as product policy rather than Amazon truth.
   - Status: implemented in domain contracts/Skill guidance.

6. Applied thresholds are visible.
   - Evidence: PPC findings preserve target ACOS/evidence thresholds; policy is returned with diagnosis results.
   - Status: implemented.

7. A prioritized seller Action Plan can be created.
   - Evidence: deterministic cross-domain `buildSellerActionPlan`.
   - Status: implemented and passing.

8. Missing costs / unsupported causality are not invented.
   - Evidence: profitability `complete|partial` status and explicit missing-cost categories; no future-sales/ACOS projection in bid simulation.
   - Status: implemented and passing.

9. Automated tests do not require Amazon/model credentials.
   - Evidence: Amazon tests use synthetic/local seller data. The CI hydration step generates Pi model metadata needed by the repository environment but does not provide seller credentials or call Amazon.
   - Status: implemented and passing.

10. Amazon-specific logic stays outside Pi core.
    - Evidence: domain code under `packages/amazon-agent`, project extension under `.pi/extensions`, project Skill under `.pi/skills`.
    - Status: implemented.

## V1.0 release artifacts and verification

- [x] Approved design spec exists.
- [x] V0.1-V0.9 implementation plans exist.
- [x] V1.0 closure plan exists.
- [x] Synthetic Search Term evaluation fixture exists.
- [x] Synthetic profitability evaluation fixture exists.
- [x] Synthetic target-snapshot fixture exists.
- [x] V1.0 end-to-end acceptance test exists.
- [x] Package README exists.
- [x] Seller/operator example workflow exists.
- [x] Initial independent Codex release review was performed on head `bae4c24ea88448220d4a4a185ad909ccd4474838` and returned `NOT READY`.
- [x] Second independent Codex release review was performed on head `7752a6079f03b87ec7a9f31b61d0e06d396001da` and returned `NOT READY`, identifying remaining build/test/approval-verification gaps.
- [x] The original five P1 findings and the second-review regressions have dedicated regression coverage and code fixes on the feature branch.
- [x] `trusted-caller` approval provenance has been removed; approval decisions require `host-ui-confirmation`.
- [x] The model can no longer supply an approval actor label; the host flow records `pi-host-user` and generates the timestamp.
- [x] Approval host behavior has direct tests for no UI, human decline, human confirm, host timestamp, signed envelope, and rejection-without-envelope.
- [x] The registered decision tool delegates its host interaction to that tested approval flow; wiring tests verify the shared secret and envelope-only Dry Run registration.
- [x] Approved content is sealed with a canonical SHA-256 digest and HMAC-SHA256 approval envelope.
- [x] Both the Pi Dry Run wrapper and the public domain Dry Run boundary require a signed approval envelope instead of a bare approved Change Set.
- [x] Approval and Dry Run are registered by the same extension factory and share one per-extension in-memory signing secret.
- [x] Blank campaign/ad-group/target identity and conflicting same-target rows fail closed.
- [x] Conflict regression coverage includes campaign ID, ad-group ID, targeting, match type, bid, and state, plus an identical-duplicate success case.
- [x] Header-only reports fail as insufficient data.
- [x] Invalid/negative PPC numeric data, non-positive current bid, missing scale source-target context, ambiguous header aliases, and Change Set ID collision cases have regression coverage/code hardening.
- [x] Current PR-head Amazon package test suite passed in GitHub Actions: 15 files / 118 tests / 118 passed.
- [x] Current PR-head Amazon package build passed: `tsgo -p tsconfig.build.json`.
- [x] Current PR-head Amazon Biome release gate passed: 46 files checked with no fixes required.
- [x] Current PR-head `git diff --check origin/main...HEAD` passed.
- [x] A dedicated GitHub Actions release gate now runs hydration, Biome, Amazon tests, Amazon build, and diff checking for this package/extension.
- [ ] A third independent review has inspected the post-second-review fixes and confirmed no unresolved P1 release blocker.
- [ ] A manual end-user run inside an interactive Pi TUI/RPC host has clicked the confirmation dialog. Automated tests exercise the exact host-decision core and registration wiring, but they are not represented as a manual UI acceptance session.
- [ ] PR is manually moved from Draft only after the remaining review/acceptance items above are satisfied.

## Approval release gates

The current automated suite verifies these behaviors:

```text
approval flow receives no dialog-capable host UI
=> decision rejected

approval flow shows confirmation
AND human declines
=> decision rejected

human confirms exact awaiting Change Set
=> approved Change Set receives host-ui-confirmation provenance + content digest
=> host-generated timestamp/actor is recorded
=> signed approval envelope is returned

signed envelope is unchanged
=> buildSellerExecutionDryRun verifies envelope and may produce a zero-write plan

bare approved Change Set
=> domain Dry Run rejected

proposal / target / before / after / decision / digest / signature is modified
=> envelope verification fails
```

A manual Pi-host dialog click remains an acceptance check, not a substitute for these deterministic tests.

## Current GitHub release-gate evidence

For PR head `e6ed74d29b913a767c30cfb2ead7102aa1c772e8`, GitHub Actions workflow `Amazon Seller Agent V1` completed successfully. Its verify job performed:

```text
npm ci --ignore-scripts                         PASS
npm --prefix packages/ai run hydrate-model-data PASS
model manifest existence check                 PASS
Biome check (46 files)                         PASS
Amazon package tests: 15 files / 118 tests     PASS
Amazon package build                           PASS
git diff --check origin/main...HEAD             PASS
```

The workflow tests the standard PR merge ref containing that feature head and the current base, which is the code GitHub would review/merge.

## Explicitly deferred from the file-first V1.0 release

These are not reasons to claim V1.0 core diagnosis is incomplete, but they remain future work and must not be represented as shipped:

- XLSX adapter is not yet verified as a V1.0 input path.
- Persistent seller/store policy profile is not implemented.
- Amazon Ads API/SP-API authentication is not implemented.
- Real Amazon mutation executor is not implemented.
- Scheduled daily runs are not implemented.
- Persistent execution history / rollback assistance is not implemented.
- Web/WorkBuddy operational UI is not implemented.

## Go / no-go rule

Move PR #1 to Ready only when:

```text
current-head Amazon tests pass
AND Amazon package build passes
AND change-specific Biome check passes
AND approval safety regression suite passes
AND independent post-fix review has no unresolved P1 blocker
AND current-head diff has no accidental Amazon credentials/network mutation
```

A manual Pi-host dialog run is still recommended before any future real executor is introduced. It is not evidence that Amazon account execution exists; V1.0 remains zero-write.

Full-repository TypeScript failures that are proven pre-existing outside the Amazon change set must be recorded separately rather than misrepresented as Amazon-package success or failure.

Real Amazon account execution is intentionally **not** part of this V1.0 go/no-go decision.
