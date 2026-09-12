# Amazon Seller Operator Agent Design

Date: 2026-09-12
Status: Approved direction, implementation not started
Branch: `feat/amazon-seller-agent`

## 1. Problem

Amazon sellers have many dashboards and reports but still perform the important work manually: identify waste, decide whether a metric is actually abnormal, connect advertising performance with profitability, and turn findings into actions.

A generic chat assistant is not enough because seller decisions depend on exact calculations, source rows, thresholds, and repeatable rules. The product must therefore behave as an operator that reads seller data, computes facts deterministically, explains the evidence, and proposes auditable actions.

Example:

1. Seller uploads a Search Term Report.
2. The system recognizes the report and normalizes its columns.
3. Deterministic code calculates ACOS, ROAS, CTR, CVR, CPC, spend, sales, and order counts.
4. A rule engine finds waste and growth opportunities.
5. The agent explains why each finding matters and produces a prioritized action plan.
6. Every recommendation keeps the source evidence and rule that produced it.

## 2. Product Goal

Build an Amazon Seller Operator Agent on top of Pi without coupling Amazon business logic to Pi core.

The first product slice focuses on two high-value workflows:

- Amazon Ads PPC diagnosis.
- ASIN/product profitability diagnosis.

The agent should answer questions such as:

- Which search terms are wasting money?
- Which keywords or targets should have bids reduced?
- Which search terms should be promoted into exact targeting?
- Which campaigns or targets are efficient enough to scale?
- Which ASINs appear profitable or unprofitable after known costs?
- Why did advertising efficiency deteriorate?
- What should the seller do first?

The output is not just prose. It is a structured list of findings, evidence, calculations, and recommended actions.

## 3. Non-goals for V1

V1 will not:

- Automatically change Amazon Ads bids, budgets, targets, or negative keywords.
- Require Amazon Ads API or SP-API approval.
- Attempt to solve product research, review analysis, customer service, listing generation, inventory forecasting, and account health in the same release.
- Use an LLM to calculate financial metrics.
- Present estimated savings or revenue impact when the input data cannot support the estimate.
- Modify Pi agent-core behavior solely for Amazon-specific needs.

These are later extensions after the core diagnosis loop is proven useful.

## 4. Architectural Principle

Pi remains the reusable agent harness. Amazon behavior is added as a separate domain layer.

```text
Pi
├── pi-ai                    model providers
├── pi-agent-core            agent loop, state, tools
├── pi-coding-agent          extension and skill host
└── Amazon Seller Layer
    ├── parsers              seller report ingestion
    ├── metrics              deterministic calculations
    ├── diagnostics          deterministic rules
    ├── tools                Pi-callable Amazon tools
    ├── workflows            diagnosis orchestration
    ├── evidence             audit trail
    └── skills               seller-specific operating guidance
```

This preserves upstream compatibility. Most future changes in Pi should be mergeable without rewriting the Amazon domain implementation.

## 5. Repository Layout

Create a new workspace package:

```text
packages/amazon-agent/
├── package.json
├── src/
│   ├── types/
│   ├── parsers/
│   ├── metrics/
│   ├── diagnostics/
│   ├── evidence/
│   ├── tools/
│   ├── workflows/
│   └── index.ts
└── test/
```

Create a project-local Pi extension:

```text
.pi/extensions/amazon-seller/
└── index.ts
```

Create seller skills:

```text
.pi/skills/
├── amazon-ppc/
│   └── SKILL.md
└── amazon-profit/
    └── SKILL.md
```

The new package contains business logic. The extension exposes that logic to Pi. Skills describe when and how the agent should use the tools; they do not contain the numerical calculations themselves.

## 6. Input Strategy

V1 is file-first so development is not blocked by Amazon API approval.

Required input categories:

1. Amazon Ads Search Term Report.
2. Amazon Ads targeting/keyword report when available.
3. Seller profitability input containing known product cost data.
4. Optional Amazon fee or settlement/report data when available.

