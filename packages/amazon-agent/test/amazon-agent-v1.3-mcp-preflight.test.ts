import { describe, expect, it } from "vitest";
import {
	buildSellerAmazonAdsMcpLivePreflight,
	createInMemorySellerExecutionIdempotencyStore,
	createSellerAmazonAdsMcpReadBinding,
	createSellerExecutionAuthorizationEnvelope,
	inventorySellerAmazonAdsMcpCapabilities,
	type SellerAmazonAdsAccountScope,
	type SellerAmazonAdsMcpReadBinding,
	type SellerAmazonAdsMcpReadRequest,
	type SellerAmazonAdsMcpToolDescriptor,
	type SellerAmazonAdsMcpTransport,
	type SellerExecutionIdempotencyReservation,
	type SellerExecutionIdempotencyStore,
	type SellerExecutionOperation,
	type SellerExecutionPlan,
} from "../src/index.ts";

const SECRET = new TextEncoder().encode("amazon-agent-v1.3-mcp-preflight-secret");
const NOW = "2026-09-13T04:10:00.000Z";

function scope(): SellerAmazonAdsAccountScope {
	return { profileId: "9876543210", marketplaceId: "ATVPDKIKX0DER", region: "NA" };
}

function bidOperation(): Extract<SellerExecutionOperation, { operation: "set-bid" }> {
	return {
		proposalId: "change:bid",
		operation: "set-bid",
		targetId: "3001",
		before: { bid: 1.2 },
		after: { bid: 0.96 },
		preconditions: { expectedCurrentBid: 1.2 },
		idempotencyKey: "execop:v1.3:bid",
	};
}

function negativeOperation(): Extract<SellerExecutionOperation, { operation: "add-negative-exact" }> {
	return {
		proposalId: "change:negative",
		operation: "add-negative-exact",
		campaignId: "1001",
		adGroupId: "2001",
		negativeExact: "free trail shoes",
		preconditions: { mustNotAlreadyExist: true },
		idempotencyKey: "execop:v1.3:negative",
	};
}

function plan(): SellerExecutionPlan {
	return {
		id: "execplan:v1.3:mcp",
		sourceChangeSetId: "changeset:v1.3:mcp",
		sourceChangeSetVersion: 5,
		approval: {
			actor: "seller-owner",
			decidedAt: "2026-09-13T04:00:00.000Z",
			contentDigest: "approved-v1.3-mcp-digest",
		},
		idempotencyKey: "execplan:v1.3:mcp",
		operations: [bidOperation(), negativeOperation()],
		skippedReviewOnlyProposalIds: [],
	};
}

function authorization(executionPlan = plan(), accountScope = scope()) {
	return createSellerExecutionAuthorizationEnvelope(executionPlan, accountScope, SECRET, {
		issuedAt: "2026-09-13T04:05:00.000Z",
		expiresAt: "2026-09-13T04:15:00.000Z",
		nonce: "nonce-v1.3-mcp-preflight",
	});
}

function descriptors(): SellerAmazonAdsMcpToolDescriptor[] {
	return [
		{
			name: "synthetic-bid-reader",
			inputSchema: { type: "object", properties: { targetId: { type: "string" } } },
			annotations: { readOnlyHint: true },
		},
		{
			name: "synthetic-negative-reader",
			inputSchema: { type: "object", properties: { negativeExact: { type: "string" } } },
			annotations: { readOnlyHint: true },
		},
	];
}

function bindings(toolDescriptors = descriptors(), accountScope = scope()): SellerAmazonAdsMcpReadBinding[] {
	const inventory = inventorySellerAmazonAdsMcpCapabilities(toolDescriptors);
	const bid = inventory.capabilities.find((item) => item.name === "synthetic-bid-reader")!;
	const negative = inventory.capabilities.find((item) => item.name === "synthetic-negative-reader")!;
	return [
		createSellerAmazonAdsMcpReadBinding(
			{
				semantic: "read-target-bid",
				toolName: bid.name,
				descriptorDigest: bid.descriptorDigest,
				accountScope,
			},
			inventory,
		),
		createSellerAmazonAdsMcpReadBinding(
			{
				semantic: "read-negative-exact-existence",
				toolName: negative.name,
				descriptorDigest: negative.descriptorDigest,
				accountScope,
			},
			inventory,
		),
	];
}

