# Amazon Seller Agent

A file-first Amazon seller decision engine built on Pi. It turns supported seller reports into deterministic metrics, evidence-backed findings, ranked actions, auditable Change Sets, host-confirmed human approval, deterministic execution plans, zero-write fake execution receipts, and a trusted live-preflight boundary for future Amazon Ads execution.

This package is intentionally not an Amazon-themed chatbot. Numerical facts and state transitions are produced by deterministic TypeScript; the LLM chooses tools, interprets results, asks for missing seller inputs, and explains decisions. Trusted account identity, live account state, authorization proof, connector bindings, and future mutation execution stay outside model authority.

## Current scope

The merged V1.0 baseline supports two core workflows:

- Sponsored Products PPC diagnosis from Search Term reports.
- ASIN/SKU known-contribution profitability diagnosis from seller-provided cost data.

V1.1 adds an execution-safety layer after approval:

- compile a signed approval envelope into a deterministic `SellerExecutionPlan`;
- attach exact stale-state preconditions and deterministic idempotency keys;
- execute only against caller-supplied in-memory fake Amazon Ads state;
- return explicit fake-operation receipts for applied state, stale state, duplicates, simulated failures, and skipped operations;
- keep `externalWritesPerformed: false` for every fake execution receipt.

V1.2 adds the trusted boundary required before a real Amazon Ads adapter may exist:

- bind one exact execution plan to one exact Amazon Ads `profileId + marketplaceId + region` scope;
- bind the complete canonical execution-plan content, including operations and preconditions, into the signed authorization;
- issue and verify a signed, expiring `trusted-host` execution authorization;
- read current account state only through a read-only `SellerExecutionStateReader` contract;
- fail the whole batch closed when any operation is stale or unavailable;
- namespace idempotency by Amazon Ads account scope plus plan idempotency key;
- reserve execution identity only after trusted-state preflight is safe;
- return `ready-for-live-adapter` only after authorization, state, and idempotency gates pass.

V1.3 adds a host-controlled foundation for the official Amazon Ads MCP Server:

- normalize an authenticated MCP session into the existing exact Amazon Ads account scope without accepting credential material;
- inventory MCP capabilities while keeping read, mutation, and unknown descriptors non-authoritative;
- pin host-approved semantic reads to an exact tool name, descriptor digest, account scope, and optional adapter version;
- implement an MCP-backed `SellerExecutionStateReader` that exposes only trusted bid and negative-existence reads;
- fail closed on session-scope drift, descriptor drift, malformed connector results, missing/duplicate bindings, or connector failure;
- validate every binding required by a batch before any operation-level MCP read starts;
- compose that trusted reader with the V1.2 signed authorization, full-batch preflight, and account-scoped idempotency gates.

V1.3 still performs **zero Amazon writes**. It contains no generic model-facing MCP proxy, Amazon Ads MCP mutation invocation, direct Amazon Ads mutation HTTP client, Seller Central mutation client, or OAuth access/refresh-token storage. `ready-for-live-adapter` means only that deterministic safety prerequisites passed.

## Core pipeline

```text
seller request
→ report inspection / parsing
→ deterministic data-quality validation
→ deterministic metrics
→ deterministic diagnostic rules
→ ranked Action Plan
→ Change Set
→ target identity enrichment
→ deterministic bid policy where applicable
→ awaiting approval
→ host UI human confirmation
→ signed approval envelope
→ SellerExecutionPlan
→ V1.1 zero-write Dry Run / FakeAmazonAdsExecutor

trusted connector boundary in V1.3:
SellerExecutionPlan
→ signed execution authorization over exact plan content + account scope
→ trusted host Amazon Ads MCP session
→ non-secret session identity normalization
→ capability inventory / firewall
→ host-approved semantic read bindings
→ MCP-backed SellerExecutionStateReader
→ batch-level connector/binding validation
→ full-batch current-state preflight
→ account-scoped idempotency reservation
→ ready-for-live-adapter
→ STOP: V1.3 performs no Amazon mutation
```

## Inputs

### Sponsored Products Search Term report

Required semantic fields include campaign name, ad group name, customer search term, impressions, clicks, spend, and attributed sales. Orders, targeting, match type, currency, and related fields improve diagnosis.