Supported ingestion behavior:

- CSV and TSV are first-class formats.
- XLSX is supported through an isolated workbook adapter. If the repository does not already contain a suitable parser, the implementation may add one reviewed, pinned dependency; dependency and lockfile changes must follow repository security rules.
- Column names are normalized through aliases rather than by assuming one locale or one historical Amazon export format.
- Unknown reports fail closed with a clear list of recognized and missing columns.

The parser never silently fabricates absent fields.

## 7. Normalized Domain Model

### 7.1 Advertising row

A normalized advertising record should carry, when present:

- marketplace
- date or date range
- campaign name and identifier
- ad group name and identifier
- targeting expression or keyword
- match type
- customer search term
- impressions
- clicks
- spend
- attributed orders
- attributed units
- attributed sales
- currency
- source file and source row

### 7.2 Product profitability record

A normalized product record should carry, when present:

- marketplace
- ASIN
- SKU
- units sold
- gross sales
- refunds/returns amount
- Amazon fees
- FBA/fulfillment fees
- storage or other known fees
- advertising spend
- COGS/unit
- inbound or other seller-provided variable cost
- currency
- source file and source row

Missing cost categories remain explicitly unknown.

## 8. Deterministic Metrics Engine

All arithmetic is implemented in TypeScript and tested independently from the LLM.

Core advertising metrics:

```text
CTR  = clicks / impressions
CVR  = orders / clicks
CPC  = spend / clicks
ACOS = spend / attributed sales
ROAS = attributed sales / spend
```

Division-by-zero must produce an explicit unavailable value, not Infinity, NaN, or a guessed number.

Profitability metrics:

```text
known_variable_cost = known Amazon fees + known fulfillment/storage fees
                    + advertising spend + known COGS + other known variable costs

known_contribution_profit = gross sales - refunds - known_variable_cost
known_contribution_margin = known_contribution_profit / gross sales
```

If required cost categories are absent, output is labelled `partial` rather than claiming full net profit.

When the seller provides a pre-ad contribution margin, break-even ACOS can be derived from that margin. It must not be guessed from industry averages.

## 9. Diagnostic Rule Engine

Rules are deterministic objects with stable identifiers and configurable thresholds. A rule returns zero or more findings.

Initial rule families:

### 9.1 Waste without sales

Candidate condition:

- attributed sales are zero; and
- clicks or spend exceed the configured minimum evidence threshold.

Possible action:

- negative exact candidate for a search term; or
- pause/reduce target candidate for a target-level row.

The system must call it a candidate, not an automatic deletion.

### 9.2 ACOS materially above target

Candidate condition:

- seller target ACOS exists;
- there is sufficient conversion evidence;
- observed ACOS is materially above target.

Possible action:

- reduce bid or review relevance/conversion quality.

### 9.3 Efficient search term worth isolating

Candidate condition:

- search term generated enough orders;
- ACOS is at or below seller target;
- term came from a broader discovery context such as auto, broad, or phrase when that information is available.

Possible action:

- exact-target migration candidate.

### 9.4 Efficient target worth scaling

Candidate condition:

- sufficient clicks/orders;
- ACOS is below the seller target by a configurable margin.

Possible action:

- cautious bid/budget increase candidate.

Budget recommendations require budget evidence. The system must not infer a budget limitation from a Search Term Report alone.

### 9.5 Profitability risk

Candidate condition:

- known contribution profit is negative; or
- advertising spend pushes known contribution margin below the seller's required margin.

Possible action:

- reduce advertising pressure, examine price/cost structure, or flag the ASIN for deeper investigation.

## 10. Threshold Configuration

There is no universal correct PPC threshold. V1 therefore uses seller-configurable policy rather than hard-coded business truth.

Configuration should include at least:

