# Amazon Seller Agent V1.0 Release Checklist

Use this checklist before moving PR #1 from Draft to Ready for review.

## Original V1 acceptance criteria

1. Supported report types are identified correctly.
   - Evidence: Search Term report inspection/normalization and profitability parser tests.
   - Status: implemented.

2. Unsupported or insufficient data fails clearly.
   - Evidence: missing-field checks, malformed numeric warnings, ambiguous target-resolution fail-closed behavior.
   - Status: implemented.

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
   - Status: implemented at package-test design level; full repository CI still requires verification on the exact PR head.

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
- [ ] Targeted V1.0 acceptance test has been run successfully in a repository-capable environment.
- [ ] Amazon package strict/type/build checks have been run successfully in a repository-capable environment.
- [ ] Independent code review has been performed on the current V1.0 head.
- [ ] GitHub CI/status has been observed for the exact current head, or the absence of CI has been explicitly accepted before merge.
- [ ] PR is manually moved from Draft only after the verification items above are satisfied.

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
V1.0 acceptance test passes
AND Amazon package type/build verification passes
AND current-head diff has no accidental Amazon credentials/network mutation
AND independent review has no unresolved blocking issue
```

Real Amazon account execution is intentionally **not** part of this V1.0 go/no-go decision.
