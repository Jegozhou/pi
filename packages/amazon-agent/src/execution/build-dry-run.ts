import {
	verifySellerApprovalEnvelope,
	type SellerApprovalEnvelope,
	type SellerApprovalSecret,
} from "../approval/approval-envelope.ts";
import type { SellerChangeProposal, SellerChangeSet } from "../change-set/types.ts";
import type {
	SellerBidDryRunOperation,
	SellerDryRunOperation,
	SellerExecutionDryRun,
	SellerExecutionDryRunOptions,
	SellerNegativeExactDryRunOperation,
} from "./types.ts";

function isMutatingProposal(proposal: SellerChangeProposal): boolean {
	return proposal.operation !== "review-profitability";
}

function asRecord(value: Record<string, unknown> | null, label: string): Record<string, unknown> {
	if (!value) throw new Error(`${label} is required`);
	return value;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} is required`);
	}
	return value;
}

function requiredPositiveNumber(record: Record<string, unknown>, key: string, label: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${label} is required and must be a positive finite number`);
	}
	return value;
}

function buildBidOperation(proposal: SellerChangeProposal): SellerBidDryRunOperation {
	const before = asRecord(proposal.before, "set-bid before state");
	const after = asRecord(proposal.after, "set-bid after state");
	const targetId = requiredString(before, "targetId", "target ID");
	const afterTargetId = requiredString(after, "targetId", "target ID");
	if (afterTargetId !== targetId) throw new Error("set-bid target ID changed between before and after state");

	const currentBid = requiredPositiveNumber(before, "currentBid", "current bid");
	const proposedBid = requiredPositiveNumber(after, "proposedBid", "proposed bid");

	return {
		proposalId: proposal.id,
		operation: "set-bid",
		targetId,
		before: { bid: currentBid },
		after: { bid: proposedBid },
		checks: [
			"approved-change-set",
			"proposal-ready",
			"target-id-present",
			"before-value-present",
			"after-value-present",
		],
	};
}

function buildNegativeExactOperation(proposal: SellerChangeProposal): SellerNegativeExactDryRunOperation {
	const before = asRecord(proposal.before, "add-negative-exact before state");
	const after = asRecord(proposal.after, "add-negative-exact after state");
	const campaignId = requiredString(before, "campaignId", "campaign ID");
	const adGroupId = requiredString(before, "adGroupId", "ad group ID");
	const afterCampaignId = requiredString(after, "campaignId", "campaign ID");
	const afterAdGroupId = requiredString(after, "adGroupId", "ad group ID");
	if (afterCampaignId !== campaignId || afterAdGroupId !== adGroupId) {
		throw new Error("add-negative-exact scope changed between before and after state");
	}
	const negativeExact = requiredString(after, "negativeExact", "negative exact value");

	return {
		proposalId: proposal.id,
		operation: "add-negative-exact",
		campaignId,
		adGroupId,
		negativeExact,
		checks: [
			"approved-change-set",
			"proposal-ready",
			"campaign-id-present",
			"ad-group-id-present",
			"before-value-present",
			"after-value-present",
		],
	};
}

function buildOperation(proposal: SellerChangeProposal): SellerDryRunOperation {
	if (proposal.readiness !== "ready") {
		throw new Error(`Proposal ${proposal.id} is not ready for dry-run execution planning`);
	}
	if (proposal.humanApprovalRequired !== true) {
		throw new Error(`Proposal ${proposal.id} must preserve humanApprovalRequired=true`);
	}

	switch (proposal.operation) {
		case "set-bid":
			return buildBidOperation(proposal);
		case "add-negative-exact":
			return buildNegativeExactOperation(proposal);
		case "create-exact-target":
		case "scale":
			throw new Error(`Unsupported ready mutation for V0.9 dry run: ${proposal.operation}`);
		case "review-profitability":
			throw new Error("review-profitability is analytical and cannot become a dry-run operation");
	}
}

function validateExpectedVersion(changeSet: SellerChangeSet, expectedVersion: number | undefined): void {
	if (expectedVersion === undefined) return;
	if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
		throw new RangeError("expectedVersion must be a positive integer");
	}
	if (changeSet.version !== expectedVersion) {
		throw new Error(`Change Set version mismatch: expected ${expectedVersion}, received ${changeSet.version}`);
	}
}

export function buildSellerExecutionDryRun(
	envelope: SellerApprovalEnvelope,
	secret: SellerApprovalSecret,
	options: SellerExecutionDryRunOptions = {},
): SellerExecutionDryRun {
	const changeSet = verifySellerApprovalEnvelope(envelope, secret);
	validateExpectedVersion(changeSet, options.expectedVersion);

	const blockedMutating = changeSet.proposals.filter(
		(proposal) => isMutatingProposal(proposal) && proposal.readiness === "blocked",
	);
	if (blockedMutating.length > 0) {
		throw new Error(`Cannot build execution dry run while ${blockedMutating.length} mutating proposal(s) are blocked`);
	}

	const operations: SellerDryRunOperation[] = [];
	const skippedReviewOnlyProposalIds: string[] = [];

	for (const proposal of changeSet.proposals) {
		if (proposal.operation === "review-profitability") {
			skippedReviewOnlyProposalIds.push(proposal.id);
			continue;
		}
		operations.push(buildOperation(proposal));
	}

	if (operations.length === 0) {
		throw new Error("Execution dry run requires at least one supported ready mutating proposal");
	}

	return {
		id: `dryrun:${changeSet.id}:${changeSet.version}`,
		mode: "dry-run",
		sourceChangeSetId: changeSet.id,
		sourceChangeSetVersion: changeSet.version,
		approvedBy: changeSet.decision?.actor ?? "unknown",
		approvedAt: changeSet.decision?.decidedAt ?? "unknown",
		writesPerformed: false,
		operations,
		skippedReviewOnlyProposalIds,
	};
}
