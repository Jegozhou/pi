import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSellerActionPlan, type Finding, type ProfitabilityFinding } from "../src/index.ts";

function ppcFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		id: "ppc.waste-without-sales.v1:ads.csv:2:trail shoes",
		ruleId: "ppc.waste-without-sales.v1",
		category: "waste",
		priority: "high",
		confidence: "high",
		entity: { type: "search-term", value: "trail shoes" },
		metrics: {
			ctr: 0.02,
			cvr: 0,
			cpc: 1.5,
			acos: null,
			roas: null,
			impressions: 1000,
			clicks: 20,
			spend: 30,
			attributedOrders: 0,
			attributedSales: 0,
		},
		evidence: [{ sourceFile: "ads.csv", sourceRow: 2 }],
		thresholds: { minimumClicksNoSale: 10, minimumSpendNoSale: 20 },
		rationale: "Spend accumulated without attributed sales.",
		recommendedAction: {
			type: "negative-exact-candidate",
			summary: "Review as a negative-exact candidate.",
		},
		humanApprovalRequired: true,
		...overrides,
	};
}

function profitFinding(overrides: Partial<ProfitabilityFinding> = {}): ProfitabilityFinding {
	return {
		id: "profit.negative-known-contribution.v1:profit.csv:3:B000TEST",
		ruleId: "profit.negative-known-contribution.v1",
		category: "profit-risk",
		priority: "high",
		confidence: "high",
		entity: { type: "asin", value: "B000TEST" },
		metrics: {
			knownCogsTotal: null,
			knownVariableCost: 150,
			knownContributionProfit: -50,
			knownContributionMargin: -0.5,
			status: "partial",
			missingCostCategories: ["cogs"],
		},
		dataQuality: "partial",
		evidence: [{ sourceFile: "profit.csv", sourceRow: 3 }],
		thresholds: { requiredContributionMargin: null },
		rationale: "Known supplied costs already exceed gross sales.",
		recommendedAction: {
			type: "review-profitability-candidate",
			summary: "Review profitability before changing spend.",
		},
		humanApprovalRequired: true,
		...overrides,
	};
}

describe("Amazon seller action plan", () => {
	it("ranks known negative contribution ahead of PPC waste", () => {
		const plan = buildSellerActionPlan({
			ppcFindings: [ppcFinding()],
			profitabilityFindings: [profitFinding()],
		});

		expect(plan.items.map((item) => [item.rank, item.source, item.sourceRuleId, item.stage])).toEqual([
			[1, "profitability", "profit.negative-known-contribution.v1", "stop-loss"],
			[2, "ppc", "ppc.waste-without-sales.v1", "stop-loss"],
		]);
	});

	it("orders PPC stop-loss before bid-down, migration, and scale candidates", () => {
		const findings: Finding[] = [
			ppcFinding({
				id: "scale",
				ruleId: "ppc.scale-efficient-target.v1",
				category: "scale",
				priority: "medium",
				recommendedAction: { type: "scale-candidate", summary: "Scale carefully." },
			}),
			ppcFinding({
				id: "migration",
				ruleId: "ppc.efficient-search-term.v1",
				category: "migration",
				priority: "medium",
				recommendedAction: { type: "exact-target-candidate", summary: "Move to exact." },
			}),
			ppcFinding({
				id: "bid-down",
				ruleId: "ppc.high-acos.v1",
				category: "bid-down",
				priority: "high",
				recommendedAction: { type: "reduce-bid-candidate", summary: "Reduce bid carefully." },
			}),
			ppcFinding(),
		];

		const plan = buildSellerActionPlan({ ppcFindings: findings, profitabilityFindings: [] });
		expect(plan.items.map((item) => item.sourceRuleId)).toEqual([
			"ppc.waste-without-sales.v1",
			"ppc.high-acos.v1",
			"ppc.efficient-search-term.v1",
			"ppc.scale-efficient-target.v1",
		]);
	});

	it("preserves partial profitability, evidence, and approval requirements", () => {
		const finding = profitFinding();
		const [item] = buildSellerActionPlan({ ppcFindings: [], profitabilityFindings: [finding] }).items;

		expect(item).toMatchObject({
			dataQuality: "partial",
			evidence: finding.evidence,
			humanApprovalRequired: true,
			sourceFindingId: finding.id,
		});
	});

	it("applies limit after deterministic sorting", () => {
		const plan = buildSellerActionPlan({
			ppcFindings: [ppcFinding()],
			profitabilityFindings: [profitFinding()],
			limit: 1,
		});

		expect(plan.totalFindings).toBe(2);
		expect(plan.returnedItems).toBe(1);
		expect(plan.items[0].source).toBe("profitability");
	});

	it("breaks equal-priority ties by evidence location and finding id", () => {
		const later = ppcFinding({
			id: "later",
			entity: { type: "search-term", value: "later" },
			evidence: [{ sourceFile: "ads.csv", sourceRow: 9 }],
		});
		const earlier = ppcFinding({
			id: "earlier",
			entity: { type: "search-term", value: "earlier" },
			evidence: [{ sourceFile: "ads.csv", sourceRow: 3 }],
		});

		const plan = buildSellerActionPlan({ ppcFindings: [later, earlier], profitabilityFindings: [] });
		expect(plan.items.map((item) => item.entity.value)).toEqual(["earlier", "later"]);
	});

	it("deduplicates repeated source findings", () => {
		const finding = ppcFinding();
		const plan = buildSellerActionPlan({
			ppcFindings: [finding, finding],
			profitabilityFindings: [],
		});
		expect(plan.totalFindings).toBe(1);
		expect(plan.items).toHaveLength(1);
	});

	it("returns an empty plan instead of inventing advice", () => {
		expect(buildSellerActionPlan({ ppcFindings: [], profitabilityFindings: [] })).toEqual({
			totalFindings: 0,
			returnedItems: 0,
			items: [],
		});
	});

	it("ships a model-invokable Amazon seller project skill with valid frontmatter", () => {
		const skill = readFileSync(new URL("../../../.pi/skills/amazon-seller-agent.md", import.meta.url), "utf8");
		expect(skill).toMatch(/^---\nname: amazon-seller-agent\ndescription: .+\n---/);
		expect(skill).not.toContain("disable-model-invocation: true");
		expect(skill).toContain("amazon_build_action_plan");
		expect(skill).toContain("humanApprovalRequired");
	});
});