Header-only reports are insufficient. Malformed numeric values, negative advertising metrics, and blank required numeric values stop PPC diagnosis rather than silently becoming business facts.

### Profitability input

At minimum provide ASIN or SKU plus gross sales. Stronger profitability claims require units, refunds, Amazon fees, fulfillment/storage fees, advertising spend, COGS/unit, and other variable costs. Missing costs remain explicit; partial data is never called net profit.

A header-only profitability report is insufficient and invalid numeric values stop diagnosis.

### Target snapshot

For account-object resolution provide non-empty campaign name + ID and ad group name + ID. Targeting, match type, target ID, positive current bid, and state enable target-level bid preparation.

Blank IDs are never considered valid identity. If duplicate rows for one target ID disagree on scope, targeting, match type, bid, or state, resolution fails ambiguous instead of choosing the last row.

CSV and TSV are the current first-class file formats. XLSX is not part of the verified release yet.

### Fake execution state

V1.1 fake execution uses explicit caller-supplied local state. It is simulation state only and is never fetched from or synchronized with Amazon.

### Trusted live-preflight inputs

V1.2 does not accept model/user JSON and relabel it as trusted live state. V1.3 adds the domain-side contract for a trusted host to supply Amazon Ads MCP state, but the host still owns the authenticated session and credentials.

A V1.3 host integration must provide:

- an authenticated `SellerAmazonAdsMcpTransport` session;
- exact Amazon Ads profile ID;
- marketplace ID;
- region;
- the current MCP tool catalog;
- trusted host-approved semantic read bindings pinned to descriptor digests and account scope;
- a durable idempotency implementation before production execution.

The domain layer never asks the LLM to provide OAuth credentials, trusted session identity, or arbitrary MCP tool names.

## Pi tools

The project-local Amazon extension currently exposes:

- `amazon_inspect_report`
- `amazon_diagnose_ppc`
- `amazon_diagnose_profit`
- `amazon_build_action_plan`
- `amazon_build_change_set`
- `amazon_enrich_change_set`
- `amazon_simulate_bid_change`
- `amazon_request_change_set_approval`
- `amazon_decide_change_set`
- `amazon_build_execution_dry_run`
- `amazon_build_execution_plan`
- `amazon_fake_execute_plan`

V1.2/V1.3 trusted live-preflight is intentionally **not** exposed as a model-callable Pi tool. The current chat surface cannot make account identity, MCP capability bindings, or current Amazon state trustworthy simply because the model supplies them. The live entrypoint belongs behind an authenticated connector/host boundary.

Use the project Skill at `.pi/skills/amazon-seller-agent.md` for the existing file-first and V1.1 workflows.

## Deterministic bid proposal

For a high-ACOS bid-down candidate, the current product policy is:

```text
rawBid = currentBid × targetACOS ÷ observedACOS
```

This is not an Amazon-provided formula and is not represented as optimal or guaranteed. The default policy caps a single decrease at 20%, applies a minimum bid floor, and rounds deterministically.

Example:

```text
current bid:   $1.20
observed ACOS: 60%
target ACOS:   30%
raw bid:       $0.60
20% guardrail: $0.96
proposal:      $1.20 → $0.96
```

The proposal still requires host-confirmed human approval.

## Approval integrity

`amazon_request_change_set_approval` only moves a complete draft to `awaiting-approval`.

`amazon_decide_change_set` is model-callable only as a request to open the Pi host confirmation dialog. The tool itself requires a dialog-capable host. The human sees the exact Change Set ID/version and each proposal's before/after state and must click confirm before an approval or rejection is recorded.

A conversational “approve” and a model-provided actor label are not approval proof.

For an approval, the system:

1. records host UI provenance and a host-generated timestamp;
2. computes a canonical SHA-256 digest over the exact approved Change Set content;
3. signs the approval with an ephemeral per-extension HMAC key;
4. returns a signed approval envelope.

`amazon_build_execution_dry_run` and `amazon_build_execution_plan` accept that signed envelope, not a bare approved Change Set. Any post-approval edit to proposal scope, target IDs, before/after values, decision content, digest, or signature fails verification.

## V1.1 execution plan and fake execution

Supported execution-plan mutations are currently:

- `set-bid`
- `add-negative-exact`

A set-bid operation contains an exact `expectedCurrentBid` precondition. An add-negative-exact operation carries the exact campaign/ad-group scope and negative term.

