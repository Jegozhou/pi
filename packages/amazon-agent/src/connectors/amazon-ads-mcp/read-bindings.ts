import { createHash } from "node:crypto";
import {
	assertSellerAmazonAdsAccountScope,
	type SellerAmazonAdsAccountScope,
	sellerAmazonAdsAccountScopeKey,
} from "../../live-execution/account-scope.ts";
import { requireSellerAmazonAdsMcpReadCandidate } from "./capabilities.ts";
import type { SellerAmazonAdsMcpCapabilityInventory } from "./types.ts";

export type SellerAmazonAdsMcpSemanticRead = "read-target-bid" | "read-negative-exact-existence";

export interface SellerAmazonAdsMcpReadBindingInput {
	semantic: SellerAmazonAdsMcpSemanticRead;
	toolName: string;
	descriptorDigest: string;
	accountScope: SellerAmazonAdsAccountScope;
	adapterVersion?: string;
}

export interface SellerAmazonAdsMcpReadBinding {
	semantic: SellerAmazonAdsMcpSemanticRead;
	toolName: string;
	descriptorDigest: string;
	accountScope: SellerAmazonAdsAccountScope;
	adapterVersion: string | null;
	provenance: "trusted-host-binding";
	bindingDigest: string;
}

interface SellerAmazonAdsMcpReadBindingContent {
	semantic: SellerAmazonAdsMcpSemanticRead;
	toolName: string;
	descriptorDigest: string;
	accountScope: SellerAmazonAdsAccountScope;
	adapterVersion: string | null;
	provenance: "trusted-host-binding";
}

function assertSemantic(value: unknown): asserts value is SellerAmazonAdsMcpSemanticRead {
	if (value !== "read-target-bid" && value !== "read-negative-exact-existence") {
		throw new Error(`Unsupported Amazon Ads MCP semantic read capability: ${String(value)}`);
	}
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value.trim();
}

function normalizeAdapterVersion(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	return requiredString(value, "Amazon Ads MCP adapter version");
}

function normalizeAccountScope(scope: SellerAmazonAdsAccountScope): SellerAmazonAdsAccountScope {
	assertSellerAmazonAdsAccountScope(scope);
	return {
		profileId: scope.profileId,
		marketplaceId: scope.marketplaceId,
		region: scope.region,
	};
}

function bindingContent(input: SellerAmazonAdsMcpReadBindingInput): SellerAmazonAdsMcpReadBindingContent {
	assertSemantic(input.semantic);
	return {
		semantic: input.semantic,
		toolName: requiredString(input.toolName, "Amazon Ads MCP tool name"),
		descriptorDigest: requiredString(input.descriptorDigest, "Amazon Ads MCP descriptor digest"),
		accountScope: normalizeAccountScope(input.accountScope),
		adapterVersion: normalizeAdapterVersion(input.adapterVersion),
		provenance: "trusted-host-binding",
	};
}

function computeBindingDigest(content: SellerAmazonAdsMcpReadBindingContent): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				accountScope: {
					marketplaceId: content.accountScope.marketplaceId,
					profileId: content.accountScope.profileId,
					region: content.accountScope.region,
				},
				adapterVersion: content.adapterVersion,
				descriptorDigest: content.descriptorDigest,
				provenance: content.provenance,
				semantic: content.semantic,
				toolName: content.toolName,
			}),
		)
		.digest("hex");
}

function contentFromBinding(binding: SellerAmazonAdsMcpReadBinding): SellerAmazonAdsMcpReadBindingContent {
	if (!binding || typeof binding !== "object") {
		throw new Error("Amazon Ads MCP read binding is required");
	}
	if (binding.provenance !== "trusted-host-binding") {
		throw new Error("Amazon Ads MCP read binding requires trusted-host-binding provenance");
	}
	return bindingContent({
		semantic: binding.semantic,
		toolName: binding.toolName,
		descriptorDigest: binding.descriptorDigest,
		accountScope: binding.accountScope,
		...(binding.adapterVersion !== null ? { adapterVersion: binding.adapterVersion } : {}),
	});
}

export function createSellerAmazonAdsMcpReadBinding(
	input: SellerAmazonAdsMcpReadBindingInput,
	inventory: SellerAmazonAdsMcpCapabilityInventory,
): SellerAmazonAdsMcpReadBinding {
	const content = bindingContent(input);
	requireSellerAmazonAdsMcpReadCandidate(inventory, content.toolName, content.descriptorDigest);
	return {
		...structuredClone(content),
		bindingDigest: computeBindingDigest(content),
	};
}

export function verifySellerAmazonAdsMcpReadBinding(
	binding: SellerAmazonAdsMcpReadBinding,
	inventory: SellerAmazonAdsMcpCapabilityInventory,
	expectedAccountScope: SellerAmazonAdsAccountScope,
): SellerAmazonAdsMcpReadBinding {
	const content = contentFromBinding(binding);
	const expectedScope = normalizeAccountScope(expectedAccountScope);
	if (sellerAmazonAdsAccountScopeKey(content.accountScope) !== sellerAmazonAdsAccountScopeKey(expectedScope)) {
		throw new Error("Amazon Ads MCP read binding account scope mismatch");
	}
	const expectedBindingDigest = computeBindingDigest(content);
	if (binding.bindingDigest !== expectedBindingDigest) {
		throw new Error("Amazon Ads MCP read binding digest mismatch; binding may have been tampered with");
	}
	requireSellerAmazonAdsMcpReadCandidate(inventory, content.toolName, content.descriptorDigest);
	return structuredClone(binding);
}
