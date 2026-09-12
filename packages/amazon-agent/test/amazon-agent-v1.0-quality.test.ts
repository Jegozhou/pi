import { describe, expect, it } from "vitest";
import {
	buildPpcDiagnosisResult,
	buildSellerChangeSet,
	diagnosePpc,
	normalizeSearchTermReport,
	normalizeTargetSnapshot,
	type SellerActionPlan,
	type SellerActionPlanItem,
} from "../src/index.ts";

function actionItem(id: string): SellerActionPlanItem {
	return {
		id,
		rank: 1,
		source: "profitability",
		stage: "optimize",
		priority: "medium",
		confidence: "medium",
		dataQuality: "complete",
		entity: { type: "asin", value: "B000TEST" },
		rationale: "Review profitability.",
		recommendedAction: {
			type: "review-profitability-candidate",
			summary: "Review profitability.",
		},
		evidence: [{ sourceFile: "profit.csv", sourceRow: 2 }],
		sourceFindingId: `finding:${id}`,
		sourceRuleId: "profit.below-required-margin.v1",
		humanApprovalRequired: true,
	};
}

function plan(ids: string[]): SellerActionPlan {
	return {
		totalFindings: ids.length,
		returnedItems: ids.length,
		items: ids.map((id, index) => ({ ...actionItem(id), rank: index + 1 })),
	};
}

describe("Amazon V1.0 data quality hardening", () => {
	it("rejects PPC diagnosis when a numeric field is malformed", () => {
		const content = [
			"Campaign,Ad Group,Targeting,Match Type,Customer Search Term,Impressions,Clicks,Spend,Orders,Sales",
			"SP Discovery,Shoes,running shoes,BROAD,trail running shoes,1000,not-a-number,30,2,50",
		].join("\n");
		expect(() => buildPpcDiagnosisResult(content, "bad.csv", { targetAcos: 0.3 })).toThrow(/invalid numeric|data quality/i);
	});

	it("rejects PPC diagnosis when an advertising metric is negative", () => {
		const content = [
			"Campaign,Ad Group,Targeting,Match Type,Customer Search Term,Impressions,Clicks,Spend,Orders,Sales",
			"SP Discovery,Shoes,running shoes,BROAD,trail running shoes,1000,-2,30,2,50",
		].join("\n");
		expect(() => buildPpcDiagnosisResult(content, "negative.csv", { targetAcos: 0.3 })).toThrow(/invalid numeric|negative|data quality/i);
	});

	it("turns a non-positive current bid into null plus a warning", () => {
		const content = [
			"Campaign Name,Campaign ID,Ad Group Name,Ad Group ID,Targeting,Match Type,Target ID,Bid,State",
			"SP Discovery,1001,Shoes,2001,running shoes,BROAD,3001,-0.20,ENABLED",
		].join("\n");
		const parsed = normalizeTargetSnapshot({ content, fileName: "targets.csv" });
		expect(parsed.rows[0].currentBid).toBeNull();
		expect(parsed.inspection.warnings).toEqual([
			expect.objectContaining({ field: "currentBid", rawValue: "-0.20", sourceRow: 2 }),
		]);
	});

	it("does not create a scale candidate without source targeting context", () => {
		const content = [
			"Campaign,Ad Group,Customer Search Term,Impressions,Clicks,Spend,Orders,Sales",
			"SP Discovery,Shoes,trail running shoes,1000,20,12,4,100",
		].join("\n");
		const rows = normalizeSearchTermReport({ content, fileName: "search.csv" });
		const findings = diagnosePpc(rows, {
			targetAcos: 0.3,
			minimumClicksNoSale: 10,
			minimumSpendNoSale: 20,
			minimumOrdersScale: 3,
			highAcosMultiplier: 1.5,
			lowAcosScaleMargin: 0.25,
		});
		expect(findings.some((finding) => finding.category === "scale")).toBe(false);
	});

	it("rejects ambiguous duplicate aliases for the same report field", () => {
		const content = [
			"Campaign,Campaign Name,Ad Group,Customer Search Term,Impressions,Clicks,Spend,Sales",
			"SP A,SP B,Shoes,trail running shoes,100,10,5,20",
		].join("\n");
		expect(() => normalizeSearchTermReport({ content, fileName: "ambiguous.csv" })).toThrow(/ambiguous.*campaign/i);
	});

	it("uses collision-resistant Change Set IDs instead of raw joined action IDs", () => {
		const left = buildSellerChangeSet(plan(["a|b", "c"]));
		const right = buildSellerChangeSet(plan(["a", "b|c"]));
		expect(left.id).not.toBe(right.id);
		expect(left.id).toMatch(/^changeset:v1:[a-f0-9]+$/);
	});
});