Plan and operation idempotency keys are derived deterministically from exact approved content. The fake adapter stores prior receipts in caller-owned fake state so replaying the same plan returns the prior receipt rather than applying fake state twice.

Fake operation statuses are explicit:

- `applied`: applied to fake in-memory state only;
- `blocked-stale`: fake current state did not match the approved precondition;
- `already-applied`: the desired fake end-state already existed;
- `simulated-failure`: a forced fake failure used to test failure handling;
- `skipped-after-failure`: a later operation was not attempted after a prior simulated failure.

A fake receipt always reports `externalWritesPerformed: false`.

See `docs/amazon-seller-agent-v1.1-execution.md` for the V1.1 execution-safety contract.

## V1.2 trusted live preflight

V1.2 adds a second trust boundary beyond V1.1 fake execution.

### Account-scope authorization

`SellerExecutionAuthorizationEnvelope` binds the exact execution plan to:

- Amazon Ads profile ID;
- marketplace ID;
- region;
- source Change Set identity/version;
- approved-content digest;
- canonical digest of the complete execution plan, including operations and preconditions;
- issuance/expiry window;
- nonce;
- `trusted-host` provenance.

HMAC-SHA256 verification fails if the account scope, plan identity, complete plan content, approved digest, timestamps, nonce, authorization digest, or signature is changed. Preserving the original `planId` while mutating an operation is therefore rejected.

### Trusted current-state reader

`SellerExecutionStateReader` is read-only. It exposes no mutation method.

Per-operation state-preflight outcomes are:

- `ready`: trusted current state still equals the approved before-state and a mutation remains necessary;
- `already-desired`: trusted state already equals the approved desired end-state;
- `blocked-stale`: current state changed to another value after approval;
- `blocked-unavailable`: current state could not be trusted/read/validated.

If any operation is stale or unavailable, the full batch is blocked before idempotency reservation.

### Trusted idempotency

`SellerExecutionIdempotencyStore` reserves by:

```text
Amazon Ads account scope + planIdempotencyKey
```

Results are:

- `reserved`: first identical authorized request;
- `replay`: the exact same authorized request was already reserved;
- `conflict`: the same scoped plan key is associated with different authorized content.

The included in-memory store is test/development infrastructure only. Production execution requires a durable atomic implementation.

### Coordinator outcomes

`buildSellerLiveExecutionPreflight(...)` may return:

- `ready-for-live-adapter`;
- `already-desired`;
- `blocked-stale`;
- `blocked-unavailable`;
- `blocked-idempotency-conflict`;
- `replay`.

Every outcome reports `externalWritesPerformed: false`.

See `docs/amazon-seller-agent-v1.2-live-preflight.md` for the full V1.2 trust contract.

## V1.3 Amazon Ads MCP connector foundation

V1.3 supplies a concrete trusted-host connector boundary for the V1.2 read contract without making MCP a model-owned tool surface.

### Session identity

`SellerAmazonAdsMcpTransport` provides only:

```text
getSessionContext()
listTools()
callReadTool()
```

There is no generic mutation method in the V1.3 transport contract.

The normalized session contains only non-secret identity metadata. Required scope is `profileId + marketplaceId + region`. Secret-shaped connector fields are rejected instead of being copied into domain state.

### Capability firewall

Discovered tools are inventoried as `read-candidate`, `mutation-candidate`, or `unknown`. Classification never grants permission. Tool names and descriptions are untrusted metadata.

Every tool descriptor is hashed. A host-approved semantic binding becomes invalid when its descriptor digest changes.

### Semantic read bindings

V1.3 supports exactly:

- `read-target-bid`;
- `read-negative-exact-existence`.

A binding pins the semantic to one exact tool name, descriptor digest, account scope, and optional adapter version. It has its own binding digest for tamper detection.

The project intentionally does not hardcode guessed official Amazon Ads MCP tool names or schemas. A trusted host must inspect the actual connected catalog before approving bindings.

### MCP-backed state reader and batch gate

`createSellerAmazonAdsMcpStateReader(...)` revalidates authenticated session scope, current descriptor digest, and exact binding before a read. Malformed or ambiguous connector data becomes `unavailable` instead of guessed state.

