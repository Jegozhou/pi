import { describe, expect, it } from "vitest";
import {
	applyBidPolicyToChangeSet,
	buildSellerActionPlan,
	buildSellerChangeSet,
	type Finding,
	type SellerChangeSet,
	simulateBidChange,
} from "../src/index.ts";

function enrichedBidChangeSet(
	overrides: {
		currentBid?: number | null;
		observedAcos?: number | null;
		targetAcos?: number | null;
		status?: SellerChangeSet["status"];
	} = {},
): SellerChangeSet {
	const currentBid = overrides.currentBid === undefined ? 1.2 : overrides.currentBid;
	return {
		id: "changeset:v1:bid-down",
		version: 2,
		status: overrides.status ?? "draft",
		sourceActionItemIds: ["action:bid-down"],
		proposals: [
			{
				id: "change:bid-down",
				sourceActionItemId: "action:bid-down",
				sourceFindingId: "finding:bid-down",
				sourceRuleId: "ppc.high-acos.v1",
				operation: "set-bid",
				readiness: "blocked",
				entity: { type: "search-term", value: "trail running shoes" },
				context: {
					campaignName: "SP Discovery",
					adGroupName: "Shoes",
					targeting: "running shoes",
					matchType: "BROAD",
				},
				decisionContext: {
					observedAcos: overrides.observedAcos === undefined ? 0.6 : overrides.observedAcos,
					targetAcos: overrides.targetAcos === undefined ? 0.3 : overrides.targetAcos,
				},
				rationale: "Observed ACOS is above target.",
				evidence: [{ sourceFile: "search-term.csv", sourceRow: 2 }],
				missingInputs: currentBid === null ? ["current bid", "proposed bid"] : ["proposed bid"],
				before: {
					campaignId: "1001",
					adGroupId: "2001",
					targetId: "3001",
					currentBid,
				},
				after: null,
				humanApprovalRequired: true,
			},
		],
		decision: null,
	};
}

function highAcosFinding(): Finding {
	return {
		id: "finding:high-acos",
		ruleId: "ppc.high-acos.v1",
		category: "bid-down",
		priority: "high",
		confidence: "high",
		entity: { type: "search-term", value: "trail running shoes" },
		context: { campaignName: "SP Discovery", adGroupName: "Shoes", targeting: "running shoes", matchType: "BROAD" },
		metrics: {
			ctr: 0.02,
			cvr: 0.1,
			cpc: 1.2,
			acos: 0.6,
			roas: 1 / 0.6,
			impressions: 1000,
			clicks: 20,
			spend: 24,
			attributedOrders: 2,
			attributedSales: 40,
		},
		evidence: [{ sourceFile: "search-term.csv", sourceRow: 2 }],
		thresholds: { targetAcos: 0.3, highAcosMultiplier: 1.5 },
		rationale: "Observed ACOS exceeds seller target.",
		recommendedAction: { type: "reduce-bid-candidate", summary: "Reduce bid carefully." },
		humanApprovalRequired: true,
	};
}

