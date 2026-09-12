import { describe, expect, it } from "vitest";
import { normalizeSellerAmazonAdsMcpSessionContext, type SellerAmazonAdsMcpSessionContext } from "../src/index.ts";

function session(): SellerAmazonAdsMcpSessionContext {
	return {
		authenticated: true,
		profileId: "9876543210",
		marketplaceId: "ATVPDKIKX0DER",
		region: "NA",
		principalId: "partner-user-42",
	};
}

describe("Amazon Seller Agent V1.3 Amazon Ads MCP session boundary", () => {
	it("normalizes one authenticated MCP session into one exact Amazon Ads account scope", () => {
		const source = session();
		const normalized = normalizeSellerAmazonAdsMcpSessionContext(source);

		expect(normalized).toEqual({
			authenticated: true,
			accountScope: {
				profileId: "9876543210",
				marketplaceId: "ATVPDKIKX0DER",
				region: "NA",
			},
			principalId: "partner-user-42",
			provenance: "amazon-ads-mcp-host",
		});

		normalized.accountScope.profileId = "changed-by-caller";
		expect(source.profileId).toBe("9876543210");
	});

	it("rejects a session that is not explicitly authenticated", () => {
		for (const authenticated of [false, undefined, "true"] as unknown[]) {
			expect(() =>
				normalizeSellerAmazonAdsMcpSessionContext({
					...session(),
					authenticated,
				}),
			).toThrow(/authenticated|session/i);
		}
	});

	it("rejects blank account identifiers and unsupported regions", () => {
		for (const invalid of [
			{ ...session(), profileId: "" },
			{ ...session(), marketplaceId: "   " },
			{ ...session(), region: "APAC" },
		]) {
			expect(() => normalizeSellerAmazonAdsMcpSessionContext(invalid)).toThrow(/profile|marketplace|region|scope/i);
		}
	});

	it("rejects secret-shaped fields instead of copying credentials into domain context", () => {
		for (const sensitive of [
			{ ...session(), accessToken: "secret-access-token" },
			{ ...session(), refreshToken: "secret-refresh-token" },
			{ ...session(), clientSecret: "secret-client" },
			{ ...session(), authorization: "Bearer secret" },
			{ ...session(), credentials: { refreshToken: "nested-secret" } },
			{ ...session(), oauthAccessToken: "prefixed-secret-access-token" },
			{ ...session(), amazonRefreshToken: "prefixed-secret-refresh-token" },
			{ ...session(), lwaClientSecret: "prefixed-client-secret" },
			{ ...session(), connector: { sessionToken: "nested-session-token" } },
		]) {
			expect(() => normalizeSellerAmazonAdsMcpSessionContext(sensitive)).toThrow(
				/secret|credential|token|authorization/i,
			);
		}
	});

	it("rejects blank principal identity but allows it to be omitted", () => {
		expect(
			normalizeSellerAmazonAdsMcpSessionContext({ ...session(), principalId: undefined }).principalId,
		).toBeNull();
		expect(() => normalizeSellerAmazonAdsMcpSessionContext({ ...session(), principalId: "   " })).toThrow(
			/principal|identity/i,
		);
	});
});
