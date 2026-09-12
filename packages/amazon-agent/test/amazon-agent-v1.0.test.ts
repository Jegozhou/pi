import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	applyBidPolicyToChangeSet,
	buildPpcDiagnosisResult,
	buildProfitDiagnosisResult,
	buildSellerActionPlan,
	buildSellerChangeSet,
	buildSellerExecutionDryRun,
	decideSellerChangeSet,
	enrichSellerChangeSet,
	normalizeTargetSnapshot,
	requestSellerChangeSetApproval,
} from "../src/index.ts";

function fixture(name: string): string {
	return readFileSync(new URL(`./fixtures/v1.0/${name}`, import.meta.url), "utf8");
}

describe("Amazon Seller Agent V1.0 file-first acceptance", () => {
	it("runs diagnosis through approved zero-write dry run deterministically", () => {
		const ppc = buildPpcDiagnosisResult(fixture("search-term-report.csv"), "search-term-report.csv", {
			targetAcos: 0.3,
		});
		const profit = buildProfitDiagnosisResult(fixture("profitability.csv"), "profitability.csv");

		expect(ppc.rowsAnalyzed).toBe(3);
		expect(ppc.findingsCount).toBe(4);
		expect(ppc.byCategory).toEqual({
			waste: 1,
			"bid-down": 1,
			migration: 1,
			scale: 1,
		});
		expect(profit.rowsAnalyzed).toBe(1);
		expect(profit.findings).toHaveLength(1);
		expect(profit.findings[0]).toMatchObject({
			ruleId: "profit.negative-known-contribution.v1",
			entity: { type: "asin", value: "B000NEG" },
			dataQuality: "complete",
		});
		expect(profit.findings[0].metrics.knownContributionProfit).toBe(-50);

		const plan = buildSellerActionPlan({
			ppcFindings: ppc.findings,
			profitabilityFindings: profit.findings,
			limit: 3,
		});
		expect(plan.totalFindings).toBe(5);
		expect(plan.returnedItems).toBe(3);
		expect(plan.items.map((item) => item.recommendedAction.type)).toEqual([
			"review-profitability-candidate",
			"negative-exact-candidate",
			"reduce-bid-candidate",
		]);

		const draft = buildSellerChangeSet(plan);
		const snapshot = normalizeTargetSnapshot({
			content: fixture("target-snapshot.csv"),
			fileName: "target-snapshot.csv",
		});
		const enriched = enrichSellerChangeSet(draft, snapshot);
		expect(enriched.changeSet.proposals.map((proposal) => proposal.readiness)).toEqual([
			"review-only",
			"ready",
			"blocked",
		]);

		const simulated = applyBidPolicyToChangeSet(enriched.changeSet);
		expect(simulated.changeSet.proposals.map((proposal) => proposal.readiness)).toEqual([
			"review-only",
			"ready",
			"ready",
		]);
		const bidProposal = simulated.changeSet.proposals.find((proposal) => proposal.operation === "set-bid");
		expect(bidProposal?.before).toMatchObject({ targetId: "3001", currentBid: 1.2 });
		expect(bidProposal?.after).toMatchObject({ targetId: "3001", proposedBid: 0.96 });

		const awaitingApproval = requestSellerChangeSetApproval(simulated.changeSet);
		const approved = decideSellerChangeSet(awaitingApproval, {
			decision: "approve",
			actor: "v1-acceptance-seller",
			decidedAt: "2026-09-13T00:00:00.000Z",
		});
		expect(approved.status).toBe("approved");

		const dryRun = buildSellerExecutionDryRun(approved, { expectedVersion: approved.version });
		expect(dryRun.writesPerformed).toBe(false);
		expect(dryRun.operations.map((operation) => operation.operation)).toEqual([
			"add-negative-exact",
			"set-bid",
		]);
		expect(dryRun.operations[0]).toMatchObject({
			campaignId: "1001",
			adGroupId: "2001",
			negativeExact: "free trail shoes",
		});
		expect(dryRun.operations[1]).toMatchObject({
			targetId: "3001",
			before: { bid: 1.2 },
			after: { bid: 0.96 },
		});
		expect(dryRun.skippedReviewOnlyProposalIds).toHaveLength(1);
		expect(dryRun.approvedBy).toBe("v1-acceptance-seller");
	});
});
