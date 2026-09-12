import type { SellerAmazonAdsAccountScope, SellerAmazonAdsRegion } from "../../live-execution/account-scope.ts";

export interface SellerAmazonAdsMcpSessionContext {
	authenticated: true;
	profileId: string;
	marketplaceId: string;
	region: SellerAmazonAdsRegion;
	principalId?: string;
}

export interface SellerAmazonAdsMcpNormalizedSession {
	authenticated: true;
	accountScope: SellerAmazonAdsAccountScope;
	principalId: string | null;
	provenance: "amazon-ads-mcp-host";
}

export interface SellerAmazonAdsMcpToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
}

export interface SellerAmazonAdsMcpToolDescriptor {
	name: string;
	description?: string;
	inputSchema?: unknown;
	annotations?: SellerAmazonAdsMcpToolAnnotations;
}

export type SellerAmazonAdsMcpCapabilityClassification = "read-candidate" | "mutation-candidate" | "unknown";

export interface SellerAmazonAdsMcpCapability {
	name: string;
	classification: SellerAmazonAdsMcpCapabilityClassification;
	descriptorDigest: string;
	descriptor: SellerAmazonAdsMcpToolDescriptor;
}

export interface SellerAmazonAdsMcpCapabilityInventory {
	capabilities: SellerAmazonAdsMcpCapability[];
}

export interface SellerAmazonAdsMcpReadRequest {
	toolName: string;
	arguments: Record<string, unknown>;
}

export interface SellerAmazonAdsMcpTransport {
	readonly name: string;
	getSessionContext(): Promise<unknown>;
	listTools(): Promise<readonly SellerAmazonAdsMcpToolDescriptor[]>;
	callReadTool(request: SellerAmazonAdsMcpReadRequest): Promise<unknown>;
}