- target ACOS
- minimum clicks before a no-sale judgment
- minimum spend before a no-sale judgment
- minimum orders for a scaling judgment
- high-ACOS multiplier or tolerance
- low-ACOS scaling margin
- currency/marketplace metadata when needed

A sensible starter profile may be provided, but every report must disclose the thresholds used.

## 11. Finding and Evidence Contract

Every diagnosis must be representable as structured data similar to:

```ts
type Finding = {
  id: string;
  ruleId: string;
  category: "waste" | "bid-down" | "scale" | "migration" | "profit-risk";
  priority: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  entity: {
    type: "search-term" | "target" | "campaign" | "asin";
    value: string;
  };
  metrics: Record<string, number | null>;
  evidence: EvidenceRef[];
  rationale: string;
  recommendedAction: RecommendedAction;
  expectedImpact?: ImpactEstimate;
};
```

Expected impact is optional and only exists when a transparent formula can derive it from supplied data.

Evidence references preserve the source file and row or normalized record identifiers needed to reconstruct the finding.

## 12. LLM Responsibility Boundary

The LLM may:

- choose the appropriate Amazon tool for a seller request;
- summarize structured findings;
- compare findings and build a priority order;
- explain likely operational interpretations;
- ask for missing seller inputs that materially change a decision;
- produce an action plan from deterministic findings.

The LLM may not:

- perform authoritative financial arithmetic in prose when a metric tool exists;
- invent missing Amazon metrics, fees, costs, or report fields;
- claim a causal explanation as proven when evidence only supports a hypothesis;
- claim an action has been executed in Amazon in V1.

## 13. Pi Tool Surface

The first extension exposes a small tool surface instead of dozens of narrowly named tools.

Planned tools:

### `amazon_inspect_report`

Purpose: recognize a report, normalize columns, report coverage/missing fields, and return a safe preview.

### `amazon_diagnose_ppc`

Purpose: run metrics and PPC diagnostic rules over normalized advertising data.

### `amazon_diagnose_profit`

Purpose: combine seller cost inputs and available sales/fee/ad data to calculate known contribution profitability and identify risks.

### `amazon_build_action_plan`

Purpose: prioritize existing findings without recalculating business metrics.

Tool results are structured first and human-readable second so they can later feed CLI, web, or SaaS interfaces.

## 14. Skills

### amazon-ppc

Teaches the agent:

- which reports are useful for which PPC question;
- the distinction between search term, keyword/target, campaign, and match type;
- how to interpret deterministic findings;
- when evidence is insufficient;
- how to turn findings into seller actions.

### amazon-profit

Teaches the agent:

- which cost inputs are required for strong profitability claims;
- how to distinguish partial contribution profit from full net profit;
- when PPC efficiency and product profitability conflict;
- what missing inputs to request.

Skills use progressive disclosure and are loaded only for matching tasks.

## 15. Seller Memory

V1 keeps seller policy separate from report rows.

A seller profile can persist:

- marketplace
- currency
- target ACOS by store or optional ASIN/campaign override
- known product costs
- minimum evidence thresholds
- required contribution margin

Secrets and API credentials are not part of this profile in V1.

The design should allow the profile storage implementation to change later without changing metric or diagnostic APIs.

## 16. Workflow

Primary PPC flow:

```text
seller request
→ inspect report
→ normalize data
→ validate coverage
→ calculate deterministic metrics
→ run diagnostic rules
→ rank findings
→ agent explains evidence
→ build action plan
→ user decides what to do
```

Primary profitability flow:

```text
seller request
→ inspect sales/cost inputs
→ validate required fields
→ calculate known contribution economics
→ label result complete/partial
→ identify risky ASINs
→ explain missing information
→ build action plan
```

## 17. Error Handling

The system fails explicitly when:

- the file cannot be parsed;
- required columns are missing;
- numeric data contains unrecoverable invalid values;
- currency cannot safely be combined;
- two reports appear to represent incompatible date windows and the operation requires alignment;
- an estimate requires a seller target/cost that is absent.

