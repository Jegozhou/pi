# Amazon Seller Agent V1.0 Operator Workflow

## Purpose

This document shows the intended seller-facing workflow for the file-first V1.0 release candidate. The goal is to make the agent behave like an operator: understand the seller's request, call deterministic tools, preserve evidence, and stop before any real Amazon account write.

## Example seller request

> 看一下这个 Search Term Report 哪些词在浪费钱，先处理最严重的；如果能定位到具体 target，就给我一个安全的竞价建议，但不要直接修改 Amazon。

## Step 1 — Inspect input when schema is uncertain

Use `amazon_inspect_report` when the uploaded file type or required columns are unclear.

Expected behavior:

- recognize supported Search Term report columns;
- return missing fields/warnings explicitly;
- never invent missing values.

## Step 2 — Diagnose PPC

Use `amazon_diagnose_ppc` with the seller's explicit target ACOS when target-dependent rules are needed.

Example policy input:

```text
target ACOS = 0.30
```

Possible deterministic findings include:

- zero-sales waste → negative-exact candidate;
- ACOS materially above target → bid-down candidate;
- efficient discovery term → exact-target migration candidate;
- efficient source targeting → cautious scale candidate.

Every finding contains the source file/row and rule ID. Header-only reports, malformed numeric data, negative advertising metrics, or blank required numeric values fail closed instead of being treated as a successful diagnosis.

## Step 3 — Diagnose profitability when seller cost data exists

Use `amazon_diagnose_profit` with a seller-supplied profitability CSV/TSV.

Results are described as `known contribution profit` / `known contribution margin`. If costs are missing, the result remains `partial`; it is not called net profit. A header-only profitability report is insufficient data and must fail rather than returning a successful zero-row diagnosis.

## Step 4 — Build the ranked Action Plan

Use `amazon_build_action_plan` to rank deterministic findings rather than asking the model to free-form which item matters most.

The current ranking deliberately prioritizes known negative contribution risk and obvious zero-sales waste ahead of optimization/growth candidates.

## Step 5 — Convert actions into an auditable Change Set

Use `amazon_build_change_set`.

At this point recommendations are not assumed executable. Missing campaign/ad-group/target IDs, current bids, destination scopes, or proposed values remain explicit `missingInputs` and keep the proposal `blocked`.

Change Set identifiers are derived from a hash of the ordered action IDs rather than raw delimiter-based string concatenation.

## Step 6 — Resolve account-object identity from a local snapshot

Use `amazon_enrich_change_set` when the seller supplies a local target snapshot with campaign/ad-group IDs and, ideally, targeting, match type, target ID, bid, and state.

Resolver rules:

- blank campaign/ad-group/target identifiers are not usable identity;
- zero matches → blocked;
- multiple conflicting identities → ambiguous/blocked;
- duplicate rows for the same target ID that disagree on scope, current bid, targeting, match type, or state → ambiguous/blocked;
- exact duplicate rows with the same identity and state may resolve;
- never choose the "most likely" row;
- IDs are preserved as identifiers, not used in arithmetic.

A negative-exact proposal can become ready only after a non-empty campaign/ad-group scope resolves. A bid-down proposal can resolve `targetId` and a positive `currentBid` but still waits for deterministic bid simulation.

## Step 7 — Simulate the bid proposal

Use `amazon_simulate_bid_change` for an enriched `set-bid` proposal.

V1.0 policy:

```text
rawBid = currentBid × targetACOS ÷ observedACOS
```

Default safety guardrails:

- maximum single-step decrease: 20%;
- minimum bid: 0.02;
- deterministic currency rounding.

Example:

```text
current bid   = $1.20
observed ACOS = 60%
target ACOS   = 30%
raw bid       = $0.60
20% floor     = $0.96
proposed bid  = $0.96
```

The agent should say this is a deterministic policy proposal, not an Amazon-official/optimal bid prediction.

## Step 8 — Host-confirmed human approval

Use `amazon_request_change_set_approval` only when no mutating proposal is blocked and at least one mutation is `ready`. This moves the Change Set to `awaiting-approval`; it does not prove that a human approved anything.

The model may then call `amazon_decide_change_set`, but the call itself is not approval. The tool requires a dialog-capable Pi host and displays the exact Change Set ID, version, operation list, and before/after values through the host UI.

The human must click the host confirmation dialog. If no UI is available or the human declines, the decision fails closed.

On approval:

- the host generates the decision timestamp;
- the decision records `provenance = host-ui-confirmation`;
- deterministic code seals the approved Change Set with a content digest;
- the extension signs the exact approved content with an ephemeral per-extension HMAC key;
- `amazon_decide_change_set` returns a signed approval envelope.

The `actor` field is only a display label. It is not proof that a human approved the action.

`approved` still means approved for a future executor. It does not mean Amazon was changed.

## Step 9 — Verify the approval envelope and build the execution Dry Run

Use `amazon_build_execution_dry_run` with the exact `approvalEnvelopeJson` returned from the host-confirmed approval step. The tool no longer accepts a bare approved Change Set JSON object.

Before producing the Dry Run it verifies:

- the HMAC signature belongs to the current extension approval session;
- the content digest still matches the exact approved Change Set;
- the exact approved version is current when `expectedVersion` is provided;
- there are no blocked mutations;
- before/after state and object identity are complete;
- the operation type is supported.

Any edit to target scope, IDs, current/proposed values, proposal content, decision content, digest, or signature after approval invalidates the artifact and stops the workflow.

A valid dry run records operations such as:

```text
ADD_NEGATIVE_EXACT
campaignId: 1001
adGroupId: 2001
value: free trail shoes

SET_BID
targetId: 3001
before: $1.20
after:  $0.96
```

The artifact must contain:

```text
mode = dry-run
writesPerformed = false
```

Review-only profitability items are recorded as skipped analytical work.

The approval signing key is intentionally ephemeral. If the Pi extension reloads or the process restarts, request fresh human approval rather than attempting to reuse or reconstruct an old envelope.

## LLM vs deterministic code

The LLM is responsible for:

```text
自然语言意图
→ 选择/编排工具
→ 解释确定性结果
→ 发现缺失输入
→ 请求宿主显示审批确认
```

The LLM is not the source of approval proof and cannot generate a valid approval signature by itself.

The deterministic/host layer is responsible for:

```text
解析
→ 数据质量校验
→ 指标
→ 规则
→ 排序
→ ID匹配
→ Bid计算
→ 状态机
→ 宿主人工确认
→ 内容摘要/HMAC验签
→ Dry Run
```

This boundary is intentional: changing the LLM should not change the same report's arithmetic, identity resolution, approval proof, or safety state transitions.

## V1.0 stop point

The workflow intentionally stops at Dry Run. There is no real Amazon Ads/Seller Central mutation adapter in the V1.0 file-first release candidate.

A future real executor must remain a separate adapter below this pipeline so diagnosis, evidence, policy, approval, and approval verification do not need to be rewritten.
