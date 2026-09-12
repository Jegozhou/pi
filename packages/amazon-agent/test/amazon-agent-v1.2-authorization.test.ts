import { describe, expect, it } from "vitest";
import {
	createSellerExecutionAuthorizationEnvelope,
	type SellerAmazonAdsAccountScope,
	type SellerExecutionPlan,
	verifySellerExecutionAuthorizationEnvelope,
} from "../src/index.ts";

const SECRET = new TextEncoder().encode("amazon-agent-v1.2-authorization-secret");

function plan(): SellerExecutionPlan {
	return {
		id: "execplan:abc123",
		sourceChangeSetId: "changeset:v1.2",
		sourceChangeSetVersion: 4,
		approval: {
			actor: "seller-owner",
			decidedAt: "2026-09-13T03:00:00.000Z",
			contentDigest: "digest-approved-content",
		},
		idempotencyKey: "execplan:abc123",
		operations: [
			{
				proposalId: "change:bid",
				operation: "set-bid",
				targetId: "3001",
				before: { bid: 1.2 },
				after: { bid: 0.96 },
				preconditions: { expectedCurrentBid: 1.2 },
				idempotencyKey: "execop:bid",
			},
		],
		skippedReviewOnlyProposalIds: [],
	};
}

function scope(): SellerAmazonAdsAccountScope {
	return {
		profileId: "9876543210",
		marketplaceId: "ATVPDKIKX0DER",
		region: "NA",
	};
}

function createEnvelope() {
	return createSellerExecutionAuthorizationEnvelope(plan(), scope(), SECRET, {
		issuedAt: "2026-09-13T03:05:00.000Z",
		expiresAt: "2026-09-13T03:15:00.000Z",
		nonce: "nonce-v1.2-001",
	});
}

describe("Amazon Seller Agent V1.2 execution authorization", () => {
	it("binds one exact execution plan to one exact Amazon Ads account scope", () => {
		const envelope = createEnvelope();
		const verified = verifySellerExecutionAuthorizationEnvelope(envelope, plan(), SECRET, {
			now: "2026-09-13T03:10:00.000Z",
		});

		expect(verified).toMatchObject({
			planId: "execplan:abc123",
			planIdempotencyKey: "execplan:abc123",
			sourceChangeSetId: "changeset:v1.2",
			sourceChangeSetVersion: 4,
			approvedContentDigest: "digest-approved-content",
			accountScope: scope(),
			issuedAt: "2026-09-13T03:05:00.000Z",
			expiresAt: "2026-09-13T03:15:00.000Z",
			nonce: "nonce-v1.2-001",
			provenance: "trusted-host",
		});
		expect(envelope.proof.algorithm).toBe("hmac-sha256");
	});

	it("is deterministic for the same plan, scope, validity window, nonce, and secret", () => {
		expect(createEnvelope()).toEqual(createEnvelope());
	});

	it("rejects account-scope tampering", () => {
		const envelope = createEnvelope();
		const tampered = structuredClone(envelope);
		tampered.authorization.accountScope.profileId = "1111111111";
		expect(() =>
			verifySellerExecutionAuthorizationEnvelope(tampered, plan(), SECRET, {
				now: "2026-09-13T03:10:00.000Z",
			}),
		).toThrow(/signature|digest|tamper/i);
	});

	it("rejects mutated operation content even when plan identity fields are preserved", () => {
		const envelope = createEnvelope();
		const tamperedPlan = structuredClone(plan());
		const operation = tamperedPlan.operations[0];
		if (!operation || operation.operation !== "set-bid") throw new Error("expected set-bid operation");
		operation.after.bid = 0.5;

		expect(() =>
			verifySellerExecutionAuthorizationEnvelope(envelope, tamperedPlan, SECRET, {
				now: "2026-09-13T03:10:00.000Z",
			}),
		).toThrow(/plan.*content|content.*plan|digest|mismatch/i);
	});

	it("rejects a different execution plan even when the envelope itself is valid", () => {
		const envelope = createEnvelope();
		const different = structuredClone(plan());
		different.id = "execplan:different";
		different.idempotencyKey = "execplan:different";
		expect(() =>
			verifySellerExecutionAuthorizationEnvelope(envelope, different, SECRET, {
				now: "2026-09-13T03:10:00.000Z",
			}),
		).toThrow(/plan|identity|mismatch/i);
	});

	it("rejects an expired authorization and a not-yet-valid authorization", () => {
		const envelope = createEnvelope();
		expect(() =>
			verifySellerExecutionAuthorizationEnvelope(envelope, plan(), SECRET, {
				now: "2026-09-13T03:16:00.000Z",
			}),
		).toThrow(/expired/i);
		expect(() =>
			verifySellerExecutionAuthorizationEnvelope(envelope, plan(), SECRET, {
				now: "2026-09-13T03:04:59.000Z",
			}),
		).toThrow(/not yet|issued/i);
	});

	it("rejects invalid validity windows and blank trusted identifiers", () => {
		expect(() =>
			createSellerExecutionAuthorizationEnvelope(plan(), scope(), SECRET, {
				issuedAt: "2026-09-13T03:15:00.000Z",
				expiresAt: "2026-09-13T03:05:00.000Z",
				nonce: "nonce-v1.2-bad-window",
			}),
		).toThrow(/expires|window|after/i);

		for (const badScope of [
			{ ...scope(), profileId: "" },
			{ ...scope(), marketplaceId: "   " },
		]) {
			expect(() =>
				createSellerExecutionAuthorizationEnvelope(plan(), badScope, SECRET, {
					issuedAt: "2026-09-13T03:05:00.000Z",
					expiresAt: "2026-09-13T03:15:00.000Z",
					nonce: "nonce-v1.2-invalid-scope",
				}),
			).toThrow(/scope|profile|marketplace|identifier/i);
		}
	});

	it("rejects an empty nonce and malformed timestamps", () => {
		expect(() =>
			createSellerExecutionAuthorizationEnvelope(plan(), scope(), SECRET, {
				issuedAt: "not-a-time",
				expiresAt: "2026-09-13T03:15:00.000Z",
				nonce: "nonce-v1.2-time",
			}),
		).toThrow(/timestamp|time|date/i);
		expect(() =>
			createSellerExecutionAuthorizationEnvelope(plan(), scope(), SECRET, {
				issuedAt: "2026-09-13T03:05:00.000Z",
				expiresAt: "2026-09-13T03:15:00.000Z",
				nonce: "",
			}),
		).toThrow(/nonce/i);
	});
});
