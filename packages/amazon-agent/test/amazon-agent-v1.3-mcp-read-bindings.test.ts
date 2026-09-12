import { describe, expect, it } from "vitest";
import {
	createSellerAmazonAdsMcpReadBinding,
	inventorySellerAmazonAdsMcpCapabilities,
	type SellerAmazonAdsAccountScope,
	type SellerAmazonAdsMcpReadBinding,
	type SellerAmazonAdsMcpSemanticRead,
	type SellerAmazonAdsMcpToolDescriptor,
	verifySellerAmazonAdsMcpReadBinding,
} from "../src/index.ts";

const scope: SellerAmazonAdsAccountScope = {
	profileId: "9876543210",
	marketplaceId: "ATVPDKIKX0DER",
	region: "NA",
};

function tools(): SellerAmazonAdsMcpToolDescriptor[] {
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
		{
			name: "synthetic-mutation",
			inputSchema: { type: "object" },
			annotations: { readOnlyHint: false },
		},
		{
			name: "synthetic-unknown",
			inputSchema: { type: "object" },
		},
	];
}

function bind(semantic: SellerAmazonAdsMcpSemanticRead, toolName: string): SellerAmazonAdsMcpReadBinding {
	const inventory = inventorySellerAmazonAdsMcpCapabilities(tools());
	const capability = inventory.capabilities.find((candidate) => candidate.name === toolName);
	if (!capability) throw new Error("missing synthetic capability");
	return createSellerAmazonAdsMcpReadBinding(
		{
			semantic,
			toolName,
			descriptorDigest: capability.descriptorDigest,
			accountScope: scope,
			adapterVersion: "test-v1",
		},
		inventory,
	);
}

describe("Amazon Seller Agent V1.3 trusted MCP semantic read bindings", () => {
	it("binds target-bid semantics to one exact read candidate and account scope", () => {
		const binding = bind("read-target-bid", "synthetic-bid-reader");
		expect(binding).toMatchObject({
			semantic: "read-target-bid",
			toolName: "synthetic-bid-reader",
			accountScope: scope,
			adapterVersion: "test-v1",
			provenance: "trusted-host-binding",
		});
		expect(binding.descriptorDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(binding.bindingDigest).toMatch(/^[a-f0-9]{64}$/);
	});

	it("binds negative-exact existence semantics to a different exact read candidate", () => {
		const binding = bind("read-negative-exact-existence", "synthetic-negative-reader");
		expect(binding.semantic).toBe("read-negative-exact-existence");
		expect(binding.toolName).toBe("synthetic-negative-reader");
	});

	it("verifies an unchanged binding against the current descriptor inventory and exact scope", () => {
		const inventory = inventorySellerAmazonAdsMcpCapabilities(tools());
		const capability = inventory.capabilities[0]!;
		const binding = createSellerAmazonAdsMcpReadBinding(
			{
				semantic: "read-target-bid",
				toolName: capability.name,
				descriptorDigest: capability.descriptorDigest,
				accountScope: scope,
			},
			inventory,
		);
		const verified = verifySellerAmazonAdsMcpReadBinding(binding, inventory, scope);
		expect(verified).toEqual(binding);
		verified.accountScope.profileId = "caller-mutation";
		expect(binding.accountScope.profileId).toBe("9876543210");
	});

	it("fails closed when account scope or tool descriptor drifts", () => {
		const binding = bind("read-target-bid", "synthetic-bid-reader");
		const inventory = inventorySellerAmazonAdsMcpCapabilities(tools());
		expect(() =>
			verifySellerAmazonAdsMcpReadBinding(binding, inventory, { ...scope, profileId: "other-profile" }),
		).toThrow(/scope|profile|account/i);

		const changed = tools();
		changed[0] = {
			...changed[0]!,
			inputSchema: { type: "object", required: ["targetId", "newField"] },
		};
		expect(() =>
			verifySellerAmazonAdsMcpReadBinding(binding, inventorySellerAmazonAdsMcpCapabilities(changed), scope),
		).toThrow(/digest|descriptor|drift|mismatch/i);
	});

	it("rejects mutation/unknown candidates and unsupported semantic capabilities", () => {
		const inventory = inventorySellerAmazonAdsMcpCapabilities(tools());
		for (const name of ["synthetic-mutation", "synthetic-unknown"]) {
			const capability = inventory.capabilities.find((candidate) => candidate.name === name)!;
			expect(() =>
				createSellerAmazonAdsMcpReadBinding(
					{
						semantic: "read-target-bid",
						toolName: name,
						descriptorDigest: capability.descriptorDigest,
						accountScope: scope,
					},
					inventory,
				),
			).toThrow(/read|candidate|mutation|unknown|blocked/i);
		}

		const read = inventory.capabilities[0]!;
		expect(() =>
			createSellerAmazonAdsMcpReadBinding(
				{
					semantic: "delete-campaign" as SellerAmazonAdsMcpSemanticRead,
					toolName: read.name,
					descriptorDigest: read.descriptorDigest,
					accountScope: scope,
				},
				inventory,
			),
		).toThrow(/semantic|unsupported/i);
	});

	it("detects binding tampering including tool-name swaps and blank adapter versions", () => {
		const binding = bind("read-target-bid", "synthetic-bid-reader");
		const inventory = inventorySellerAmazonAdsMcpCapabilities(tools());
		const negative = inventory.capabilities.find((candidate) => candidate.name === "synthetic-negative-reader")!;
		const swapped: SellerAmazonAdsMcpReadBinding = {
			...binding,
			toolName: negative.name,
			descriptorDigest: negative.descriptorDigest,
		};
		expect(() => verifySellerAmazonAdsMcpReadBinding(swapped, inventory, scope)).toThrow(
			/binding|digest|tamper|mismatch/i,
		);

		const read = inventory.capabilities[0]!;
		expect(() =>
			createSellerAmazonAdsMcpReadBinding(
				{
					semantic: "read-target-bid",
					toolName: read.name,
					descriptorDigest: read.descriptorDigest,
					accountScope: scope,
					adapterVersion: "   ",
				},
				inventory,
			),
		).toThrow(/adapter|version/i);
	});
});