A recoverable issue should return a structured warning and continue only when doing so cannot change the meaning of the result.

## 18. Safety and Execution Policy

V1 is advisory.

Every recommended Amazon mutation is marked `humanApprovalRequired: true`. No tool in V1 writes to Seller Central or Amazon Ads.

Future API execution must be introduced as a separate capability with:

1. preview;
2. evidence;
3. exact proposed mutation;
4. explicit user approval;
5. API execution;
6. result recording and rollback guidance where the Amazon API supports reversal.

## 19. Testing Strategy

Tests are required at four layers.

### Parser tests

Use fixed small fixtures covering:

- common Search Term Report column variants;
- reordered columns;
- missing columns;
- malformed numeric values;
- empty files;
- different delimiters/locales where supported.

### Metrics tests

Use hand-computable fixtures for ACOS, ROAS, CTR, CVR, CPC, and contribution profit. Include zero-denominator cases.

### Rule tests

Each rule gets boundary tests proving it fires and does not fire around its evidence thresholds.

### Agent/tool integration tests

Use Pi's faux/test provider patterns. No real LLM keys or paid provider calls are required for automated tests.

The implementation must run tests for every modified/created test file and follow the repository `AGENTS.md` command rules.

## 20. Evaluation Set

Create a small deterministic seller evaluation set containing scenarios such as:

- high spend, zero sales;
- profitable low-ACOS converting term;
- high-ACOS term with too little evidence to act;
- strong broad/auto discovery term suitable for exact migration;
- apparently good ACOS but negative known contribution profit;
- missing COGS causing a partial profitability result;
- mixed currencies that must not be combined.

Success means the expected findings and safety labels are stable across model changes because the underlying diagnosis is deterministic.

## 21. Implementation Slices

### V0.1 — Domain foundation

- workspace package
- normalized types
- CSV/TSV ingestion
- report recognition
- deterministic metrics
- unit tests

### V0.2 — PPC diagnosis

- configurable policy
- PPC rules
- finding/evidence model
- PPC tests
- XLSX adapter if not completed in V0.1

### V0.3 — Pi integration

- Amazon extension
- `amazon_inspect_report`
- `amazon_diagnose_ppc`
- structured tool rendering
- faux-provider integration tests

### V0.4 — Profit diagnosis

- seller cost input
- known contribution metrics
- `amazon_diagnose_profit`
- partial/complete data-quality labels

### V0.5 — Skills and action planning

- amazon-ppc skill
- amazon-profit skill
- `amazon_build_action_plan`
- priority and confidence behavior

### V1.0 — Usable file-first operator

- documented setup and example workflow
- representative fixture/evaluation corpus
- stable structured output contracts
- no Amazon account credentials required

### Later

- SP-API connectors
- Amazon Ads API connectors
- scheduled daily runs
- persistent store history
- human-approved execution
- web/SaaS workbench

## 22. Acceptance Criteria for V1

V1 is complete when a seller can point Pi at supported local reports and ask for an advertising or profitability diagnosis, and the agent can:

1. correctly identify supported report types;
2. reject unsupported or insufficient data clearly;
3. calculate metrics deterministically;
4. return rule-based findings with source evidence;
5. distinguish fact, estimate, and hypothesis;
6. explain which thresholds were applied;
7. create a prioritized seller action plan;
8. avoid claiming missing costs or unsupported causality;
9. complete automated tests without real Amazon or model credentials;
10. keep Amazon-specific logic outside Pi core.

## 23. Design Decision Summary

The product is an Amazon decision engine, not an Amazon-themed chatbot.

The key design choices are:

- file-first before API-first;
- deterministic calculations before LLM interpretation;
- few composable tools rather than a huge tool catalog;
- evidence attached to every recommendation;
- seller-configurable policy instead of universal thresholds;
- advisory actions before autonomous execution;
- isolated Amazon package so Pi remains upgradeable.
