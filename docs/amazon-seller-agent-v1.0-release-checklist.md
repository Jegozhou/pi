# Amazon Seller Agent V1.0 Release Checklist

Use this checklist before moving PR #1 from Draft to Ready for review.

## Original V1 acceptance criteria

1. Supported report types are identified correctly.
   - Evidence: Search Term report inspection/normalization and profitability parser tests.
   - Status: implemented.

2. Unsupported or insufficient data fails clearly.
   - Evidence: missing-field checks, header-only report rejection, invalid/negative numeric rejection, ambiguous target-resolution fail-closed behavior.
   - Status: implemented; current-head regression run still required.

3. Metrics are calculated deterministically.
   - Evidence: TypeScript metrics engine for CTR/CVR/CPC/ACOS/ROAS and known contribution economics.
   - Status: implemented.

4. Findings are rule-based and preserve source evidence.
   - Evidence: stable rule IDs, source file/row references, thresholds, rationale, recommended action.
   - Status: implemented.

5. Fact, estimate, and hypothesis are distinguished.
   - Evidence: no LLM-authoritative arithmetic, partial profitability labels, no unsupported future-performance prediction, bid policy described as product policy rather than Amazon truth.
   - Status: implemented in domain contracts/Skill guidance.

6. Applied thresholds are visible.
   - Evidence: PPC findings preserve target ACOS/evidence thresholds; policy is returned with diagnosis results.
   - Status: implemented.

7. A prioritized seller Action Plan can be created.
   - Evidence: deterministic cross-domain `buildSellerActionPlan`.
   - Status: implemented.

8. Missing costs / unsupported causality are not invented.
   - Evidence: profitability `complete|partial` status and explicit missing-cost categories; no future-sales/ACOS projection in bid simulation.
   - Status: implemented.

9. Automated tests do not require real Amazon/model credentials.
   - Evidence: all current Amazon tests are deterministic/local; V1.0 fixtures are synthetic.
   - Status: implemented at package-test design level; current-head rerun and repository CI still require verification.

10. Amazon-specific logic stays outside Pi core.
    - Evidence: domain code under `packages/amazon-agent`, project extension under `.pi/extensions`, project Skill under `.pi/skills`.
    - Status: implemented.

## V1.0 release artifacts

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
- [x] Five P1 findings from that review have corresponding regression tests and code changes on the feature branch.
- [x] Approval now requires host `ui.confirm`, records host provenance, seals approved content with a digest, and returns an HMAC-signed approval envelope.
- [x] Pi Dry Run now requires the signed envelope instead of bare approved Change Set JSON.
- [x] Blank campaign/ad-group/target identity and conflicting target rows fail closed.
- [x] Header-only reports fail as insufficient data.
- [x] Invalid/negative PPC numeric data, non-positive current bid, missing scale source-target context, and Change Set ID collision cases have regression coverage/code hardening.
- [ ] Current-head Amazon package test suite has been run successfully after the blocker fixes.
- [ ] Current-head Amazon package build has been run successfully after the blocker fixes.
- [ ] Current-head Biome check has been run and all Amazon/change-specific diagnostics fixed.
- [ ] A second independent Codex review has verified that every original P1 is closed.
- [ ] Pi extension host-confirmation and signed-envelope flow has been exercised in a dialog-capable Pi host.
- [ ] GitHub CI/status has been observed for the exact current head, or the absence of CI has been explicitly accepted before merge.
- [ ] PR is manually moved from Draft only after the verification items above are satisfied.

## Approval release gates

Before Ready, verify all of these behaviors on the exact current head:

```text
model calls amazon_decide_change_set
AND no dialog-capable host UI
=> decision rejected

model calls amazon_decide_change_set
AND human declines host dialog
=> decision rejected

human confirms exact awaiting Change Set
=> approved Change Set receives host-ui-confirmation provenance + content digest
=> tool returns signed approval envelope

signed envelope is unchanged
=> amazon_build_execution_dry_run may verify and continue

proposal / target / before / after / decision / digest / signature is modified
=> envelope verification fails
```

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
AND host approval flow is actually exercised
AND independent re-review has no unresolved P1 blocker
AND current-head diff has no accidental Amazon credentials/network mutation
```

Full-repository TypeScript failures that are proven pre-existing outside the Amazon change set must be recorded separately rather than misrepresented as Amazon-package success or failure.

Real Amazon account execution is intentionally **not** part of this V1.0 go/no-go decision.
