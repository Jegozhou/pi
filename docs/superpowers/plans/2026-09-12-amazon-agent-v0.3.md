# Amazon Agent V0.3 Implementation Plan

**Goal:** Expose the V0.1 report foundation and V0.2 deterministic PPC diagnostics as project-local Pi tools.

**Architecture:** Keep Pi integration thin. Pure content-to-result orchestration lives in `packages/amazon-agent`; the project-local extension only reads a user-selected local report, enforces a file-size boundary, passes explicit seller policy overrides, and returns structured tool results. No Amazon account mutation is possible.

**Spec:** `docs/superpowers/specs/2026-09-12-amazon-seller-agent-design.md`

## Task 1 — Tool result orchestration

Create:
- `packages/amazon-agent/src/tools/report-tools.ts`
- tests for inspection and PPC diagnosis summaries.

Behavior:
- `buildReportInspectionResult(content, fileName)` returns inspection plus at most five normalized preview rows when supported.
- `buildPpcDiagnosisResult(content, fileName, policyOverrides)` returns report inspection, effective policy, rows analyzed, counts by category, and full findings.
- Policy overrides merge into the explicit starter policy; omitted `targetAcos` remains `null`, suppressing target-dependent rules.
- Unsupported reports fail closed before diagnosis.

## Task 2 — Read-only local file boundary

Create:
- `.pi/extensions/amazon-seller/file-input.ts`

Behavior:
- Accept only an explicit user/tool-provided path; never scan directories.
- Resolve the path, stat it, reject directories/non-files, reject files larger than 25 MiB, then read UTF-8.
- Include the resolved basename as `fileName` passed to the domain layer.
- No writes, deletes, shell commands, network requests, or credential reads.

## Task 3 — Pi tools

Create:
- `.pi/extensions/amazon-seller/index.ts`

Register:
- `amazon_inspect_report`
  - input: `filePath`
  - output: report kind, delimiter, headers, missing semantic fields, warnings, row count, safe preview.
- `amazon_diagnose_ppc`
  - input: `filePath` plus optional seller policy overrides.
  - output: effective policy, rows analyzed, warning list, finding counts, and auditable findings.

Every returned PPC mutation remains a candidate with `humanApprovalRequired: true`. The extension does not register any mutation/execution tool.

## TDD acceptance scenarios

1. supported Search Term CSV returns recognized report and normalized preview;
2. unsupported/missing-field report is `unknown` and has no normalized preview;
3. PPC result exposes effective policy and category counts;
4. omitted target ACOS preserves `null` and does not create target-dependent findings;
5. explicit target ACOS enables eligible high-ACOS/migration/scale findings;
6. tool result preserves parse warnings and source evidence;
7. file input rejects directories and files above 25 MiB;
8. extension registers exactly the two approved read-only tools.