`buildSellerAmazonAdsMcpLivePreflight(...)` adds a batch-level connector gate: every semantic read required by the execution plan must have one currently valid binding before operation-level MCP reads begin. If any required binding/session/catalog check fails, the full batch becomes `blocked-unavailable` before read calls and before idempotency reservation.

After connector validation, it reuses the V1.2 signed authorization, stale-state, full-batch, and account-scoped idempotency semantics.

See `docs/amazon-seller-agent-v1.3-ads-mcp-connector.md` for the complete V1.3 contract.

## LLM responsibility

The LLM may:

- interpret a seller's natural-language goal;
- choose and sequence the existing file-first/V1.1 Amazon tools;
- explain structured findings and evidence;
- ask for missing seller targets/costs;
- request that the host display the exact approval confirmation dialog;
- explain execution-plan preconditions, fake receipts, and trusted preflight outcomes.

The LLM is not authoritative for:

- ACOS/ROAS/CTR/CVR/CPC arithmetic;
- contribution-profit calculations;
- data-quality acceptance;
- rule firing;
- target ID resolution;
- bid-policy math;
- approval proof;
- trusted Amazon account identity;
- OAuth/session credentials;
- trusted MCP tool catalog or semantic bindings;
- trusted current account state;
- production idempotency reservation;
- Amazon account execution.

Those responsibilities stay in deterministic code and trusted host/connector boundaries.

## Evaluation and regression coverage

Synthetic V1.0 fixtures live under `test/fixtures/v1.0/`. V1.0/V1.1 regression suites cover report parsing, diagnostics, evidence, action planning, Change Sets, approval integrity, deterministic bid proposals, execution plans, fake stale-state handling, replay, simulated failure, partial-failure receipts, and real Pi extension registration of V1.1 tools.

V1.2 adds focused coverage for:

- 8 execution-authorization cases including scope tamper, plan-identity tamper, operation-content tamper, and expiry;
- 9 trusted-state cases including stale, unavailable, already-desired, and full-batch fail-closed behavior;
- 8 account-scoped idempotency cases including replay/conflict/account isolation;
- 9 coordinator cases covering verification order, no reservation on blocked/no-op state, replay, conflict, and `ready-for-live-adapter`.

V1.3 adds focused coverage for:

- authenticated session identity and secret-shaped field rejection;
- capability inventory/firewall and descriptor digests;
- semantic read binding scope/digest/tamper enforcement;
- MCP-backed bid and negative-existence reads;
- session-scope mismatch, descriptor drift, malformed result, and connector exceptions;
- batch-level binding validation before operation reads;
- stale/unavailable/replay/conflict behavior through the V1.2 coordinator;
- zero external writes.

## Safety contract

Every mutation proposal preserves `humanApprovalRequired: true`.

The system fails closed when identifiers, current values, targets, before/after states, report data, approval proof, account scope, execution authorization, trusted state, MCP session identity, semantic binding, descriptor digest, or idempotency identity are missing, invalid, ambiguous, stale, modified, or unavailable.

V1.3 contains no Amazon Ads/Seller Central mutation HTTP client, Amazon Ads MCP mutation invocation, OAuth access token, refresh token, live mutation executor, generic model-facing MCP proxy, or model-callable trusted-live tool. `ready-for-live-adapter` must never be described as executed, applied, synchronized, or successful in Amazon.

## Current release limitations

The current operator still has explicit gaps that should not be hidden:

- no verified XLSX adapter;
- no persistent seller profile/store policy persistence;
- no shipped production Amazon Ads MCP transport/session implementation; V1.3 defines and verifies the trusted host contract;
- no real Amazon Ads/SP-API mutation executor;
- no production durable/atomic idempotency store;
- no reviewed real-session semantic mutation bindings;
- no retry/rate-limit layer, durable production execution receipts, or rollback/recovery engine;
- no scheduled daily execution;
- no web/WorkBuddy operational UI;
- root monorepo CI may still be affected by pre-existing upstream Pi core issues; the dedicated Amazon release gate is the package-specific release signal.

A future mutation phase must not begin until the actual connected Amazon Ads MCP mutation catalog and schemas are captured from an approved partner session, exact semantic mutation bindings are reviewed, OAuth/session ownership stays outside model control, current state is re-read immediately before mutation, idempotency is durable/atomic, receipts are persisted, and retry/partial-failure/recovery semantics are explicitly designed and tested.
