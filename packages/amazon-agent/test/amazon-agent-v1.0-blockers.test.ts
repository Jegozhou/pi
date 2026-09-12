import { describe, expect, it } from "vitest";
import {
	buildPpcDiagnosisResult,
	buildProfitDiagnosisResult,
	buildSellerExecutionDryRun,
	createSellerApprovalEnvelope,
	decideSellerChangeSet,
	enrichSellerChangeSet,
	normalizeTargetSnapshot,
	type SellerApprovalEnvelope,
	type SellerChangeProposal,
	type SellerChangeSet,
	type SellerChangeSetDecisionInput,
	verifySellerApprovalEnvelope,
} from "../src/index.ts";

function readyBidProposal(): SellerChangeProposal {
	return {
		id: "change:bid",
		sourceActionItemId: "action:bid",
		sourceFindingId: "finding:bid",
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
		before: { campaignId: "1001", adGroupId: "2001", targetId: "3001", currentBid: 1.2 },
		after: { campaignId: "1001", adGroupId: "2001", targetId: "3001", proposedBid: 0.96 },
		humanApprovalRequired: true,
	};
}

function awaitingBidChangeSet(): SellerChangeSet {
	return {
		id: "changeset:blocker-tests",
		version: 3,
		status: "awaiting-approval",
		sourceActionItemIds: ["action:bid"],
		proposals: [readyBidProposal()],
		decision: null,
	};
}

function approvedEnvelope(secret: Uint8Array): SellerApprovalEnvelope {
	const approved = decideSellerChangeSet(awaitingBidChangeSet(), {
		decision: "approve",
		actor: "seller-owner",
		decidedAt: "2026-09-13T00:00:00.000Z",
		provenance: "host-ui-confirmation",
	});
	return createSellerApprovalEnvelope(approved, secret);
}

function blockedProposal(operation: "add-negative-exact" | "set-bid"): SellerChangeProposal {
	return {
		...readyBidProposal(),
		id: `change:${operation}`,
		operation,
		readiness: "blocked",
		entity: {
			type: "search-term",
			value: operation === "add-negative-exact" ? "free trail shoes" : "trail running shoes",
		},
		missingInputs:
			operation === "add-negative-exact"
				? ["campaign identity", "ad group identity"]
				: ["target identity", "current bid", "proposed bid"],
		before: null,
		after: null,
	};
}

function draftChangeSet(proposal: SellerChangeProposal): SellerChangeSet {
	return {
		id: `changeset:${proposal.id}`,
		version: 1,
		status: "draft",
		sourceActionItemIds: [proposal.sourceActionItemId],
		proposals: [proposal],
		decision: null,
	};
}

function targetSnapshot(secondRow: string) {
	return normalizeTargetSnapshot({
		fileName: "targets.csv",
		content: [
			"Campaign Name,Campaign ID,Ad Group Name,Ad Group ID,Targeting,Match Type,Target ID,Bid,State",
			"SP Discovery,1001,Shoes,2001,running shoes,BROAD,3001,1.20,ENABLED",
			secondRow,
		].join("\n"),
	});
}

