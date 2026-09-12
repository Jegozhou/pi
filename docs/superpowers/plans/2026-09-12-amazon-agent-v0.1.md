# Amazon Agent V0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the file-first Amazon advertising domain foundation: normalized Search Term Report records, report inspection, deterministic metrics, and tests.

**Architecture:** Add a standalone `packages/amazon-agent` workspace package. The package owns Amazon-specific types, delimited-text parsing, report recognition/normalization, and metric calculations. It does not depend on Pi core in V0.1; later Pi extensions consume this package.

**Tech Stack:** TypeScript 5.9, Node >=22.19, Vitest 4.1, npm workspaces. No new runtime dependency in V0.1.

**Spec:** `docs/superpowers/specs/2026-09-12-amazon-seller-agent-design.md`

## Global Constraints

- Amazon-specific logic stays outside Pi core.
- Arithmetic is deterministic TypeScript; no LLM arithmetic.
- CSV and TSV are first-class V0.1 inputs.
- Unknown/missing fields are never fabricated.
- Division by zero returns `null`, never `Infinity` or `NaN`.
- Unsupported reports fail closed with recognized/missing-field details.
- No Amazon API credentials, Ads API, SP-API, or account mutations in V0.1.
- Follow root `AGENTS.md`: erasable TypeScript only, no `any`, top-level imports, run modified tests, then `npm run check` after code changes.

---

### Task 1: Package and normalized advertising contracts

**Files:**
- Create: `packages/amazon-agent/package.json`
- Create: `packages/amazon-agent/tsconfig.build.json`
- Create: `packages/amazon-agent/vitest.config.ts`
- Create: `packages/amazon-agent/src/types/advertising.ts`
- Create: `packages/amazon-agent/src/index.ts`
- Create: `packages/amazon-agent/test/types.test.ts`

**Interfaces:**
- Produces `NormalizedAdvertisingRow`, `ReportKind`, `ReportWarning`, and `ReportInspection`.
- `NormalizedAdvertisingRow` uses `number | null` for optional numeric measures and preserves `sourceFile`/`sourceRow`.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from "vitest";
import type { NormalizedAdvertisingRow } from "../src/index.ts";

