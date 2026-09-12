import { describe, expect, it } from "vitest";
import {
	buildSellerExecutionPlan,
	createSellerApprovalEnvelope,
	decideSellerChangeSet,
	type SellerApprovalEnvelope,
	type SellerChangeProposal,
	type SellerChangeSet,
} from "../src/index.ts";

const SECRET = new TextEncoder().encode("amazon-agent-v1.1-test-secret");

function bidProposal(proposedBid = 0.96): SellerChangeProposal {
	return {
		id: "change:bid",
		sourceActionItemId: "action:bid",
		sourceFindingId: "finding:bid",
		sourceRuleId: "ppc.high-acos.v1",
		operation: "set-bid",
		readiness: "ready",
		entity: { type: "search-term", value: "trail running shoes" },
		context: {
			campaignName: "SP Discovery",
			adGroupName: "Shoes",
			targeting: "running shoes",
			matchType: "BROAD",
		},
		decisionContext: { observedAcos: 0.6, targetAcos: 0.3 },
		rationale: "Observed ACOS is above target.",
		evidence: [{ sourceFile: "search-term.csv", sourceRow: 2 }],
		missingInputs: [],
		before: { campaignId: "1001", adGroupId: "2001", targetId: "3001", currentBid: 1.2 },
		after: { campaignId: "1001", adGroupId: "2001", targetId: "3001", proposedBid },
		humanApprovalRequired: true,
	};
}

function negativeProposal(): SellerChangeProposal {
	return {
		id: "change:negative",
		sourceActionItemId: "action:negative",
		sourceFindingId: "finding:negative",
		sourceRuleId: "ppc.waste-without-sales.v1",
		operation: "add-negative-exact",
		readiness: "ready",
		entity: { type: "search-term", value: "free trail shoes" },
		context: {
			campaignName: "SP Discovery",
			adGroupName: "Shoes",
			targeting: "running shoes",
			matchType: "BROAD",
		},
		decisionContext: null,
		rationale: "Spend without attributed sales.",
		evidence: [{ sourceFile: "search-term.csv", sourceRow: 3 }],
		missingInputs: [],
		before: { campaignId: "1001", adGroupId: "2001" },
		after: { campaignId: "1001", adGroupId: "2001", negativeExact: "free trail shoes" },
		humanApprovalRequired: true,
	};
}

function reviewProposal(): SellerChangeProposal {
	return {
		id: "change:profit-review",
		sourceActionItemId: "action:profit-review",
		sourceFindingId: "finding:profit-review",
		sourceRuleId: "profit.negative-known-contribution.v1",
		operation: "review-profitability",
		readiness: "review-only",
		entity: { type: "asin", value: "B0EXAMPLE" },
		context: null,
		decisionContext: null,
		rationale: "Known contribution is negative.",
		evidence: [{ sourceFile: "profit.csv", sourceRow: 2 }],
		missingInputs: [],
		before: null,
		after: null,
		humanApprovalRequired: true,
	};
}

function approvedEnvelope(proposals: SellerChangeProposal[]): SellerApprovalEnvelope {
	const awaiting: SellerChangeSet = {
		id: "changeset:v1.1",
		version: 7,
		status: "awaiting-approval",
		sourceActionItemIds: proposals.map((proposal) => proposal.sourceActionItemId),
		proposals,
		decision: null,
	};
	const approved = decideSellerChangeSet(awaiting, {
		decision: "approve",
		actor: "seller-owner",
		decidedAt: "2026-09-13T01:00:00.000Z",
		provenance: "host-ui-confirmation",
	});
	return createSellerApprovalEnvelope(approved, SECRET);
}

describe("Amazon Seller Agent V1.1 execution plan", () => {
	it("compiles a signed approval envelope into deterministic executable operations", () => {
		const envelope = approvedEnvelope([bidProposal(), negativeProposal(), reviewProposal()]);
		const first = buildSellerExecutionPlan(envelope, SECRET, { expectedVersion: 8 });
		const second = buildSellerExecutionPlan(envelope, SECRET, { expectedVersion: 8 });

		expect(first).toEqual(second);
		expect(first.sourceChangeSetId).toBe("changeset:v1.1");
		expect(first.sourceChangeSetVersion).toBe(8);
		expect(first.approval.actor).toBe("seller-owner");
		expect(first.approval.contentDigest).toBe(envelope.proof.contentDigest);
		expect(first.operations).toEqual([
			expect.objectContaining({
				proposalId: "change:bid",
				operation: "set-bid",
				targetId: "3001",
				before: { bid: 1.2 },
				after: { bid: 0.96 },
				preconditions: { expectedCurrentBid: 1.2 },
				idempotencyKey: expect.stringMatching(/^execop:/),
			}),
			expect.objectContaining({
				proposalId: "change:negative",
				operation: "add-negative-exact",
				campaignId: "1001",
				adGroupId: "2001",
				negativeExact: "free trail shoes",
				preconditions: { mustNotAlreadyExist: true },
				idempotencyKey: expect.stringMatching(/^execop:/),
			}),
		]);
		expect(first.skippedReviewOnlyProposalIds).toEqual(["change:profit-review"]);
		expect(first.idempotencyKey).toMatch(/^execplan:/);
	});

	it("fails closed when the signed Change Set is tampered after approval", () => {
		const envelope = approvedEnvelope([bidProposal()]);
		const tampered = structuredClone(envelope);
		tampered.changeSet.proposals[0].after = {
			...(tampered.changeSet.proposals[0].after ?? {}),
			proposedBid: 0.5,
		};
		expect(() => buildSellerExecutionPlan(tampered, SECRET)).toThrow(/digest|signature|tamper/i);
	});

	it("changes deterministic keys when the separately approved mutation content changes", () => {
		const original = buildSellerExecutionPlan(approvedEnvelope([bidProposal(0.96)]), SECRET);
		const changed = buildSellerExecutionPlan(approvedEnvelope([bidProposal(0.9)]), SECRET);
		expect(changed.idempotencyKey).not.toBe(original.idempotencyKey);
		expect(changed.operations[0].idempotencyKey).not.toBe(original.operations[0].idempotencyKey);
	});

	it("rejects unsupported ready mutations instead of silently omitting them", () => {
		const unsupported = {
			...bidProposal(),
			id: "change:scale",
			operation: "scale",
			before: { targetId: "3001", currentBid: 1.2 },
			after: { targetId: "3001", proposedBid: 1.3 },
		} as SellerChangeProposal;
		const envelope = approvedEnvelope([unsupported]);
		expect(() => buildSellerExecutionPlan(envelope, SECRET)).toThrow(/unsupported|scale/i);
	});
});