describe("Amazon V1.0 release blocker regressions", () => {
	it("requires explicit host UI provenance for approval decisions", () => {
		const missingProvenance = {
			decision: "approve",
			actor: "seller-owner",
			decidedAt: "2026-09-13T00:00:00.000Z",
		} as unknown as SellerChangeSetDecisionInput;
		expect(() => decideSellerChangeSet(awaitingBidChangeSet(), missingProvenance)).toThrow(/provenance|host ui/i);

		const trustedCaller = {
			decision: "approve",
			actor: "seller-owner",
			decidedAt: "2026-09-13T00:00:00.000Z",
			provenance: "trusted-caller",
		} as unknown as SellerChangeSetDecisionInput;
		expect(() => decideSellerChangeSet(awaitingBidChangeSet(), trustedCaller)).toThrow(/provenance|host ui/i);
	});

	it("binds an approval proof to exact host-confirmed content", () => {
		const secret = new TextEncoder().encode("v1-blocker-test-secret");
		const envelope = approvedEnvelope(secret);
		expect(verifySellerApprovalEnvelope(envelope, secret).id).toBe(envelope.changeSet.id);
		const dryRun = buildSellerExecutionDryRun(envelope, secret, { expectedVersion: envelope.changeSet.version });
		expect(dryRun.writesPerformed).toBe(false);

		const tampered = structuredClone(envelope);
		tampered.changeSet.proposals[0].after = {
			...(tampered.changeSet.proposals[0].after ?? {}),
			proposedBid: 0.5,
		};
		expect(() => buildSellerExecutionDryRun(tampered, secret)).toThrow(/signature|digest|tamper/i);
	});

	it("rejects a bare approved Change Set at the domain dry-run boundary", () => {
		const secret = new TextEncoder().encode("v1-blocker-test-secret");
		const envelope = approvedEnvelope(secret);
		expect(() => buildSellerExecutionDryRun(envelope.changeSet as unknown as SellerApprovalEnvelope, secret)).toThrow(
			/envelope|proof|signature/i,
		);
	});

	it("keeps a negative-exact proposal blocked when matched snapshot IDs are blank", () => {
		const snapshot = normalizeTargetSnapshot({
			fileName: "targets.csv",
			content: [
				"Campaign Name,Campaign ID,Ad Group Name,Ad Group ID,Targeting,Match Type,Target ID,Bid,State",
				"SP Discovery,,Shoes,,running shoes,BROAD,3001,1.20,ENABLED",
			].join("\n"),
		});
		const proposal = blockedProposal("add-negative-exact");
		const result = enrichSellerChangeSet(draftChangeSet(proposal), snapshot);
		expect(result.changeSet.proposals[0].readiness).toBe("blocked");
		expect(result.diagnostics.unresolvedProposalIds).toEqual([proposal.id]);
		expect(result.diagnostics.resolvedProposalIds).toEqual([]);
	});

	it.each([
		["campaign ID", "SP Discovery,9999,Shoes,2001,running shoes,BROAD,3001,1.20,ENABLED"],
		["ad group ID", "SP Discovery,1001,Shoes,9999,running shoes,BROAD,3001,1.20,ENABLED"],
		["targeting", "SP Discovery,1001,Shoes,2001,walking shoes,BROAD,3001,1.20,ENABLED"],
		["match type", "SP Discovery,1001,Shoes,2001,running shoes,PHRASE,3001,1.20,ENABLED"],
		["bid", "SP Discovery,1001,Shoes,2001,running shoes,BROAD,3001,0.80,ENABLED"],
		["state", "SP Discovery,1001,Shoes,2001,running shoes,BROAD,3001,1.20,PAUSED"],
	] as const)("treats same-target conflicting %s as ambiguous", (_label, row) => {
		const proposal = blockedProposal("set-bid");
		const result = enrichSellerChangeSet(draftChangeSet(proposal), targetSnapshot(row));
		expect(result.changeSet.proposals[0].readiness).toBe("blocked");
		expect(result.diagnostics.ambiguousProposalIds).toEqual([proposal.id]);
		expect(result.diagnostics.resolvedProposalIds).toEqual([]);
	});

	it("allows identical duplicate target snapshot rows to resolve once", () => {
		const duplicate = "SP Discovery,1001,Shoes,2001,running shoes,BROAD,3001,1.20,ENABLED";
		const proposal = blockedProposal("set-bid");
		const result = enrichSellerChangeSet(draftChangeSet(proposal), targetSnapshot(duplicate));
		expect(result.diagnostics.resolvedProposalIds).toEqual([proposal.id]);
		expect(result.diagnostics.ambiguousProposalIds).toEqual([]);
	});

	it("rejects a PPC report that has headers but no data rows", () => {
		const emptyPpc = "Campaign,Ad Group,Customer Search Term,Impressions,Clicks,Spend,Sales\n";
		expect(() => buildPpcDiagnosisResult(emptyPpc, "empty.csv", { targetAcos: 0.3 })).toThrow(
			/insufficient|empty|row/i,
		);
	});

	it("rejects a profitability report that has headers but no data rows", () => {
		const emptyProfit = "ASIN,Gross Sales\n";
		expect(() => buildProfitDiagnosisResult(emptyProfit, "empty-profit.csv")).toThrow(/insufficient|empty|row/i);
	});
});