describe("Amazon V0.8 bid simulator", () => {
	it("calculates the proportional raw bid", () => {
		const result = simulateBidChange({ currentBid: 1.2, observedAcos: 0.6, targetAcos: 0.3 });
		expect(result.rawBid).toBeCloseTo(0.6);
	});

	it("clamps aggressive reductions to the maximum single-step decrease", () => {
		const result = simulateBidChange({ currentBid: 1.2, observedAcos: 0.6, targetAcos: 0.3 });
		expect(result.proposedBid).toBe(0.96);
		expect(result.guardrailApplied).toBe("max-decrease");
		expect(result.percentDelta).toBeCloseTo(-0.2);
	});

	it("honors a seller-provided maximum decrease override", () => {
		const result = simulateBidChange(
			{ currentBid: 1.2, observedAcos: 0.6, targetAcos: 0.3 },
			{ maxDecreaseFraction: 0.1 },
		);
		expect(result.proposedBid).toBe(1.08);
	});

	it("honors the minimum bid floor", () => {
		const result = simulateBidChange(
			{ currentBid: 0.04, observedAcos: 1, targetAcos: 0.1 },
			{ maxDecreaseFraction: 0.9, minimumBid: 0.03 },
		);
		expect(result.proposedBid).toBe(0.03);
		expect(result.guardrailApplied).toBe("minimum-bid");
	});

	it("rounds proposed bids deterministically", () => {
		const result = simulateBidChange(
			{ currentBid: 1.23, observedAcos: 0.4, targetAcos: 0.3 },
			{ maxDecreaseFraction: 0.5, currencyDecimals: 2 },
		);
		expect(result.proposedBid).toBe(0.92);
	});

	it("preserves observed and target ACOS from Finding through Action Plan into Change Set", () => {
		const plan = buildSellerActionPlan({ ppcFindings: [highAcosFinding()], profitabilityFindings: [] });
		const changeSet = buildSellerChangeSet(plan);
		expect(plan.items[0].decisionContext).toEqual({ observedAcos: 0.6, targetAcos: 0.3 });
		expect(changeSet.proposals[0].decisionContext).toEqual({ observedAcos: 0.6, targetAcos: 0.3 });
	});

	it("turns an enriched bid-down proposal into ready with explicit before and after", () => {
		const result = applyBidPolicyToChangeSet(enrichedBidChangeSet());
		const proposal = result.changeSet.proposals[0];
		expect(proposal.readiness).toBe("ready");
		expect(proposal.missingInputs).toEqual([]);
		expect(proposal.before).toMatchObject({ targetId: "3001", currentBid: 1.2 });
		expect(proposal.after).toMatchObject({ targetId: "3001", proposedBid: 0.96 });
		expect(result.diagnostics.readyProposalIds).toEqual([proposal.id]);
	});

	it("keeps the proposal blocked when target ACOS is missing", () => {
		const result = applyBidPolicyToChangeSet(enrichedBidChangeSet({ targetAcos: null }));
		expect(result.changeSet.proposals[0].readiness).toBe("blocked");
		expect(result.changeSet.proposals[0].missingInputs).toContain("target ACOS");
	});

	it("keeps the proposal blocked when observed ACOS is missing", () => {
		const result = applyBidPolicyToChangeSet(enrichedBidChangeSet({ observedAcos: null }));
		expect(result.changeSet.proposals[0].readiness).toBe("blocked");
		expect(result.changeSet.proposals[0].missingInputs).toContain("observed ACOS");
	});

	it("does not create a bid-down mutation when ACOS is at or below target", () => {
		expect(() => simulateBidChange({ currentBid: 1.2, observedAcos: 0.3, targetAcos: 0.3 })).toThrow(/above target/i);
	});

	it("rejects invalid bid policy values", () => {
		expect(() =>
			simulateBidChange({ currentBid: 1.2, observedAcos: 0.6, targetAcos: 0.3 }, { maxDecreaseFraction: 1 }),
		).toThrow(/maxDecreaseFraction/);
	});

	it("is immutable and increments the change set version", () => {
		const source = enrichedBidChangeSet();
		const before = JSON.stringify(source);
		const result = applyBidPolicyToChangeSet(source);
		expect(JSON.stringify(source)).toBe(before);
		expect(result.changeSet.version).toBe(source.version + 1);
	});

	it("rejects simulation after the change set leaves draft", () => {
		expect(() => applyBidPolicyToChangeSet(enrichedBidChangeSet({ status: "awaiting-approval" }))).toThrow(/draft/i);
	});

	it("does not pretend to predict future performance", () => {
		const result = simulateBidChange({ currentBid: 1.2, observedAcos: 0.6, targetAcos: 0.3 });
		const keys = Object.keys(result).join(" ").toLowerCase();
		expect(keys).not.toMatch(/future|projected|predicted|sales|orders|impressions|conversions/);
	});
});
