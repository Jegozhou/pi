import { describe, expect, it } from "vitest";
import {
	createSellerAmazonAdsMcpReadBinding,
	createSellerAmazonAdsMcpStateReader,
	inventorySellerAmazonAdsMcpCapabilities,
	type SellerAmazonAdsAccountScope,
	type SellerAmazonAdsMcpReadBinding,
	type SellerAmazonAdsMcpReadRequest,
	type SellerAmazonAdsMcpToolDescriptor,
	type SellerAmazonAdsMcpTransport,
	type SellerExecutionOperation,
} from "../src/index.ts";

const scope: SellerAmazonAdsAccountScope = {
	profileId: "9876543210",
	marketplaceId: "ATVPDKIKX0DER",
	region: "NA",
};

function descriptors(): SellerAmazonAdsMcpToolDescriptor[] {
	return [
		{
			name: "synthetic-bid-reader",
			inputSchema: { type: "object", properties: { targetId: { type: "string" } } },
			annotations: { readOnlyHint: true },
		},
		{
			name: "synthetic-negative-reader",
			inputSchema: { type: "object", properties: { value: { type: "string" } } },
			annotations: { readOnlyHint: true },
		},
	];
}

function bindings(toolDescriptors = descriptors()): SellerAmazonAdsMcpReadBinding[] {
	const inventory = inventorySellerAmazonAdsMcpCapabilities(toolDescriptors);
	const bid = inventory.capabilities.find((item) => item.name === "synthetic-bid-reader")!;
	const negative = inventory.capabilities.find((item) => item.name === "synthetic-negative-reader")!;
	return [
		createSellerAmazonAdsMcpReadBinding(
			{
				semantic: "read-target-bid",
				toolName: bid.name,
				descriptorDigest: bid.descriptorDigest,
				accountScope: scope,
			},
			inventory,
		),
		createSellerAmazonAdsMcpReadBinding(
			{
				semantic: "read-negative-exact-existence",
				toolName: negative.name,
				descriptorDigest: negative.descriptorDigest,
				accountScope: scope,
			},
			inventory,
		),
	];
}

const bidOperation: SellerExecutionOperation = {
	proposalId: "proposal-bid",
	operation: "set-bid",
	targetId: "target-3001",
	before: { bid: 1.2 },
	after: { bid: 0.96 },
	preconditions: { expectedCurrentBid: 1.2 },
	idempotencyKey: "op:bid",
};

const negativeOperation: SellerExecutionOperation = {
	proposalId: "proposal-negative",
	operation: "add-negative-exact",
	campaignId: "campaign-1001",
	adGroupId: "adgroup-2001",
	negativeExact: "free trail shoes",
	preconditions: { mustNotAlreadyExist: true },
	idempotencyKey: "op:negative",
};

function transport(options: {
	session?: unknown;
	tools?: SellerAmazonAdsMcpToolDescriptor[];
	call?: (request: SellerAmazonAdsMcpReadRequest) => Promise<unknown>;
} = {}): SellerAmazonAdsMcpTransport {
	return {
		name: "synthetic-amazon-ads-mcp",
		async getSessionContext() {
			return (
				options.session ?? {
					authenticated: true,
					profileId: scope.profileId,
					marketplaceId: scope.marketplaceId,
					region: scope.region,
				}
			);
		},
		async listTools() {
			return options.tools ?? descriptors();
		},
		async callReadTool(request) {
			if (options.call) return options.call(request);
			if (request.toolName === "synthetic-bid-reader") return { currentBid: 1.2 };
			if (request.toolName === "synthetic-negative-reader") return { exists: false };
			throw new Error("unexpected synthetic tool");
		},
	};
}

