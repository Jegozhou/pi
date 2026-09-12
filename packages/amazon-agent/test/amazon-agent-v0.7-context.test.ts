import { describe, expect, it } from "vitest";
import { buildPpcDiagnosisResult, buildSellerActionPlan, buildSellerChangeSet } from "../src/index.ts";

const report = [
	"Campaign Name,Ad Group Name,Targeting,Match Type,Customer Search Term,Impressions,Clicks,Spend,7 Day Total Orders (#),7 Day Total Sales,Currency",
	"SP Discovery,Shoes,running shoes,BROAD,trail running shoes,1000,20,30,0,0,USD",
].join("\n");

describe("Amazon V0.7 PPC context propagation", () => {
	it("preserves report context from Finding through Action Plan into Change Set", () => {
		const diagnosis = buildPpcDiagnosisResult(report, "search-term.csv");
		expect(diagnosis.findings).toHaveLength(1);
		expect(diagnosis.findings[0].context).toEqual({
			campaignName: "SP Discovery",
			adGroupName: "Shoes",
			targeting: "running shoes",
			matchType: "BROAD",
		});

		const plan = buildSellerActionPlan({
			ppcFindings: diagnosis.findings,
			profitabilityFindings: [],
		});
		expect(plan.items[0].context).toEqual(diagnosis.findings[0].context);

		const changeSet = buildSellerChangeSet(plan);
		expect(changeSet.proposals[0].context).toEqual(diagnosis.findings[0].context);
	});
});
