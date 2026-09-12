# Amazon Seller Agent V1.3 Official Amazon Ads MCP Connector Foundation

> **For agentic workers:** Execute task-by-task with Superpowers/TDD. Do not invent Amazon Ads MCP tool names or schemas. Treat the official MCP server as an authenticated external connector behind the V1.2 trust boundary, never as a model-owned tool surface.

**Goal:** Add a host-controlled connector boundary for the official Amazon Ads MCP Server so the seller agent can authenticate one external session, resolve an exact Amazon Ads account scope, discover connector capabilities, and reuse that connector as a trusted read-only state source for V1.2 live preflight—without exposing generic MCP calls or mutation tools to the LLM.

**Why this phase changed:** Amazon Ads announced its official MCP Server in open beta on 2026-02-02. Amazon says it connects AI agents to Amazon Ads API functionality and can support capabilities including campaign creation/update/deletion, reporting, account settings, billing, and pre-built workflows. It is available globally in open beta to Amazon Ads partners with active API credentials. That makes a bespoke LLM-to-Amazon HTTP layer the wrong default architecture. We should integrate the official connector, but keep our deterministic approval/preflight/idempotency boundary in front of all future mutations.

Official references checked September 2026:
- https://advertising.amazon.com/library/news/amazon-ads-mcp-server-open-beta
- https://advertising.amazon.com/about-api
- https://advertising.amazon.com/resources/whats-new/register-and-manage-ads-worldwide-with-global-seat
- https://advertising.amazon.com/resources/ad-policy/partner-network-policies

## Global Constraints

- No model-callable generic `mcp.callTool(name,args)`.
- No guessed Amazon MCP mutation tool names or schemas.
- No OAuth access token, refresh token, client secret, or developer credential in model context, tool arguments, logs, fixtures, or repository files.
- Credentials/session establishment belong to a trusted host/connector runtime outside the LLM.
- Connector-reported account identity must be converted into the existing `SellerAmazonAdsAccountScope` and validated before use.
- Region remains explicit (`NA`, `EU`, `FE`). Amazon documentation notes profile discovery is regional and regional endpoints return regional profile IDs.
- V1.3 connector state reads may feed V1.2 preflight only after account-scope equality is verified.
- A discovered MCP mutation capability does not become executable merely because it exists.
- V1.3 performs zero Amazon mutations. Every domain artifact still reports `externalWritesPerformed: false`.
- Amazon-specific connector code remains in `packages/amazon-agent`; Pi core stays unchanged.

---

### Task 1: Host-Controlled MCP Transport + Session Identity Contract

**Files:**
- Create: `packages/amazon-agent/src/connectors/amazon-ads-mcp/types.ts`
- Create: `packages/amazon-agent/src/connectors/amazon-ads-mcp/session.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.3-mcp-session.test.ts`

Define a transport interface that the trusted host implements. The domain package never owns OAuth material.

```ts
interface SellerAmazonAdsMcpTransport {
  readonly name: string;
  getSessionContext(): Promise<SellerAmazonAdsMcpSessionContext>;
  listTools(): Promise<SellerAmazonAdsMcpToolDescriptor[]>;
  callReadTool(request: SellerAmazonAdsMcpReadRequest): Promise<unknown>;
}
```

`SellerAmazonAdsMcpSessionContext` must contain only non-secret identity metadata needed for scope binding, for example:

```ts
interface SellerAmazonAdsMcpSessionContext {
  authenticated: true;
  profileId: string;
  marketplaceId: string;
  region: "NA" | "EU" | "FE";
  principalId?: string;
}
```

The domain contract intentionally has **no generic mutation method** in V1.3.

- [ ] RED tests: unauthenticated/blank identity rejected; region validation; secrets-shaped fields rejected if accidentally returned; immutable normalized context.
- [ ] Implement minimal session normalization into `SellerAmazonAdsAccountScope`.
- [ ] GREEN.

### Task 2: Capability Discovery + Firewall

**Files:**
- Create: `packages/amazon-agent/src/connectors/amazon-ads-mcp/capabilities.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.3-mcp-capabilities.test.ts`

The official MCP server may expose many tools, including write capabilities. V1.3 must inventory them without automatically trusting them.

Classify discovered tools into:
- `read-candidate`
- `mutation-candidate`
- `unknown`

The classification artifact is descriptive only. It must never grant execution permission.

Rules:
- tool name/description/input schema are treated as untrusted connector metadata until mapped by a host-approved semantic binding;
- no substring heuristic may directly authorize a mutation;
- unknown/mutation candidates cannot be invoked through the V1.3 transport contract;
- capability inventory must preserve raw descriptor digest for auditability.

