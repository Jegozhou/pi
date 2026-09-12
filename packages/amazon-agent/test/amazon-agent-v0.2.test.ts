import { describe, expect, it } from "vitest";
import {
	diagnosePpc,
	type NormalizedAdvertisingRow,
	type PpcPolicy,
} from "../../amazon-agent/src/index.ts";

const policy: PpcPolicy = {
	targetAcos: 0.3,
	minimumClicksNoSale: 10,
	minimumSpendNoSale: 20,
	minimumOrdersScale: 3,
	highAcosMultiplier: 1.5,
	lowAcosScaleMargin: 0.25,
};

function row(overrides: Partial<NormalizedAdvertisingRow> = {}): NormalizedAdvertisingRow {
	return {
		campaignName: "Discovery",
		adGroupName: "AG 1",
		targeting: "running shoes",
		matchType: "BROAD",
		customerSearchTerm: "trail running shoes",
		impressions: 1000,
		clicks: 20,
		spend: 30,
		attributedOrders: 0,
		attributedUnits: 0,
		attributedSales: 0,
		currency: "USD",
		sourceFile: "search-term.csv",
		sourceRow: 2,
		...overrides,
	};
}

describe("Amazon PPC deterministic diagnosis", () => {
	it("flags a zero-sales search term after enough click or spend evidence", () => {
		const findings = diagnosePpc([row()], policy);
		const waste = findings.find((finding) => finding.ruleId === "ppc.waste-without-sales.v1");

		expect(waste).toMatchObject({
			category: "waste",
			priority: "high",
			entity: { type: "search-term", value: "trail running shoes" },
			recommendedAction: { type: "negative-exact-candidate" },
			humanApprovalRequired: true,
			thresholds: {
				minimumClicksNoSale: 10,
				minimumSpendNoSale: 20,
			},
			evidence: [{ sourceFile: "search-term.csv", sourceRow: 2 }],
		});
	});

	it("does not flag zero-sales rows below both evidence thresholds", () => {
		const findings = diagnosePpc([row({ clicks: 4, spend: 5 })], policy);
		expect(findings.some((finding) => finding.ruleId === "ppc.waste-without-sales.v1")).toBe(false);
	});

	it("does not treat missing sales as zero sales", () => {
		const findings = diagnosePpc([row({ attributedSales: null })], policy);
		expect(findings.some((finding) => finding.ruleId === "ppc.waste-without-sales.v1")).toBe(false);
	});

	it("flags materially high ACOS only with conversion evidence", () => {
		const findings = diagnosePpc([
			row({ spend: 60, attributedSales: 100, attributedOrders: 2 }),
		], policy);
		const finding = findings.find((item) => item.ruleId === "ppc.high-acos.v1");

		expect(finding).toMatchObject({
			category: "bid-down",
			recommendedAction: { type: "reduce-bid-candidate" },
			metrics: { acos: 0.6 },
			thresholds: { targetAcos: 0.3, highAcosMultiplier: 1.5 },
		});
	});

	it("does not use the high-ACOS rule when there are no attributed orders", () => {
		const findings = diagnosePpc([
			row({ spend: 60, attributedSales: 100, attributedOrders: 0 }),
		], policy);
		expect(findings.some((finding) => finding.ruleId === "ppc.high-acos.v1")).toBe(false);
	});

	it("creates an exact-migration candidate for an efficient discovery term", () => {
		const findings = diagnosePpc([
			row({ spend: 20, attributedSales: 100, attributedOrders: 4, matchType: "BROAD" }),
		], policy);
		const finding = findings.find((item) => item.ruleId === "ppc.efficient-search-term.v1");

		expect(finding).toMatchObject({
			category: "migration",
			recommendedAction: { type: "exact-target-candidate" },
			thresholds: { targetAcos: 0.3, minimumOrdersScale: 3 },
		});
	});

	it("does not recommend exact migration when discovery context is unknown or exact", () => {
		for (const matchType of [null, "EXACT"] as const) {
			const findings = diagnosePpc([
				row({ spend: 20, attributedSales: 100, attributedOrders: 4, matchType }),
			], policy);
			expect(findings.some((finding) => finding.ruleId === "ppc.efficient-search-term.v1")).toBe(false);
		}
	});

	it("creates a scale candidate only when ACOS is sufficiently below the seller target", () => {
		const findings = diagnosePpc([
			row({ spend: 20, attributedSales: 100, attributedOrders: 4 }),
		], policy);
		const finding = findings.find((item) => item.ruleId === "ppc.scale-efficient-target.v1");

		expect(finding).toMatchObject({
			category: "scale",
			recommendedAction: { type: "scale-candidate" },
			thresholds: { targetAcos: 0.3, lowAcosScaleMargin: 0.25 },
		});
	});

	it("suppresses target-dependent rules when the seller has no target ACOS", () => {
		const findings = diagnosePpc(
			[row({ spend: 20, attributedSales: 100, attributedOrders: 4 })],
			{ ...policy, targetAcos: null },
		);
		expect(findings.map((finding) => finding.ruleId)).toEqual([]);
	});

	it("returns findings in a deterministic priority and source order", () => {
		const findings = diagnosePpc(
			[
				row({ sourceRow: 9, customerSearchTerm: "later", spend: 30, attributedSales: 0 }),
				row({ sourceRow: 3, customerSearchTerm: "earlier", spend: 30, attributedSales: 0 }),
			],
			policy,
		);

		expect(findings.map((finding) => `${finding.priority}:${finding.entity.value}`)).toEqual([
			"high:earlier",
			"high:later",
		]);
	});
});
