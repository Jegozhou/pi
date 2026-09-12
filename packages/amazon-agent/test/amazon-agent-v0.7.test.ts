import { describe, expect, it } from "vitest";
import {
	buildSellerActionPlan,
	buildSellerChangeSet,
	enrichSellerChangeSet,
	normalizeTargetSnapshot,
	type Finding,
} from "../src/index.ts";

function finding(type: Finding["recommendedAction"]["type"] = "negative-exact-candidate"): Finding {
	return {
		id: `finding:${type}`,
		ruleId: type === "reduce-bid-candidate" ? "ppc.high-acos.v1" : "ppc.waste-without-sales.v1",
		category: type === "reduce-bid-candidate" ? "bid-down" : "waste",
		priority: "high",
		confidence: "high",
		entity: { type: "search-term", value: "trail running shoes" },
		context: {
			campaignName: "SP Discovery",
			adGroupName: "Shoes",
			targeting: "running shoes",
			matchType: "BROAD",
		},
		metrics: {
			ctr: 0.02,
			cvr: 0,
			cpc: 1.5,
			acos: type === "reduce-bid-candidate" ? 0.7 : null,
			roas: type === "reduce-bid-candidate" ? 1 / 0.7 : null,
			impressions: 1000,
			clicks: 20,
			spend: 30,
			attributedOrders: type === "reduce-bid-candidate" ? 2 : 0,
			attributedSales: type === "reduce-bid-candidate" ? 42.86 : 0,
		},
		evidence: [{ sourceFile: "search-term.csv", sourceRow: 2 }],
		thresholds: {},
		rationale: "Evidence-backed PPC finding.",
		recommendedAction: {
			type,
			summary: type === "reduce-bid-candidate" ? "Reduce bid carefully." : "Review as a negative exact candidate.",
		},
		humanApprovalRequired: true,
	};
}

function changeSet(type: Finding["recommendedAction"]["type"] = "negative-exact-candidate") {
	const plan = buildSellerActionPlan({ ppcFindings: [finding(type)], profitabilityFindings: [] });
	return buildSellerChangeSet(plan);
}

const snapshotCsv = [
	"Campaign Name,Campaign ID,Ad Group Name,Ad Group ID,Targeting,Match Type,Target ID,Bid,State",
	"SP Discovery,1001,Shoes,2001,running shoes,BROAD,3001,1.20,ENABLED",
].join("\n");

describe("Amazon V0.7 target snapshot resolver", () => {
	it("parses target snapshot identity and keeps IDs as strings", () => {
		const parsed = normalizeTargetSnapshot({ content: snapshotCsv, fileName: "targets.csv" });
		expect(parsed.rows[0]).toMatchObject({
			campaignId: "1001",
			adGroupId: "2001",
			targetId: "3001",
			currentBid: 1.2,
		});
	});

	it("parses TSV snapshots", () => {
		const content = "Campaign\tCampaign ID\tAd Group\tAd Group ID\nSP Discovery\t1001\tShoes\t2001";
		const parsed = normalizeTargetSnapshot({ content, fileName: "targets.tsv" });
		expect(parsed.inspection.delimiter).toBe("\t");
		expect(parsed.rows[0].campaignId).toBe("1001");
	});

	it("turns an invalid bid into null plus a warning", () => {
		const parsed = normalizeTargetSnapshot({
			content: snapshotCsv.replace("1.20", "not-a-bid"),
			fileName: "targets.csv",
		});
		expect(parsed.rows[0].currentBid).toBeNull();
		expect(parsed.inspection.warnings).toEqual([
			expect.objectContaining({ field: "currentBid", sourceRow: 2, rawValue: "not-a-bid" }),
		]);
	});

	it("makes negative exact ready when campaign and ad group identity resolve uniquely", () => {
		const original = changeSet();
		const parsed = normalizeTargetSnapshot({ content: snapshotCsv, fileName: "targets.csv" });
		const result = enrichSellerChangeSet(original, parsed);
		const proposal = result.changeSet.proposals[0];

		expect(proposal.readiness).toBe("ready");
		expect(proposal.missingInputs).toEqual([]);
		expect(proposal.before).toMatchObject({ campaignId: "1001", adGroupId: "2001", searchTerm: "trail running shoes" });
		expect(proposal.after).toMatchObject({ campaignId: "1001", adGroupId: "2001", negativeExact: "trail running shoes" });
		expect(result.diagnostics.resolvedProposalIds).toEqual([proposal.id]);
	});

	it("fills target identity and current bid for bid-down but still requires proposed bid", () => {
		const parsed = normalizeTargetSnapshot({ content: snapshotCsv, fileName: "targets.csv" });
		const result = enrichSellerChangeSet(changeSet("reduce-bid-candidate"), parsed);
		const proposal = result.changeSet.proposals[0];

		expect(proposal.readiness).toBe("blocked");
		expect(proposal.before).toMatchObject({ campaignId: "1001", adGroupId: "2001", targetId: "3001", currentBid: 1.2 });
		expect(proposal.after).toBeNull();
		expect(proposal.missingInputs).toEqual(["proposed bid"]);
	});

	it("does not guess when no target snapshot row matches", () => {
		const parsed = normalizeTargetSnapshot({ content: snapshotCsv.replace("SP Discovery", "Other Campaign"), fileName: "targets.csv" });
		const result = enrichSellerChangeSet(changeSet(), parsed);
		expect(result.changeSet.proposals[0].readiness).toBe("blocked");
		expect(result.diagnostics.unresolvedProposalIds).toEqual([result.changeSet.proposals[0].id]);
	});

	it("does not guess when names map to multiple ad group identities", () => {
		const ambiguous = `${snapshotCsv}\nSP Discovery,1001,Shoes,9999,walking shoes,PHRASE,3999,0.90,ENABLED`;
		const parsed = normalizeTargetSnapshot({ content: ambiguous, fileName: "targets.csv" });
		const result = enrichSellerChangeSet(changeSet(), parsed);
		expect(result.changeSet.proposals[0].readiness).toBe("blocked");
		expect(result.diagnostics.ambiguousProposalIds).toEqual([result.changeSet.proposals[0].id]);
	});

	it("is immutable and increments the change set version", () => {
		const original = changeSet();
		const originalJson = JSON.stringify(original);
		const parsed = normalizeTargetSnapshot({ content: snapshotCsv, fileName: "targets.csv" });
		const result = enrichSellerChangeSet(original, parsed);
		expect(JSON.stringify(original)).toBe(originalJson);
		expect(result.changeSet.version).toBe(original.version + 1);
		expect(result.changeSet.status).toBe("draft");
	});

	it("rejects enrichment after the change set leaves draft", () => {
		const original = { ...changeSet(), status: "awaiting-approval" as const };
		const parsed = normalizeTargetSnapshot({ content: snapshotCsv, fileName: "targets.csv" });
		expect(() => enrichSellerChangeSet(original, parsed)).toThrow(/draft/i);
	});
});
