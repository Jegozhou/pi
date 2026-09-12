# Amazon Seller Agent V1.3 Amazon Ads MCP Connector Foundation

V1.3 connects the Amazon Seller Agent trust boundary to an authenticated Amazon Ads MCP host session **without** giving the LLM a generic MCP tool surface and **without** performing any Amazon mutation.

The phase exists to answer one question safely:

> Can an approved Amazon Seller execution plan obtain trustworthy, account-scoped current state from an authenticated Amazon Ads MCP connector and pass the existing V1.2 live-preflight gates without exposing credentials or write tools to the model?

For V1.3, the answer is yes for the host-controlled connector contract implemented here. The output still stops at `ready-for-live-adapter`; `externalWritesPerformed` remains `false`.

## Architecture

```text
LLM / chat
  ↓ intent and explanation only
trusted host runtime
  ↓ owns authenticated Amazon Ads MCP session
SellerAmazonAdsMcpTransport
  ├─ getSessionContext()
  ├─ listTools()
  └─ callReadTool()
       ↓
non-secret session identity normalization
       ↓
exact profileId + marketplaceId + region scope
       ↓
capability inventory / firewall
       ↓
host-approved semantic read bindings
       ↓
MCP-backed SellerExecutionStateReader
       ↓
V1.2 signed execution authorization
       ↓
full-batch trusted-state preflight
       ↓
account-scoped idempotency reservation
       ↓
ready-for-live-adapter
       ↓
STOP — no Amazon mutation in V1.3
```

The transport interface deliberately has no generic mutation method.

## Host-controlled session boundary

`normalizeSellerAmazonAdsMcpSessionContext(...)` converts connector session metadata into a trusted domain scope containing only the non-secret identity required by the execution boundary:

- Amazon Ads profile ID;
- marketplace ID;
- region (`NA`, `EU`, or `FE`);
- optional non-secret principal ID.

The session must report `authenticated: true` and all required identity fields must be non-empty.

Secret-shaped fields are rejected recursively. This includes fields such as access tokens, refresh tokens, client secrets, authorization headers, and similar credential material. V1.3 does not store or pass those values through domain objects, model context, fixtures, or logs.

Credential acquisition and refresh remain responsibilities of the trusted host/connector runtime.

## Capability inventory is not authorization

The connected MCP server may expose both read and mutation capabilities. V1.3 inventories tool descriptors and classifies them as:

- `read-candidate`;
- `mutation-candidate`;
- `unknown`.

This classification is descriptive only.

Tool names and descriptions never grant authority. A tool called `readBid`, `updateCampaign`, or anything else is still untrusted connector metadata until the host has explicitly approved a semantic binding. Mutation and unknown candidates cannot pass through the V1.3 read firewall.

Every complete JSON-compatible descriptor receives a deterministic SHA-256 digest, including metadata that the domain does not otherwise interpret. Descriptor drift invalidates an existing semantic binding until the host reviews and re-approves the changed contract.

## Trusted semantic read bindings

V1.3 supports exactly two domain read semantics:

- `read-target-bid`;
- `read-negative-exact-existence`.

A trusted host binding pins all of the following:

```text
semantic capability
+ exact MCP tool name
+ exact tool descriptor digest
+ exact Amazon Ads account scope
+ optional adapter version
```

The resulting binding also has its own digest. Tool-name swaps, descriptor changes, scope changes, unsupported semantics, blank adapter versions, duplicate bindings, mutation candidates, and unknown candidates fail closed.

The repository intentionally does **not** hardcode guessed official Amazon Ads MCP tool names or schemas. The real connected server's current catalog must be inspected by the trusted host before bindings are created.

## MCP-backed current-state reader

`createSellerAmazonAdsMcpStateReader(...)` implements the existing V1.2 `SellerExecutionStateReader` contract.

For every state read it:

1. validates the requested account scope;
2. obtains the authenticated MCP session identity;
3. requires exact session scope equality with the requested scope;
4. inventories the current MCP tool catalog;
5. verifies the relevant semantic binding against the current descriptor digest and exact account scope;
6. calls only `callReadTool(...)`;
7. strictly validates the returned shape;
8. converts connector, permission, malformed-result, ambiguous-result, scope, or descriptor failures into explicit `unavailable` state.

`SellerAmazonAdsMcpReadRequest.arguments` and the accepted `{ currentBid }` / `{ exists }` responses are **normalized host-adapter contracts**, not claims about the official Amazon Ads MCP wire schema. A production host transport must inspect the exact bound descriptor, map these normalized domain fields to that reviewed tool's actual input schema, call the bound read tool, and normalize its actual output back into the strict domain shape. If the official descriptor changes, the descriptor digest changes and the binding is invalidated before the adapter may be used again.