interface TransportOptions {
	sessionScope?: SellerAmazonAdsAccountScope;
	tools?: SellerAmazonAdsMcpToolDescriptor[];
	bid?: number;
	negativeExists?: boolean;
	throwOnRead?: boolean;
	onRead?: (request: SellerAmazonAdsMcpReadRequest) => void;
}

function transport(options: TransportOptions = {}): SellerAmazonAdsMcpTransport {
	const sessionScope = options.sessionScope ?? scope();
	return {
		name: "synthetic-amazon-ads-mcp",
		async getSessionContext() {
			return { authenticated: true, ...sessionScope };
		},
		async listTools() {
			return options.tools ?? descriptors();
		},
		async callReadTool(request) {
			options.onRead?.(structuredClone(request));
			if (options.throwOnRead) throw new Error("synthetic connector unavailable");
			if (request.toolName === "synthetic-bid-reader") return { currentBid: options.bid ?? 1.2 };
			if (request.toolName === "synthetic-negative-reader") return { exists: options.negativeExists ?? false };
			throw new Error("unexpected synthetic read tool");
		},
	};
}

function conflictingStore(): {
	store: SellerExecutionIdempotencyStore;
	requests: SellerExecutionIdempotencyReservation[];
} {
	const requests: SellerExecutionIdempotencyReservation[] = [];
	return {
		requests,
		store: {
			name: "synthetic-conflict-store",
			async reserve(request) {
				requests.push(structuredClone(request));
				return { status: "conflict" };
			},
		},
	};
}

