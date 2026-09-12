# Amazon Agent V0.4 Implementation Plan

**Goal:** Add deterministic ASIN/SKU profitability diagnosis that clearly separates known contribution economics from unknown costs.

**Architecture:** Add a normalized profitability input model and parser to `packages/amazon-agent`, then calculate known contribution profit from only supplied values. Missing cost categories remain `null` and produce a `partial` data-quality label. Negative known contribution profit is actionable even when data is partial because omitted costs cannot make the result better.

**Spec:** `docs/superpowers/specs/2026-09-12-amazon-seller-agent-design.md`

## Task 1 — Profitability contracts and parser

Create:
- `packages/amazon-agent/src/types/profitability.ts`
- `packages/amazon-agent/src/parsers/profitability-report.ts`

Normalized fields:
- marketplace, ASIN, SKU, units sold, gross sales;
- refunds/returns amount;
- Amazon fees;
- fulfillment/FBA fees;
- storage fees;
- advertising spend;
- COGS per unit;
- other seller-provided variable costs;
- currency;
- source file/row.

Rules:
- require at least ASIN or SKU plus gross sales;
- blank optional numbers stay `null`;
- invalid nonblank numbers become `null` plus structured warning;
- CSV and TSV reuse the V0.1 delimited parser.

## Task 2 — Deterministic profitability metrics

Create:
- `packages/amazon-agent/src/metrics/profitability.ts`

Calculate:
- known COGS total only when both units sold and COGS/unit are known;
- known variable cost as the sum of supplied cost values only;
- known contribution profit = gross sales - known costs;
- known contribution margin = known contribution profit / gross sales;
- status `complete` only when every declared cost category is explicitly known (zero is valid); otherwise `partial`;
- missing cost categories disclosed explicitly.

Do not call this net profit.

## Task 3 — Profitability diagnostic findings

Create:
- `packages/amazon-agent/src/diagnostics/diagnose-profit.ts`

Policy:
- optional required contribution margin.

Findings:
- `profit.negative-known-contribution.v1`: high priority when known contribution profit < 0;
- `profit.below-required-margin.v1`: medium/high priority when known contribution margin is below a seller-provided required margin;
- preserve source evidence and `humanApprovalRequired: true`.

A partial row that is already negative is still a valid risk finding. A partial row that appears positive must never be described as proven profitable.

## Task 4 — Tool orchestration and Pi registration

Extend:
- `packages/amazon-agent/src/tools/report-tools.ts`
- `.pi/extensions/amazon-seller/index.ts`

Register `amazon_diagnose_profit` as a third read-only tool. It accepts a local profitability CSV/TSV and an optional required contribution margin. It returns normalized coverage, missing cost categories, deterministic metrics, findings, and source evidence.

## TDD acceptance scenarios

1. complete row calculates COGS, known variable cost, contribution profit, and margin exactly;
2. missing COGS produces `partial` and lists COGS as missing;
3. zero values count as known, not missing;
4. negative known contribution generates a high-priority risk finding even if partial;
5. positive but partial result is never labelled complete/proven net profit;
6. required margin rule fires only when seller provided the margin;
7. invalid numeric cost produces a warning and remains unknown;
8. tool orchestration preserves source row evidence and data-quality status.
