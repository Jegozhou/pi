import { describe, expect, it } from "vitest";
import {
	buildSellerChangeSet,
	decideSellerChangeSet,
	requestSellerChangeSetApproval,
	type Finding,
	type ProfitabilityFinding,
	type SellerActionPlan,
	type SellerChangeSet,
} from "../src/index.ts";

function ppcFinding(): Finding {
	return {
		id: "ppc.high-acos.v1:ads.csv:7:trail shoes",
		ruleId: "ppc.high-acos.v1",
		category: "bid-down",
		priority: "high",
		confidence: "high",
		entity: { type: "search-term", value: "trail shoes" },
		metrics: {
			ctr: 0.02,
			cvr: 0.1,
			cpc: 1.5,
			acos: 0.6,
			roas: 1.6666666666666667,
			impressions: 1000,
			clicks: 20,
			spend: 30,
			attributedOrders: 2,
			attributedSales: 50,
		},
		evidence: [{ sourceFile: "ads.csv", sourceRow: 7 }],
		thresholds: { targetAcos: 0.3, highAcosMultiplier: 1.5 },
		rationale: "ACOS is materially above the seller target.",
		recommendedAction: { type: "reduce-bid-candidate", summary: "Review a bid reduction." },
		humanApprovalRequired: true,
	};
}

function profitFinding(): ProfitabilityFinding {
	return {
		id: "profit.negative-known-contribution.v1:profit.csv:3:B000TEST",
		ruleId: "profit.negative-known-contribution.v1",
		category: "profit-risk",
		priority: "high",
		confidence: "high",
		entity: { type: "asin", value: "B000TEST" },
		metrics: {
			knownCogsTotal: 40,
			knownVariableCost: 120,
			knownContributionProfit: -20,
			knownContributionMargin: -0.2,
			status: "complete",
			missingCostCategories: [],
		},
		dataQuality: "complete",
		evidence: [{ sourceFile: "profit.csv", sourceRow: 3 }],
		thresholds: { requiredContributionMargin: null },
		rationale: "Known supplied costs exceed gross sales.",
		recommendedAction: {
			type: "review-profitability-candidate",
			summary: "Review profitability before changing spend.",
		},
		humanApprovalRequired: true,
	};
}

function actionPlan(): SellerActionPlan {
	return {
		totalFindings: 2,
		returnedItems: 2,
		items: [
			{
				id: "action:ppc:high-acos",
				rank: 1,
				source: "ppc",
				stage: "optimize",
				priority: "high",
				confidence: "high",
				dataQuality: "not-applicable",
				entity: { type: "search-term", value: "trail shoes" },
				rationale: ppcFinding().rationale,
				recommendedAction: ppcFinding().recommendedAction,
				evidence: ppcFinding().evidence,
				sourceFindingId: ppcFinding().id,
				sourceRuleId: ppcFinding().ruleId,
				humanApprovalRequired: true,
			},
			{
				id: "action:profitability:negative",
				rank: 2,
				source: "profitability",
				stage: "stop-loss",
				priority: "high",
				confidence: "high",
				dataQuality: "complete",
				entity: { type: "asin", value: "B000TEST" },
				rationale: profitFinding().rationale,
				recommendedAction: profitFinding().recommendedAction,
				evidence: profitFinding().evidence,
				sourceFindingId: profitFinding().id,
				sourceRuleId: profitFinding().ruleId,
				humanApprovalRequired: true,
			},
		],
	};
}

function readyChangeSet(): SellerChangeSet {
	const draft = buildSellerChangeSet(actionPlan());
	return {
		...draft,
		proposals: draft.proposals.map((proposal) =>
			proposal.sourceActionItemId === "action:ppc:high-acos"
				? {
						...proposal,
						operation: "set-bid" as const,
						readiness: "ready" as const,
						missingInputs: [],
						before: { targetId: "target-123", bid: 1.2, currency: "USD" },
						after: { targetId: "target-123", bid: 0.95, currency: "USD" },
					}
				: proposal,
		),
	};
}

