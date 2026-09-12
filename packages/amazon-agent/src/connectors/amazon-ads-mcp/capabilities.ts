import { createHash } from "node:crypto";
import type {
	SellerAmazonAdsMcpCapability,
	SellerAmazonAdsMcpCapabilityClassification,
	SellerAmazonAdsMcpCapabilityInventory,
	SellerAmazonAdsMcpToolAnnotations,
	SellerAmazonAdsMcpToolDescriptor,
} from "./types.ts";

function canonicalize(value: unknown, seen = new WeakSet<object>()): unknown {
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new Error("Amazon Ads MCP tool descriptor must not contain cyclic values");
		seen.add(value);
		const result = value.map((entry) => canonicalize(entry, seen));
		seen.delete(value);
		return result;
	}
	if (value !== null && typeof value === "object") {
		if (seen.has(value)) throw new Error("Amazon Ads MCP tool descriptor must not contain cyclic values");
		seen.add(value);
		const source = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(source).sort()) {
			const child = source[key];
			if (child !== undefined) result[key] = canonicalize(child, seen);
		}
		seen.delete(value);
		return result;
	}
	if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
		throw new Error("Amazon Ads MCP tool descriptor must contain JSON-compatible metadata");
	}
	return value;
}

function descriptorDigest(descriptor: SellerAmazonAdsMcpToolDescriptor): string {
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(descriptor)))
		.digest("hex");
}

function assertOptionalBoolean(value: unknown, label: string): void {
	if (value !== undefined && typeof value !== "boolean") {
		throw new Error(`Amazon Ads MCP ${label} must be boolean when provided`);
	}
}

function normalizeAnnotations(value: unknown): SellerAmazonAdsMcpToolAnnotations | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Amazon Ads MCP tool annotations must be an object");
	}
	const source = value as Record<string, unknown>;
	assertOptionalBoolean(source.readOnlyHint, "readOnlyHint");
	assertOptionalBoolean(source.destructiveHint, "destructiveHint");
	return {
		...(source.readOnlyHint !== undefined ? { readOnlyHint: source.readOnlyHint as boolean } : {}),
		...(source.destructiveHint !== undefined ? { destructiveHint: source.destructiveHint as boolean } : {}),
	};
}

function normalizeDescriptor(input: SellerAmazonAdsMcpToolDescriptor): SellerAmazonAdsMcpToolDescriptor {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Amazon Ads MCP tool descriptor is required");
	}
	if (typeof input.name !== "string" || input.name.trim().length === 0) {
		throw new Error("Amazon Ads MCP tool descriptor requires a non-empty name");
	}
	if (input.description !== undefined && typeof input.description !== "string") {
		throw new Error("Amazon Ads MCP tool descriptor description must be a string");
	}
	const descriptor: SellerAmazonAdsMcpToolDescriptor = {
		name: input.name.trim(),
		...(input.description !== undefined ? { description: input.description } : {}),
		...(input.inputSchema !== undefined ? { inputSchema: structuredClone(input.inputSchema) } : {}),
		...(input.annotations !== undefined ? { annotations: normalizeAnnotations(input.annotations) } : {}),
	};
	canonicalize(descriptor);
	return descriptor;
}

function classify(descriptor: SellerAmazonAdsMcpToolDescriptor): SellerAmazonAdsMcpCapabilityClassification {
	const annotations = descriptor.annotations;
	if (annotations?.destructiveHint === true || annotations?.readOnlyHint === false) return "mutation-candidate";
	if (annotations?.readOnlyHint === true && annotations.destructiveHint !== true) return "read-candidate";
	return "unknown";
}

export function inventorySellerAmazonAdsMcpCapabilities(
	descriptors: readonly SellerAmazonAdsMcpToolDescriptor[],
): SellerAmazonAdsMcpCapabilityInventory {
	if (!Array.isArray(descriptors)) throw new Error("Amazon Ads MCP tool descriptors must be an array");
	const names = new Set<string>();
	const capabilities: SellerAmazonAdsMcpCapability[] = [];
	for (const raw of descriptors) {
		const descriptor = normalizeDescriptor(raw);
		if (names.has(descriptor.name)) {
			throw new Error(`Ambiguous duplicate Amazon Ads MCP tool name: ${descriptor.name}`);
		}
		names.add(descriptor.name);
		capabilities.push({
			name: descriptor.name,
			classification: classify(descriptor),
			descriptorDigest: descriptorDigest(descriptor),
			descriptor: structuredClone(descriptor),
		});
	}
	return { capabilities };
}

export function requireSellerAmazonAdsMcpReadCandidate(
	inventory: SellerAmazonAdsMcpCapabilityInventory,
	toolName: string,
	expectedDescriptorDigest: string,
): SellerAmazonAdsMcpCapability {
	if (!inventory || !Array.isArray(inventory.capabilities)) {
		throw new Error("Amazon Ads MCP capability inventory is required");
	}
	const matches = inventory.capabilities.filter((capability) => capability.name === toolName);
	if (matches.length !== 1) {
		throw new Error(`Amazon Ads MCP tool is missing or ambiguous: ${toolName}`);
	}
	const capability = matches[0]!;
	if (capability.descriptorDigest !== expectedDescriptorDigest) {
		throw new Error(`Amazon Ads MCP tool descriptor digest mismatch for ${toolName}`);
	}
	if (capability.classification !== "read-candidate") {
		throw new Error(
			`Amazon Ads MCP tool ${toolName} is ${capability.classification} and is blocked from the read firewall`,
		);
	}
	return structuredClone(capability);
}
