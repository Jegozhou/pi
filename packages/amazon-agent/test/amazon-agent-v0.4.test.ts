import { describe, expect, it } from "vitest";
import {
	buildProfitDiagnosisResult,
	calculateProfitabilityMetrics,
	diagnoseProfitability,
	type NormalizedProfitabilityRow,
	normalizeProfitabilityReport,
} from "../../amazon-agent/src/index.ts";

function completeRow(overrides: Partial<NormalizedProfitabilityRow> = {}): NormalizedProfitabilityRow {
	return {
		marketplace: "US",
		asin: "B000TEST01",
		sku: "SKU-1",
		unitsSold: 10,
		grossSales: 500,
		refundsAmount: 20,
		amazonFees: 50,
		fulfillmentFees: 40,
		storageFees: 10,
		advertisingSpend: 100,
		cogsPerUnit: 15,
		otherVariableCosts: 5,
		currency: "USD",
		sourceFile: "profit.csv",
		sourceRow: 2,
		...overrides,
	};
}

function completeReport(cogsPerUnit = "15") {
	return [
		"Marketplace,ASIN,SKU,Units Sold,Gross Sales,Refunds,Amazon Fees,FBA Fees,Storage Fees,Advertising Spend,COGS Per Unit,Other Variable Costs,Currency",
		`US,B000TEST01,SKU-1,10,500,20,50,40,10,100,${cogsPerUnit},5,USD`,
	].join("\n");
}

describe("Amazon profitability diagnosis", () => {
	it("calculates complete known contribution economics exactly", () => {
		expect(calculateProfitabilityMetrics(completeRow())).toEqual({
			knownCogsTotal: 150,
			knownVariableCost: 375,
			knownContributionProfit: 125,
			knownContributionMargin: 0.25,
			status: "complete",
			missingCostCategories: [],
		});
	});

	it("marks missing COGS as partial and discloses the missing category", () => {
		const metrics = calculateProfitabilityMetrics(completeRow({ cogsPerUnit: null }));

		expect(metrics.status).toBe("partial");
		expect(metrics.knownCogsTotal).toBeNull();
		expect(metrics.missingCostCategories).toContain("cogs");
		expect(metrics.knownContributionProfit).toBe(275);
	});

	it("treats explicit zero costs as known values", () => {
		const metrics = calculateProfitabilityMetrics(
			completeRow({
				refundsAmount: 0,
				amazonFees: 0,
				fulfillmentFees: 0,
				storageFees: 0,
				advertisingSpend: 0,
				cogsPerUnit: 0,
				otherVariableCosts: 0,
			}),
		);

		expect(metrics.status).toBe("complete");
		expect(metrics.missingCostCategories).toEqual([]);
	});

	it("flags negative known contribution even when cost data is partial", () => {
		const row = completeRow({
			grossSales: 100,
			refundsAmount: null,
			amazonFees: null,
			fulfillmentFees: null,
			storageFees: null,
			advertisingSpend: 150,
			cogsPerUnit: null,
			otherVariableCosts: null,
		});
		const findings = diagnoseProfitability([row], { requiredContributionMargin: null });

		expect(findings).toEqual([
			expect.objectContaining({
				ruleId: "profit.negative-known-contribution.v1",
				category: "profit-risk",
				priority: "high",
				dataQuality: "partial",
				humanApprovalRequired: true,
				evidence: [{ sourceFile: "profit.csv", sourceRow: 2 }],
			}),
		]);
	});

	it("never labels a positive partial result as complete", () => {
		const metrics = calculateProfitabilityMetrics(completeRow({ cogsPerUnit: null }));
		expect(metrics.knownContributionProfit).toBeGreaterThan(0);
		expect(metrics.status).toBe("partial");
	});

	it("applies a required contribution margin only when the seller supplies it", () => {
		const withoutTarget = diagnoseProfitability([completeRow()], { requiredContributionMargin: null });
		const withTarget = diagnoseProfitability([completeRow()], { requiredContributionMargin: 0.3 });

		expect(withoutTarget).toEqual([]);
		expect(withTarget).toEqual([
			expect.objectContaining({
				ruleId: "profit.below-required-margin.v1",
				thresholds: { requiredContributionMargin: 0.3 },
			}),
		]);
	});

	it("keeps invalid numeric costs unknown and reports a warning", () => {
		const parsed = normalizeProfitabilityReport({ content: completeReport("not-a-number"), fileName: "profit.csv" });

		expect(parsed.inspection.warnings).toEqual([
			expect.objectContaining({
				field: "cogsPerUnit",
				rawValue: "not-a-number",
				sourceRow: 2,
			}),
		]);
		expect(parsed.rows[0].cogsPerUnit).toBeNull();
	});

	it("returns data quality, deterministic metrics, findings, and evidence through tool orchestration", () => {
		const result = buildProfitDiagnosisResult(completeReport(), "profit.csv", { requiredContributionMargin: 0.3 });

		expect(result.rowsAnalyzed).toBe(1);
		expect(result.results[0]).toMatchObject({
			entity: { asin: "B000TEST01", sku: "SKU-1" },
			metrics: {
				knownContributionProfit: 125,
				knownContributionMargin: 0.25,
				status: "complete",
			},
		});
		expect(result.findings[0]).toMatchObject({
			ruleId: "profit.below-required-margin.v1",
			evidence: [{ sourceFile: "profit.csv", sourceRow: 2 }],
		});
	});
});