describe("Amazon Seller Agent V0.6 change sets and approval gate", () => {
	it("creates traceable proposals from action-plan items", () => {
		const set = buildSellerChangeSet(actionPlan());
		expect(set.status).toBe("draft");
		expect(set.version).toBe(1);
		expect(set.sourceActionItemIds).toEqual(["action:ppc:high-acos", "action:profitability:negative"]);
		expect(set.proposals[0]).toMatchObject({
			sourceActionItemId: "action:ppc:high-acos",
			sourceFindingId: ppcFinding().id,
			sourceRuleId: ppcFinding().ruleId,
			evidence: [{ sourceFile: "ads.csv", sourceRow: 7 }],
		});
	});

	it("blocks PPC mutations when exact execution inputs are unavailable", () => {
		const set = buildSellerChangeSet(actionPlan());
		const proposal = set.proposals.find((item) => item.sourceActionItemId === "action:ppc:high-acos");
		expect(proposal).toMatchObject({
			operation: "set-bid",
			readiness: "blocked",
			before: null,
			after: null,
		});
		expect(proposal?.missingInputs).toEqual(expect.arrayContaining(["target identity", "current bid", "proposed bid"]));
	});

	it("keeps profitability work review-only instead of inventing an Amazon mutation", () => {
		const set = buildSellerChangeSet(actionPlan());
		const proposal = set.proposals.find((item) => item.sourceActionItemId === "action:profitability:negative");
		expect(proposal).toMatchObject({
			operation: "review-profitability",
			readiness: "review-only",
			before: null,
			after: null,
			missingInputs: [],
		});
	});

	it("refuses an approval request while any mutating proposal is blocked", () => {
		expect(() => requestSellerChangeSetApproval(buildSellerChangeSet(actionPlan()))).toThrow(/blocked/i);
	});

	it("does not allow a review-only change set to masquerade as executable", () => {
		const plan = actionPlan();
		const reviewOnly = buildSellerChangeSet({ ...plan, items: [plan.items[1]], totalFindings: 1, returnedItems: 1 });
		expect(() => requestSellerChangeSetApproval(reviewOnly)).toThrow(/ready mutating proposal/i);
	});

	it("moves a fully specified set to awaiting approval without mutating the input", () => {
		const input = readyChangeSet();
		const result = requestSellerChangeSetApproval(input);
		expect(result.status).toBe("awaiting-approval");
		expect(input.status).toBe("draft");
		expect(result.decision).toBeNull();
	});

	it("records explicit approval but does not mark anything executed", () => {
		const awaiting = requestSellerChangeSetApproval(readyChangeSet());
		const approved = decideSellerChangeSet(awaiting, {
			decision: "approve",
			actor: "seller@example",
			decidedAt: "2026-09-13T00:00:00.000Z",
		});
		expect(approved.status).toBe("approved");
		expect(approved.decision).toMatchObject({
			outcome: "approved",
			actor: "seller@example",
			decidedAt: "2026-09-13T00:00:00.000Z",
			provenance: "trusted-caller",
		});
		expect(approved.decision?.contentDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(approved).not.toHaveProperty("executedAt");
		expect(awaiting.status).toBe("awaiting-approval");
	});

	it("records rejection explicitly", () => {
		const awaiting = requestSellerChangeSetApproval(readyChangeSet());
		const rejected = decideSellerChangeSet(awaiting, {
			decision: "reject",
			actor: "seller@example",
			decidedAt: "2026-09-13T00:00:00.000Z",
		});
		expect(rejected.status).toBe("rejected");
		expect(rejected.decision?.outcome).toBe("rejected");
	});

	it("fails closed on invalid lifecycle transitions", () => {
		expect(() =>
			decideSellerChangeSet(buildSellerChangeSet(actionPlan()), {
				decision: "approve",
				actor: "seller@example",
				decidedAt: "2026-09-13T00:00:00.000Z",
			}),
		).toThrow(/awaiting-approval/i);
	});

	it("validates actor and timestamp and remains deterministic", () => {
		const awaiting = requestSellerChangeSetApproval(readyChangeSet());
		expect(() =>
			decideSellerChangeSet(awaiting, {
				decision: "approve",
				actor: " ",
				decidedAt: "2026-09-13T00:00:00.000Z",
			}),
		).toThrow(/actor/i);
		expect(() =>
			decideSellerChangeSet(awaiting, {
				decision: "approve",
				actor: "seller@example",
				decidedAt: "not-a-date",
			}),
		).toThrow(/timestamp/i);
	});
});