describe("Amazon Seller Agent V1.3 MCP live-preflight coordinator", () => {
	it("returns ready-for-live-adapter through verified MCP reads and performs zero external writes", async () => {
		const executionPlan = plan();
		const calls: SellerAmazonAdsMcpReadRequest[] = [];
		const result = await buildSellerAmazonAdsMcpLivePreflight({
			plan: executionPlan,
			authorizationEnvelope: authorization(executionPlan),
			authorizationSecret: SECRET,
			transport: transport({ onRead: (request) => calls.push(request) }),
			bindings: bindings(),
			idempotencyStore: createInMemorySellerExecutionIdempotencyStore(),
			now: NOW,
		});

		expect(result).toMatchObject({
			status: "ready-for-live-adapter",
			accountScope: scope(),
			planId: executionPlan.id,
			externalWritesPerformed: false,
		});
		expect(result.reservationId).toMatch(/^execres:/);
		expect(result.operations.map((operation) => operation.status)).toEqual(["ready", "ready"]);
		expect(calls.map((request) => request.toolName)).toEqual(["synthetic-bid-reader", "synthetic-negative-reader"]);
	});

	it("blocks before reservation when the authenticated MCP session is for another account", async () => {
		const executionPlan = plan();
		const { store, requests } = conflictingStore();
		const result = await buildSellerAmazonAdsMcpLivePreflight({
			plan: executionPlan,
			authorizationEnvelope: authorization(executionPlan),
			authorizationSecret: SECRET,
			transport: transport({ sessionScope: { ...scope(), profileId: "other-profile" } }),
			bindings: bindings(),
			idempotencyStore: store,
			now: NOW,
		});

		expect(result.status).toBe("blocked-unavailable");
		expect(result.externalWritesPerformed).toBe(false);
		expect(requests).toHaveLength(0);
	});

	it("blocks when signed authorization scope differs from the authenticated MCP session", async () => {
		const executionPlan = plan();
		const otherScope: SellerAmazonAdsAccountScope = { ...scope(), profileId: "authorized-other-profile" };
		const result = await buildSellerAmazonAdsMcpLivePreflight({
			plan: executionPlan,
			authorizationEnvelope: authorization(executionPlan, otherScope),
			authorizationSecret: SECRET,
			transport: transport(),
			bindings: bindings(descriptors(), otherScope),
			idempotencyStore: createInMemorySellerExecutionIdempotencyStore(),
			now: NOW,
		});

		expect(result.status).toBe("blocked-unavailable");
		expect(result.accountScope).toEqual(otherScope);
		expect(result.externalWritesPerformed).toBe(false);
	});

	it("blocks stale bid state and does not reserve idempotency", async () => {
		const executionPlan = plan();
		const { store, requests } = conflictingStore();
		const result = await buildSellerAmazonAdsMcpLivePreflight({
			plan: executionPlan,
			authorizationEnvelope: authorization(executionPlan),
			authorizationSecret: SECRET,
			transport: transport({ bid: 0.8 }),
			bindings: bindings(),
			idempotencyStore: store,
			now: NOW,
		});

		expect(result.status).toBe("blocked-stale");
		expect(result.externalWritesPerformed).toBe(false);
		expect(requests).toHaveLength(0);
	});

	it("converts connector read failure into blocked-unavailable without reservation", async () => {
		const executionPlan = plan();
		const { store, requests } = conflictingStore();
		const result = await buildSellerAmazonAdsMcpLivePreflight({
			plan: executionPlan,
			authorizationEnvelope: authorization(executionPlan),
			authorizationSecret: SECRET,
			transport: transport({ throwOnRead: true }),
			bindings: bindings(),
			idempotencyStore: store,
			now: NOW,
		});

		expect(result.status).toBe("blocked-unavailable");
		expect(result.externalWritesPerformed).toBe(false);
		expect(requests).toHaveLength(0);
	});

	it("never propagates raw connector preflight exceptions or credentials into the result", async () => {
		const executionPlan = plan();
		const secret = "SECRET_ACCESS_TOKEN_456";
		const { store, requests } = conflictingStore();
		const failingTransport: SellerAmazonAdsMcpTransport = {
			...transport(),
			async getSessionContext() {
				throw new Error(`session failed accessToken=${secret} authorization=Bearer ${secret}`);
			},
		};
		const result = await buildSellerAmazonAdsMcpLivePreflight({
			plan: executionPlan,
			authorizationEnvelope: authorization(executionPlan),
			authorizationSecret: SECRET,
			transport: failingTransport,
			bindings: bindings(),
			idempotencyStore: store,
			now: NOW,
		});
		const serialized = JSON.stringify(result);

		expect(result.status).toBe("blocked-unavailable");
		expect(result.externalWritesPerformed).toBe(false);
		expect(requests).toHaveLength(0);
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toMatch(/accessToken=|authorization=Bearer/i);
	});

	it("blocks descriptor drift before any connector read or reservation", async () => {
		const executionPlan = plan();
		const calls: SellerAmazonAdsMcpReadRequest[] = [];
		const drifted = descriptors();
		drifted[0] = { ...drifted[0]!, inputSchema: { type: "object", required: ["targetId", "drift"] } };
		const { store, requests } = conflictingStore();
		const result = await buildSellerAmazonAdsMcpLivePreflight({
			plan: executionPlan,
			authorizationEnvelope: authorization(executionPlan),
			authorizationSecret: SECRET,
			transport: transport({ tools: drifted, onRead: (request) => calls.push(request) }),
			bindings: bindings(),
			idempotencyStore: store,
			now: NOW,
		});

		expect(result.status).toBe("blocked-unavailable");
		expect(calls).toHaveLength(0);
		expect(requests).toHaveLength(0);
	});

	it("returns replay for the same scoped authorized plan and blocks idempotency conflicts", async () => {
		const executionPlan = plan();
		const store = createInMemorySellerExecutionIdempotencyStore();
		const input = {
			plan: executionPlan,
			authorizationEnvelope: authorization(executionPlan),
			authorizationSecret: SECRET,
			transport: transport(),
			bindings: bindings(),
			idempotencyStore: store,
			now: NOW,
		};
		const first = await buildSellerAmazonAdsMcpLivePreflight(input);
		const second = await buildSellerAmazonAdsMcpLivePreflight(input);
		expect(first.status).toBe("ready-for-live-adapter");
		expect(second.status).toBe("replay");
		expect(second.reservationId).toBe(first.reservationId);

		const conflict = conflictingStore();
		const conflictResult = await buildSellerAmazonAdsMcpLivePreflight({
			...input,
			idempotencyStore: conflict.store,
		});
		expect(conflictResult.status).toBe("blocked-idempotency-conflict");
		expect(conflict.requests).toHaveLength(1);
		expect(conflictResult.externalWritesPerformed).toBe(false);
	});
});