A bid read is accepted only when `currentBid` is a finite positive number. A negative-exact existence read is accepted only when `exists` is a boolean. Arrays, missing fields, strings pretending to be numbers/booleans, zero/negative bids, and other ambiguous values are rejected.

The reader never guesses missing IDs or state.

## Batch-level connector prevalidation

`buildSellerAmazonAdsMcpLivePreflight(...)` adds one important batch-level gate before V1.2 reads begin.

It first verifies the signed execution authorization, then requires:

- the authenticated MCP session scope to equal the authorization account scope;
- the current tool catalog to validate;
- every semantic read required by the execution plan to have exactly one trusted binding;
- every required binding to match the current descriptor digest and exact authorization scope.

If any required binding or connector identity is invalid, the whole batch is converted to `blocked-unavailable` **before any operation-level MCP read is invoked** and before any idempotency reservation is created.

This prevents a mixed batch from reading one operation after another operation has already proven the connector contract stale.

After that batch gate passes, the coordinator reuses the V1.2 primitives rather than reimplementing them:

```text
verify signed authorization
→ trusted MCP current-state reads
→ V1.2 stale/unavailable/already-desired checks
→ scoped idempotency reserve/replay/conflict
→ ready-for-live-adapter
```

## Coordinator outcomes

The V1.3 coordinator returns the existing V1.2 result statuses:

- `ready-for-live-adapter`;
- `already-desired`;
- `blocked-stale`;
- `blocked-unavailable`;
- `blocked-idempotency-conflict`;
- `replay`.

Every result still reports:

```text
externalWritesPerformed: false
```

`ready-for-live-adapter` means only that the signed plan, authenticated account scope, trusted read bindings, current state, and idempotency gates passed. It does **not** mean Amazon Ads changed.

## What the LLM can and cannot control

The LLM may decide that a seller workflow needs live preflight and may explain the structured result.

The LLM does not control:

- OAuth credentials or session establishment;
- Amazon Ads profile/marketplace/region identity;
- discovered MCP tool catalog;
- trusted semantic binding creation;
- descriptor digest approval;
- signed execution authorization;
- current-state truth;
- idempotency reservation;
- any future Amazon mutation.

There is no model-facing `mcp.callTool(name, args)` escape hatch in V1.3.

## Mutation-readiness boundary

Amazon Ads announced its official MCP Server in open beta in 2026 and describes it as connecting AI agents to Amazon Ads API functionality, including capabilities that can create, update, and delete advertising entities. V1.3 intentionally does not consume those mutation capabilities.

A future mutation phase may begin only after an approved partner session provides the actual current mutation tool descriptors and input/output schemas for review. That future phase must add exact semantic mutation bindings behind all existing gates:

```text
host-confirmed human approval
→ signed exact execution plan
→ exact authenticated Amazon Ads account scope
→ approved mutation descriptor binding
→ live current-state preflight
→ durable atomic idempotency
→ mutation adapter
→ durable execution receipt / recovery semantics
```

Writes must never be authorized from tool-name heuristics.

Before production mutation, the project also still needs a durable atomic idempotency store, persistent execution receipts, retry/rate-limit semantics, and explicit partial-failure/recovery behavior.

## Verification coverage

The V1.3 focused suites cover:

- authenticated/non-secret session normalization;
- invalid/secret-shaped session rejection, including prefixed/nested token and secret field names;
- capability read/mutation/unknown classification;
- complete raw descriptor preservation and digest drift, including unmodeled schema/annotation metadata;
- trusted semantic binding creation and tamper detection;
- exact account-scope binding;
- bid and negative-existence MCP state reads;
- malformed/ambiguous connector results;
- connector/session/catalog exceptions;
- wrong authenticated account scope;
- batch-level binding drift before operation reads;
- stale live state;
- unavailable state;
- `ready-for-live-adapter`;
- replay and idempotency conflict;
- zero external writes.

The dedicated Amazon package gate also runs all prior V0.x, V1.0, V1.1, and V1.2 regression suites.

## Deliberately absent from V1.3

V1.3 contains no:

- generic model-facing MCP proxy;
- OAuth access-token/refresh-token/client-secret storage;
- guessed official mutation tool names or schemas;
- Amazon Ads MCP mutation invocation;
- direct Amazon Ads HTTP mutation client;
- Seller Central/SP-API mutation client;
- production durable idempotency persistence;
- mutation retry/rate-limit layer;
- production execution receipt store;
- rollback/recovery engine.

This is a connector **foundation**, not live execution.

## Official references

References checked for the V1.3 design in September 2026:

- Amazon Ads MCP Server open beta: https://advertising.amazon.com/library/news/amazon-ads-mcp-server-open-beta
- Amazon Ads API overview: https://advertising.amazon.com/about-api
- Amazon Ads global account/seat context: https://advertising.amazon.com/resources/whats-new/register-and-manage-ads-worldwide-with-global-seat