- [ ] RED tests for read/mutation/unknown classification, descriptor immutability, and ensuring mutation descriptors cannot flow into `callReadTool` bindings.
- [ ] Implement inventory/firewall.
- [ ] GREEN.

### Task 3: Trusted Semantic Read Bindings

**Files:**
- Create: `packages/amazon-agent/src/connectors/amazon-ads-mcp/read-bindings.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.3-mcp-read-bindings.test.ts`

Do not hardcode unknown official tool names. A trusted host supplies an explicit semantic binding after it has inspected the connected server's actual tool catalog.

Supported V1.3 semantic reads:
- `read-target-bid`
- `read-negative-exact-existence`

Each binding must pin:
- semantic capability
- exact MCP tool name
- tool descriptor digest
- exact account scope
- optional adapter version

If the server tool descriptor changes, the binding becomes invalid until re-approved.

- [ ] RED tests: wrong account scope, descriptor drift, unknown semantic capability, mutation candidate binding, and tool name swap all fail closed.
- [ ] Implement binding verification.
- [ ] GREEN.

### Task 4: MCP-Backed `SellerExecutionStateReader`

**Files:**
- Create: `packages/amazon-agent/src/connectors/amazon-ads-mcp/state-reader.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.3-mcp-state-reader.test.ts`

Implement a read-only adapter for the V1.2 `SellerExecutionStateReader` using verified semantic read bindings.

Safety sequence:
1. obtain normalized authenticated session scope;
2. require exact equality with the V1.2 requested scope;
3. verify the semantic binding against current tool catalog descriptor digest;
4. invoke only `callReadTool`;
5. validate returned shape strictly;
6. convert malformed/ambiguous/permission/network errors to explicit `unavailable` state;
7. never infer or guess missing IDs/current values.

- [ ] RED tests: successful bid read, negative existence read, scope mismatch, descriptor drift, malformed result, connector exception, ambiguous result.
- [ ] Implement adapter.
- [ ] GREEN.

### Task 5: Connector + V1.2 Live-Preflight Integration

**Files:**
- Create: `packages/amazon-agent/src/connectors/amazon-ads-mcp/build-preflight.ts`
- Modify: `packages/amazon-agent/src/index.ts`
- Test: `packages/amazon-agent/test/amazon-agent-v1.3-mcp-preflight.test.ts`

Create a host-facing coordinator that wires:

```text
Authenticated Amazon Ads MCP session
        ↓
normalized trusted account scope
        ↓
verified semantic read bindings
        ↓
MCP-backed SellerExecutionStateReader
        ↓
V1.2 signed execution authorization verification
        ↓
V1.2 full-batch trusted-state preflight
        ↓
V1.2 scoped idempotency reservation
        ↓
ready-for-live-adapter
        ↓
STOP — V1.3 still performs zero mutation
```

The coordinator must not expose the transport or discovered tool names to the model.

- [ ] RED tests for exact happy path, wrong account session, authorization scope mismatch, stale bid, unavailable connector, binding drift, replay/conflict.
- [ ] Implement coordinator.
- [ ] GREEN.

### Task 6: Release Gate + Mutation-Readiness Artifact

**Files:**
- Create: `docs/amazon-seller-agent-v1.3-ads-mcp-connector.md`
- Modify: `packages/amazon-agent/README.md`
- Run: all Amazon Agent suites/build/format/whitespace gate.

Document what V1.3 proves and what remains deliberately absent.

V1.3 must still contain no:
- generic model-facing MCP proxy;
- OAuth secret/token handling;
- Amazon Ads MCP mutation invocation;
- direct Amazon Ads HTTP mutation client;
- claim that `ready-for-live-adapter` means Amazon changed.

A future mutation phase may begin only after the actual connected Amazon Ads MCP server's mutation tool catalog and input/output schemas are captured from a real approved partner session and reviewed. At that point, add exact semantic mutation bindings behind the existing human approval + signed plan + live preflight + idempotency gates. Never authorize writes from tool-name heuristics.

- [ ] Run dedicated Amazon formatting check.
- [ ] Run full Amazon package tests.
- [ ] Run package build.
- [ ] Run `git diff --check`.
- [ ] Review diff for credentials, generic MCP proxying, model-controlled trust inputs, raw mutation exposure, and accidental network writes.
- [ ] Keep PR Draft until package gate is green and no P0/P1 remains.