it("allows unavailable Amazon measures to stay explicit", () => {
  const row: NormalizedAdvertisingRow = {
    campaignName: "Discovery",
    adGroupName: "AG 1",
    targeting: "running shoes",
    matchType: "broad",
    customerSearchTerm: "trail running shoes",
    impressions: 100,
    clicks: 10,
    spend: 8,
    attributedOrders: null,
    attributedUnits: null,
    attributedSales: null,
    currency: "USD",
    sourceFile: "search-term.csv",
    sourceRow: 2,
  };
  expect(row.attributedSales).toBeNull();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run from `packages/amazon-agent`:
`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/types.test.ts`

Expected: FAIL because package/source files do not exist.

- [ ] **Step 3: Implement the minimal package/contracts**

`ReportKind` initially supports `"sponsored-products-search-term" | "unknown"`.

- [ ] **Step 4: Run the test and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Commit Task 1 files only**

Commit: `feat: add amazon agent domain contracts`

### Task 2: RFC-4180-style delimited text parser

**Files:**
- Create: `packages/amazon-agent/src/parsers/delimited.ts`
- Create: `packages/amazon-agent/test/delimited.test.ts`
- Modify: `packages/amazon-agent/src/index.ts`

**Interfaces:**
- Produces `parseDelimitedText(input: string, delimiter: "," | "\t"): string[][]`.
- Supports quoted fields, delimiters inside quotes, escaped double quotes, CRLF/LF, and quoted newlines.
- Throws `DelimitedTextError` for unterminated quoted fields or inconsistent row width after the header.

- [ ] **Step 1: Write failing parser tests**

Include separate tests for comma-separated rows, TSV, `"shoe, blue"`, escaped `""`, quoted newline, and malformed unterminated quote.

- [ ] **Step 2: Run `test/delimited.test.ts` and verify RED**

Expected: FAIL because parser exports do not exist.

- [ ] **Step 3: Implement a small state-machine parser**

Do not add a CSV dependency. Keep parsing separate from Amazon column semantics.

- [ ] **Step 4: Run parser tests and verify GREEN**

Expected: all parser tests PASS.

- [ ] **Step 5: Commit Task 2 files only**

Commit: `feat: add amazon delimited report parser`

### Task 3: Sponsored Products Search Term Report recognition and normalization

**Files:**
- Create: `packages/amazon-agent/src/parsers/search-term-report.ts`
- Create: `packages/amazon-agent/test/search-term-report.test.ts`
- Modify: `packages/amazon-agent/src/index.ts`

**Interfaces:**
- Produces `inspectAdvertisingReport(options: { content: string; fileName: string }): ReportInspection`.
- Produces `normalizeSearchTermReport(options: { content: string; fileName: string }): NormalizedAdvertisingRow[]`.
- Recognizes CSV vs TSV from header structure.
- Required semantic fields for V0.1: campaign, ad group, customer search term, impressions, clicks, spend, attributed sales.
- Optional semantic fields: targeting, match type, attributed orders, attributed units, currency.
- Aliases must cover common console/API-style names, including `Campaign Name`/`campaignName`, `Ad Group Name`/`adGroupName`, `Customer Search Term`/`searchTerm`, `Spend`/`Cost`/`cost`, `Sales`/`7 Day Total Sales`/`sales7d`, and `Orders`/`7 Day Total Orders (#)`/`purchases7d`.

- [ ] **Step 1: Write failing recognition/normalization tests**

Fixtures are inline small strings. Verify reordered columns normalize correctly, missing required sales returns `kind: "unknown"` with missing semantic fields, and invalid numeric cells generate a structured warning rather than fabricated zero.

- [ ] **Step 2: Run `test/search-term-report.test.ts` and verify RED**

- [ ] **Step 3: Implement header canonicalization and alias lookup**

Canonicalize by trimming, lowercasing, and removing spaces/underscores/hyphens/parentheses before matching aliases.

- [ ] **Step 4: Implement safe numeric parsing and source evidence**

Blank optional numbers become `null`. Invalid nonblank numbers become `null` plus a warning carrying `sourceRow`, semantic field, and raw value.

- [ ] **Step 5: Run report tests and verify GREEN**

- [ ] **Step 6: Commit Task 3 files only**

Commit: `feat: inspect amazon search term reports`

### Task 4: Deterministic advertising metrics

**Files:**
- Create: `packages/amazon-agent/src/metrics/advertising.ts`
- Create: `packages/amazon-agent/test/advertising-metrics.test.ts`
- Modify: `packages/amazon-agent/src/index.ts`

**Interfaces:**
- Produces `safeRatio(numerator: number | null, denominator: number | null): number | null`.
- Produces `calculateAdvertisingMetrics(row: NormalizedAdvertisingRow): AdvertisingMetrics`.
- `AdvertisingMetrics` contains `ctr`, `cvr`, `cpc`, `acos`, `roas`, each `number | null`.

- [ ] **Step 1: Write failing hand-computable tests**

For impressions=1000, clicks=20, spend=10, orders=4, sales=50 expect CTR=.02, CVR=.2, CPC=.5, ACOS=.2, ROAS=5.

Add separate zero-denominator tests proving unavailable values are `null`.

- [ ] **Step 2: Run `test/advertising-metrics.test.ts` and verify RED**

- [ ] **Step 3: Implement minimal metric functions**

Do not round internally. Presentation rounding belongs to later UI/tool layers.

- [ ] **Step 4: Run metric tests and verify GREEN**

- [ ] **Step 5: Commit Task 4 files only**

Commit: `feat: calculate amazon advertising metrics`

### Task 5: V0.1 verification and public package wiring

**Files:**
- Modify: `package.json` only if the explicit root build script must include `amazon-agent`.
- Modify: `packages/amazon-agent/package.json` if package scripts need correction discovered by verification.

**Interfaces:**
- The package must be importable through `@earendil-works/pi-amazon-agent` after its package build.
- No Pi core package imports the Amazon package yet.

- [ ] **Step 1: Run all V0.1 package tests**

Run from `packages/amazon-agent`:
`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/types.test.ts test/delimited.test.ts test/search-term-report.test.ts test/advertising-metrics.test.ts`

Expected: PASS with no warnings/errors.

- [ ] **Step 2: Run repository check**

Run from repo root: `npm run check`.

Expected: PASS. Fix every error, warning, and info caused by V0.1.

- [ ] **Step 3: Review diff against V0.1 acceptance scope**

Confirm: no Pi core changes, no API integration, no LLM calculations, no hidden defaulting of missing Amazon data, no unrelated refactor.

- [ ] **Step 4: Commit only verification/wiring corrections if any**

Commit: `fix: wire amazon agent v0.1 package`

## V0.1 Exit Criteria

V0.1 is complete when CSV/TSV Sponsored Products Search Term data can be recognized and normalized into typed rows, malformed/missing information remains explicit, deterministic advertising metrics are calculated with safe zero handling, focused tests pass, and the root repository check passes.