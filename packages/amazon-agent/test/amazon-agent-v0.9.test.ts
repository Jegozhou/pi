import { describe, expect, it } from "vitest";
import {
	buildSellerExecutionDryRun,
	computeSellerChangeSetContentDigest,
	type SellerChangeProposal,
	type SellerChangeSet,
} from "../src/index.ts";

function bidProposal(overrides: Partial<SellerChangeProposal> = {}): SellerChangeProposal {
	return {
		id: "change:bid-down",
		sourceActionItemId: "action:bid-down",
		sourceFindingId: "finding:bid-down",
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
		before: {
			campaignId: "1001",
			adGroupId: "2001",
			targetId: "3001",
			currentBid: 1.2,
		},
		after: {
			campaignId: "1001",
			adGroupId: "2001",
			targetId: "3001",
			proposedBid: 0.96,
		},
		humanApprovalRequired: true,
		...overrides,
	};
}

function negativeProposal(overrides: Partial<SellerChangeProposal> = {}): SellerChangeProposal {
	return {
		id: "change:negative",
		sourceActionItemId: "action:negative",
		sourceFindingId: "finding:negative",
		sourceRuleId: "ppc.waste-without-sales.v1",
		operation: "add-negative-exact",
		readiness: "ready",
		entity: { type: "search-term", value: "free trail shoes" },
		rationale: "Spend accumulated without attributed sales.",
		evidence: [{ sourceFile: "search-term.csv", sourceRow: 3 }],
		missingInputs: [],
		before: {
			campaignId: "1001",
			adGroupId: "2001",
			searchTerm: "free trail shoes",
		},
		after: {
			campaignId: "1001",
			adGroupId: "2001",
			negativeExact: "free trail shoes",
		},
		humanApprovalRequired: true,
		...overrides,
	};
}

function approvedChangeSet(overrides: Partial<SellerChangeSet> = {}): SellerChangeSet {
	const result: SellerChangeSet = {
		id: "changeset:v1:approved",
		version: 4,
		status: "approved",
		sourceActionItemIds: ["action:bid-down"],
		proposals: [bidProposal()],
		decision: {
			outcome: "approved",
			actor: "seller-owner",
			decidedAt: "2026-09-13T00:00:00.000Z",
			provenance: "trusted-caller",
		},
		...overrides,
	};
	if (result.status === "approved" && result.decision?.outcome === "approved") {
		result.decision.contentDigest = computeSellerChangeSetContentDigest(result);
	}
	return result;
}

describe("Amazon V0.9 execution dry run", () => {
	it("builds a dry-run set-bid operation from an approved Change Set", () => {
		const result = buildSellerExecutionDryRun(approvedChangeSet(), { expectedVersion: 4 });
		expect(result).toMatchObject({
			mode: "dry-run",
			sourceChangeSetId: "changeset:v1:approved",
			sourceChangeSetVersion: 4,
			approvedBy: "seller-owner",
			approvedAt: "2026-09-13T00:00:00.000Z",
			writesPerformed: false,
		});
		expect(result.operations[0]).toMatchObject({
			proposalId: "change:bid-down",
			operation: "set-bid",
			targetId: "3001",
			before: { bid: 1.2 },
			after: { bid: 0.96 },
		});
	});

	it("builds a dry-run add-negative-exact operation", () => {
		const changeSet = approvedChangeSet({
			sourceActionItemIds: ["action:negative"],
			proposals: [negativeProposal()],
		});
		const result = buildSellerExecutionDryRun(changeSet);
		expect(result.operations[0]).toMatchObject({
			proposalId: "change:negative",
			operation: "add-negative-exact",
			campaignId: "1001",
			adGroupId: "2001",
			negativeExact: "free trail shoes",
		});
	});

	it.each(["draft", "awaiting-approval", "rejected"] as const)("rejects %s Change Sets", (status) => {
		const changeSet = approvedChangeSet({
			status,
			decision:
				status === "rejected"
					? { outcome: "rejected", actor: "seller-owner", decidedAt: "2026-09-13T00:00:00.000Z" }
					: null,
		});
		expect(() => buildSellerExecutionDryRun(changeSet)).toThrow(/approved/i);
	});

	it("rejects approved status without an approved decision", () => {
		expect(() => buildSellerExecutionDryRun(approvedChangeSet({ decision: null }))).toThrow(/decision/i);
	});

	it("rejects a stale expected version", () => {
		expect(() => buildSellerExecutionDryRun(approvedChangeSet(), { expectedVersion: 3 })).toThrow(/version/i);
	});

	it("rejects any blocked mutating proposal instead of silently skipping it", () => {
		const blocked = bidProposal({ readiness: "blocked", missingInputs: ["proposed bid"], after: null });
		expect(() => buildSellerExecutionDryRun(approvedChangeSet({ proposals: [blocked] }))).toThrow(/blocked/i);
	});

	it("rejects incomplete bid before/after data", () => {
		const incomplete = bidProposal({ after: { targetId: "3001" } });
		expect(() => buildSellerExecutionDryRun(approvedChangeSet({ proposals: [incomplete] }))).toThrow(/proposed bid/i);
	});

	it("rejects unsupported ready mutations instead of ignoring them", () => {
		const unsupported = bidProposal({ operation: "scale" });
		expect(() => buildSellerExecutionDryRun(approvedChangeSet({ proposals: [unsupported] }))).toThrow(/unsupported/i);
	});

	it("skips review-only analytical proposals but records their ids", () => {
		const reviewOnly: SellerChangeProposal = {
			...bidProposal(),
			id: "change:profit-review",
			operation: "review-profitability",
			readiness: "review-only",
			entity: { type: "asin", value: "B000TEST" },
			before: null,
			after: null,
			missingInputs: [],
		};
		const result = buildSellerExecutionDryRun(approvedChangeSet({ proposals: [bidProposal(), reviewOnly] }));
		expect(result.operations).toHaveLength(1);
		expect(result.skippedReviewOnlyProposalIds).toEqual(["change:profit-review"]);
	});

	it("preserves proposal order for auditability", () => {
		const result = buildSellerExecutionDryRun(
			approvedChangeSet({
				sourceActionItemIds: ["action:negative", "action:bid-down"],
				proposals: [negativeProposal(), bidProposal()],
			}),
		);
		expect(result.operations.map((operation) => operation.proposalId)).toEqual(["change:negative", "change:bid-down"]);
	});

	it("does not mutate the approved Change Set", () => {
		const source = approvedChangeSet();
		const before = JSON.stringify(source);
		buildSellerExecutionDryRun(source);
		expect(JSON.stringify(source)).toBe(before);
	});

	it("never reports execution success or writes", () => {
		const result = buildSellerExecutionDryRun(approvedChangeSet());
		expect(result.writesPerformed).toBe(false);
		const keys = JSON.stringify(result).toLowerCase();
		expect(keys).not.toMatch(/"executed"|"applied"|"success"/);
	});
});
