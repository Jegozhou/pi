import { describe, expect, it } from "vitest";
import {
	buildSellerExecutionPlan,
	createFakeAmazonAdsExecutor,
	createSellerApprovalEnvelope,
	decideSellerChangeSet,
	type FakeAmazonAdsState,
	fakeNegativeExactScopeKey,
	type SellerApprovalEnvelope,
	type SellerChangeProposal,
	type SellerChangeSet,
} from "../src/index.ts";

const SECRET = new TextEncoder().encode("amazon-agent-v1.1-executor-secret");

function bidProposal(): SellerChangeProposal {
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

function negativeProposal(): SellerChangeProposal {
	return {
		id: "change:negative",
		sourceActionItemId: "action:negative",
		sourceFindingId: "finding:negative",
		sourceRuleId: "ppc.waste-without-sales.v1",
		operation: "add-negative-exact",
		readiness: "ready",
		entity: { type: "search-term", value: "free trail shoes" },
		context: {
			campaignName: "SP Discovery",
			adGroupName: "Shoes",
			targeting: "running shoes",
			matchType: "BROAD",
		},
		decisionContext: null,
		rationale: "Spend without attributed sales.",
		evidence: [{ sourceFile: "search-term.csv", sourceRow: 3 }],
		missingInputs: [],
		before: { campaignId: "1001", adGroupId: "2001" },
		after: { campaignId: "1001", adGroupId: "2001", negativeExact: "free trail shoes" },
		humanApprovalRequired: true,
	};
}

function approvedEnvelope(proposals: SellerChangeProposal[], id = "changeset:v1.1-executor"): SellerApprovalEnvelope {
	const awaiting: SellerChangeSet = {
		id,
		version: 1,
		status: "awaiting-approval",
		sourceActionItemIds: proposals.map((proposal) => proposal.sourceActionItemId),
		proposals,
		decision: null,
	};
	const approved = decideSellerChangeSet(awaiting, {
		decision: "approve",
		actor: "seller-owner",
		decidedAt: "2026-09-13T02:00:00.000Z",
		provenance: "host-ui-confirmation",
	});
	return createSellerApprovalEnvelope(approved, SECRET);
}

function plan(id = "changeset:v1.1-executor") {
	return buildSellerExecutionPlan(approvedEnvelope([bidProposal(), negativeProposal()], id), SECRET);
}

function state(currentBid = 1.2): FakeAmazonAdsState {
	return {
		bidsByTargetId: new Map([["3001", currentBid]]),
		negativeExactByScope: new Set(),
		processedPlanKeys: new Map(),
	};
}

describe("Amazon Seller Agent V1.1 fake executor", () => {
	it("simulates supported mutations against caller-owned fake state without external writes", async () => {
		const fakeState = state();
		const executionPlan = plan();
		const executor = createFakeAmazonAdsExecutor(fakeState);
		const receipt = await executor.execute(executionPlan);

		expect(executor.name).toBe("fake-amazon-ads");
		expect(receipt.externalWritesPerformed).toBe(false);
		expect(receipt.operations.map((operation) => operation.status)).toEqual(["applied", "applied"]);
		expect(fakeState.bidsByTargetId.get("3001")).toBe(0.96);
		expect(fakeState.negativeExactByScope.has(fakeNegativeExactScopeKey("1001", "2001", "free trail shoes"))).toBe(
			true,
		);
	});

	it("blocks a bid mutation when fake current state is stale", async () => {
		const fakeState = state(0.8);
		const receipt = await createFakeAmazonAdsExecutor(fakeState).execute(plan());
		const bid = receipt.operations.find((operation) => operation.operation === "set-bid");
		expect(bid?.status).toBe("blocked-stale");
		expect(fakeState.bidsByTargetId.get("3001")).toBe(0.8);
		expect(receipt.externalWritesPerformed).toBe(false);
	});

	it("treats an already-present exact negative as the desired state instead of duplicating it", async () => {
		const fakeState = state();
		fakeState.negativeExactByScope.add(fakeNegativeExactScopeKey("1001", "2001", "free trail shoes"));
		const receipt = await createFakeAmazonAdsExecutor(fakeState).execute(plan("changeset:duplicate-negative"));
		const negative = receipt.operations.find((operation) => operation.operation === "add-negative-exact");
		expect(negative?.status).toBe("already-applied");
		expect(fakeState.negativeExactByScope.size).toBe(1);
	});

	it("does not mutate the execution plan while simulating state changes", async () => {
		const fakeState = state();
		const executionPlan = plan();
		const before = structuredClone(executionPlan);
		await createFakeAmazonAdsExecutor(fakeState).execute(executionPlan);
		expect(executionPlan).toEqual(before);
	});

	it("replays the prior receipt for the same plan without applying mutations twice", async () => {
		const fakeState = state();
		const executionPlan = plan("changeset:replay");
		const executor = createFakeAmazonAdsExecutor(fakeState);
		const first = await executor.execute(executionPlan);
		const stateAfterFirst = {
			bid: fakeState.bidsByTargetId.get("3001"),
			negatives: [...fakeState.negativeExactByScope],
		};
		const second = await executor.execute(executionPlan);

		expect(second).toEqual(first);
		expect(fakeState.processedPlanKeys.get(executionPlan.idempotencyKey)).toEqual(first);
		expect(fakeState.bidsByTargetId.get("3001")).toBe(stateAfterFirst.bid);
		expect([...fakeState.negativeExactByScope]).toEqual(stateAfterFirst.negatives);
	});

	it("marks a forced first-operation failure and skips all later operations", async () => {
		const fakeState = state();
		const executionPlan = plan("changeset:fail-first");
		const receipt = await createFakeAmazonAdsExecutor(fakeState, {
			failProposalIds: new Set(["change:bid"]),
		}).execute(executionPlan);

		expect(receipt.operations.map((operation) => operation.status)).toEqual([
			"simulated-failure",
			"skipped-after-failure",
		]);
		expect(fakeState.bidsByTargetId.get("3001")).toBe(1.2);
		expect(fakeState.negativeExactByScope.size).toBe(0);
		expect(receipt.externalWritesPerformed).toBe(false);
	});

	it("keeps already-applied fake mutations explicit when a later operation fails", async () => {
		const fakeState = state();
		const executionPlan = plan("changeset:partial-failure");
		const receipt = await createFakeAmazonAdsExecutor(fakeState, {
			failProposalIds: new Set(["change:negative"]),
		}).execute(executionPlan);

		expect(receipt.operations.map((operation) => operation.status)).toEqual(["applied", "simulated-failure"]);
		expect(fakeState.bidsByTargetId.get("3001")).toBe(0.96);
		expect(fakeState.negativeExactByScope.size).toBe(0);
		expect(receipt.externalWritesPerformed).toBe(false);
	});
});