describe("Amazon Seller Agent V1.3 MCP-backed trusted state reader", () => {
	it("reads a target bid through the exact verified semantic binding", async () => {
		const calls: SellerAmazonAdsMcpReadRequest[] = [];
		const reader = createSellerAmazonAdsMcpStateReader(
			transport({
				call: async (request) => {
					calls.push(structuredClone(request));
					return { currentBid: 1.2 };
				},
			}),
			bindings(),
		);

		expect(await reader.readOperationState(scope, bidOperation)).toEqual({
			operation: "set-bid",
			status: "available",
			currentBid: 1.2,
		});
		expect(calls).toEqual([
			{
				toolName: "synthetic-bid-reader",
				arguments: {
					profileId: scope.profileId,
					marketplaceId: scope.marketplaceId,
					region: scope.region,
					targetId: "target-3001",
				},
			},
		]);
	});

	it("reads exact-negative existence through its separate verified binding", async () => {
		const reader = createSellerAmazonAdsMcpStateReader(transport(), bindings());
		expect(await reader.readOperationState(scope, negativeOperation)).toEqual({
			operation: "add-negative-exact",
			status: "available",
			exists: false,
		});
	});

	it("fails closed before tool invocation when authenticated session scope differs", async () => {
		let calls = 0;
		const reader = createSellerAmazonAdsMcpStateReader(
			transport({
				session: { authenticated: true, profileId: "other-profile", marketplaceId: scope.marketplaceId, region: "NA" },
				call: async () => {
					calls += 1;
					return { currentBid: 1.2 };
				},
			}),
			bindings(),
		);
		const result = await reader.readOperationState(scope, bidOperation);
		expect(result).toMatchObject({ operation: "set-bid", status: "unavailable" });
		expect((result as { reason?: string }).reason).toMatch(/scope|profile|session/i);
		expect(calls).toBe(0);
	});

	it("fails closed on descriptor drift before invoking the read tool", async () => {
		let calls = 0;
		const drifted = descriptors();
		drifted[0] = { ...drifted[0]!, inputSchema: { type: "object", required: ["targetId", "drift"] } };
		const reader = createSellerAmazonAdsMcpStateReader(
			transport({
				tools: drifted,
				call: async () => {
					calls += 1;
					return { currentBid: 1.2 };
				},
			}),
			bindings(),
		);
		const result = await reader.readOperationState(scope, bidOperation);
		expect(result).toMatchObject({ operation: "set-bid", status: "unavailable" });
		expect((result as { reason?: string }).reason).toMatch(/descriptor|digest|drift|binding/i);
		expect(calls).toBe(0);
	});

	it("converts malformed or ambiguous connector results to unavailable state", async () => {
		for (const payload of [{}, { currentBid: 0 }, { currentBid: -1 }, { currentBid: "1.20" }, [{ currentBid: 1.2 }]]) {
			const reader = createSellerAmazonAdsMcpStateReader(
				transport({ call: async () => payload }),
				bindings(),
			);
			expect(await reader.readOperationState(scope, bidOperation)).toMatchObject({
				operation: "set-bid",
				status: "unavailable",
			});
		}
		for (const payload of [{}, { exists: "false" }, [{ exists: false }]]) {
			const reader = createSellerAmazonAdsMcpStateReader(
				transport({ call: async () => payload }),
				bindings(),
			);
			expect(await reader.readOperationState(scope, negativeOperation)).toMatchObject({
				operation: "add-negative-exact",
				status: "unavailable",
			});
		}
	});

	it("converts connector/session/catalog exceptions into unavailable state", async () => {
		for (const failingTransport of [
			transport({ call: async () => Promise.reject(new Error("network read failed")) }),
			{
				...transport(),
				async getSessionContext() {
					throw new Error("session unavailable");
				},
			},
			{
				...transport(),
				async listTools() {
					throw new Error("catalog unavailable");
				},
			},
		]) {
			const reader = createSellerAmazonAdsMcpStateReader(failingTransport, bindings());
			const result = await reader.readOperationState(scope, bidOperation);
			expect(result).toMatchObject({ operation: "set-bid", status: "unavailable" });
			expect((result as { reason?: string }).reason).toMatch(/failed|unavailable|catalog|session|connector/i);
		}
	});

	it("fails closed when a required semantic binding is missing or duplicated", async () => {
		const all = bindings();
		for (const badBindings of [[all[1]!], [all[0]!, all[0]!, all[1]!]]) {
			const reader = createSellerAmazonAdsMcpStateReader(transport(), badBindings);
			const result = await reader.readOperationState(scope, bidOperation);
			expect(result).toMatchObject({ operation: "set-bid", status: "unavailable" });
			expect((result as { reason?: string }).reason).toMatch(/binding|missing|duplicate|ambiguous/i);
		}
	});
});
