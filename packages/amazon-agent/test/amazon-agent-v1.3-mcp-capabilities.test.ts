import { describe, expect, it } from "vitest";
import {
	inventorySellerAmazonAdsMcpCapabilities,
	requireSellerAmazonAdsMcpReadCandidate,
	type SellerAmazonAdsMcpToolDescriptor,
} from "../src/index.ts";

function descriptors(): SellerAmazonAdsMcpToolDescriptor[] {
	return [
		{
			name: "catalog-read-a",
			description: "A server-declared read-only capability",
			inputSchema: { type: "object", properties: { id: { type: "string" } } },
			annotations: { readOnlyHint: true },
		},
		{
			name: "catalog-write-b",
			description: "A server-declared mutation capability",
			inputSchema: { type: "object", properties: { bid: { type: "number" } } },
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		{
			name: "catalog-destructive-c",
			description: "A server-declared destructive capability",
			inputSchema: { type: "object" },
			annotations: { destructiveHint: true },
		},
		{
			name: "get_everything_by_name_only",
			description: "Looks like a read by name but supplies no trusted effect annotation",
			inputSchema: { type: "object" },
		},
	];
}

describe("Amazon Seller Agent V1.3 MCP capability firewall", () => {
	it("classifies connector descriptors descriptively without granting execution permission", () => {
		const inventory = inventorySellerAmazonAdsMcpCapabilities(descriptors());
		expect(inventory.capabilities.map(({ name, classification }) => ({ name, classification }))).toEqual([
			{ name: "catalog-read-a", classification: "read-candidate" },
			{ name: "catalog-write-b", classification: "mutation-candidate" },
			{ name: "catalog-destructive-c", classification: "mutation-candidate" },
			{ name: "get_everything_by_name_only", classification: "unknown" },
		]);
	});

	it("does not promote a tool to read-candidate from its name or description", () => {
		const inventory = inventorySellerAmazonAdsMcpCapabilities([
			{
				name: "get_campaign_read_only_safe_fetch_report",
				description: "read only query get list fetch report",
				inputSchema: { type: "object" },
			},
		]);
		expect(inventory.capabilities[0]?.classification).toBe("unknown");
	});

	it("preserves a deterministic descriptor digest and detects descriptor drift", () => {
		const first = inventorySellerAmazonAdsMcpCapabilities(descriptors());
		const changed = descriptors();
		changed[0] = {
			...changed[0]!,
			inputSchema: { type: "object", properties: { id: { type: "integer" } } },
		};
		const second = inventorySellerAmazonAdsMcpCapabilities(changed);

		expect(first.capabilities[0]?.descriptorDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(first.capabilities[0]?.descriptorDigest).not.toBe(second.capabilities[0]?.descriptorDigest);
	});

	it("returns an immutable copy rather than caller-owned descriptor objects", () => {
		const source = descriptors();
		const inventory = inventorySellerAmazonAdsMcpCapabilities(source);
		const first = inventory.capabilities[0];
		if (!first) throw new Error("missing capability");
		first.descriptor.description = "caller mutation";
		expect(source[0]?.description).toBe("A server-declared read-only capability");
	});

	it("allows only an exact read-candidate descriptor through the read firewall", () => {
		const inventory = inventorySellerAmazonAdsMcpCapabilities(descriptors());
		const read = inventory.capabilities[0];
		if (!read) throw new Error("missing read capability");

		expect(requireSellerAmazonAdsMcpReadCandidate(inventory, read.name, read.descriptorDigest)).toMatchObject({
			name: "catalog-read-a",
			classification: "read-candidate",
		});

		for (const blocked of inventory.capabilities.slice(1)) {
			expect(() =>
				requireSellerAmazonAdsMcpReadCandidate(inventory, blocked.name, blocked.descriptorDigest),
			).toThrow(/read|candidate|mutation|unknown|blocked/i);
		}
	});

	it("rejects descriptor-digest mismatch, unknown tool names, and ambiguous duplicate names", () => {
		const inventory = inventorySellerAmazonAdsMcpCapabilities(descriptors());
		const read = inventory.capabilities[0];
		if (!read) throw new Error("missing read capability");
		expect(() => requireSellerAmazonAdsMcpReadCandidate(inventory, read.name, "0".repeat(64))).toThrow(
			/digest|descriptor|drift|mismatch/i,
		);
		expect(() => requireSellerAmazonAdsMcpReadCandidate(inventory, "not-present", read.descriptorDigest)).toThrow(
			/tool|unknown|not found|missing/i,
		);

		expect(() =>
			inventorySellerAmazonAdsMcpCapabilities([
				{ name: "duplicate", annotations: { readOnlyHint: true } },
				{ name: "duplicate", annotations: { readOnlyHint: false } },
			]),
		).toThrow(/duplicate|ambiguous/i);
	});
});
