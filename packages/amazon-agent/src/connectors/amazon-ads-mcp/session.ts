import {
	assertSellerAmazonAdsAccountScope,
	type SellerAmazonAdsAccountScope,
	type SellerAmazonAdsRegion,
} from "../../live-execution/account-scope.ts";
import type { SellerAmazonAdsMcpNormalizedSession } from "./types.ts";

const SENSITIVE_KEYS = new Set([
	"accesstoken",
	"refreshtoken",
	"clientsecret",
	"authorization",
	"credential",
	"credentials",
	"password",
	"secret",
	"apikey",
	"bearer",
]);

function normalizedKey(key: string): string {
	return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function assertNoSensitiveFields(value: unknown, path = "session"): void {
	if (Array.isArray(value)) {
		for (const [index, entry] of value.entries()) {
			assertNoSensitiveFields(entry, `${path}[${index}]`);
		}
		return;
	}
	if (value === null || typeof value !== "object") return;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (SENSITIVE_KEYS.has(normalizedKey(key))) {
			throw new Error(`Amazon Ads MCP session contains sensitive credential field at ${path}.${key}`);
		}
		assertNoSensitiveFields(child, `${path}.${key}`);
	}
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Amazon Ads MCP session requires a non-empty ${label}`);
	}
	return value.trim();
}

function region(value: unknown): SellerAmazonAdsRegion {
	if (value !== "NA" && value !== "EU" && value !== "FE") {
		throw new Error(`Unsupported Amazon Ads MCP session region: ${String(value)}`);
	}
	return value;
}

export function normalizeSellerAmazonAdsMcpSessionContext(input: unknown): SellerAmazonAdsMcpNormalizedSession {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Amazon Ads MCP authenticated session context is required");
	}
	assertNoSensitiveFields(input);
	const source = input as Record<string, unknown>;
	if (source.authenticated !== true) {
		throw new Error("Amazon Ads MCP session must be explicitly authenticated by the trusted host");
	}

	const accountScope: SellerAmazonAdsAccountScope = {
		profileId: requiredString(source.profileId, "profileId"),
		marketplaceId: requiredString(source.marketplaceId, "marketplaceId"),
		region: region(source.region),
	};
	assertSellerAmazonAdsAccountScope(accountScope);

	let principalId: string | null = null;
	if (source.principalId !== undefined) {
		principalId = requiredString(source.principalId, "principal identity");
	}

	return {
		authenticated: true,
		accountScope: structuredClone(accountScope),
		principalId,
		provenance: "amazon-ads-mcp-host",
	};
}
