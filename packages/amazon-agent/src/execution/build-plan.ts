import { createHash } from "node:crypto";
import type { SellerApprovalEnvelope, SellerApprovalSecret } from "../approval/approval-envelope.ts";
import { buildSellerExecutionDryRun } from "./build-dry-run.ts";
import type {
	SellerExecutionOperation,
	SellerExecutionPlan,
	SellerExecutionPlanOptions,
} from "./plan-types.ts";
import type { SellerDryRunOperation } from "./types.ts";

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function buildOperationKey(
	sourceChangeSetId: string,
	sourceChangeSetVersion: number,
	contentDigest: string,
	operation: SellerDryRunOperation,
): string {
	const payload = JSON.stringify({
		sourceChangeSetId,
		sourceChangeSetVersion,
		contentDigest,
		operation,
	});
	return `execop:${sha256(payload)}`;
}

function toExecutionOperation(
	sourceChangeSetId: string,
	sourceChangeSetVersion: number,
	contentDigest: string,
	operation: SellerDryRunOperation,
): SellerExecutionOperation {
	const idempotencyKey = buildOperationKey(
		sourceChangeSetId,
		sourceChangeSetVersion,
		contentDigest,
		operation,
	);

	if (operation.operation === "set-bid") {
		return {
			proposalId: operation.proposalId,
			operation: "set-bid",
			targetId: operation.targetId,
			before: operation.before,
			after: operation.after,
			preconditions: { expectedCurrentBid: operation.before.bid },
			idempotencyKey,
		};
	}

	return {
		proposalId: operation.proposalId,
		operation: "add-negative-exact",
		campaignId: operation.campaignId,
		adGroupId: operation.adGroupId,
		negativeExact: operation.negativeExact,
		preconditions: { mustNotAlreadyExist: true },
		idempotencyKey,
	};
}

export function buildSellerExecutionPlan(
	envelope: SellerApprovalEnvelope,
	secret: SellerApprovalSecret,
	options: SellerExecutionPlanOptions = {},
): SellerExecutionPlan {
	const dryRun = buildSellerExecutionDryRun(envelope, secret, options);
	const contentDigest = envelope.proof.contentDigest;
	const planDigest = sha256(
		JSON.stringify({
			sourceChangeSetId: dryRun.sourceChangeSetId,
			sourceChangeSetVersion: dryRun.sourceChangeSetVersion,
			contentDigest,
		}),
	);
	const idempotencyKey = `execplan:${planDigest}`;
	const operations = dryRun.operations.map((operation) =>
		toExecutionOperation(
			dryRun.sourceChangeSetId,
			dryRun.sourceChangeSetVersion,
			contentDigest,
			operation,
		),
	);

	return {
		id: idempotencyKey,
		sourceChangeSetId: dryRun.sourceChangeSetId,
		sourceChangeSetVersion: dryRun.sourceChangeSetVersion,
		approval: {
			actor: dryRun.approvedBy,
			decidedAt: dryRun.approvedAt,
			contentDigest,
		},
		idempotencyKey,
		operations,
		skippedReviewOnlyProposalIds: dryRun.skippedReviewOnlyProposalIds,
	};
}
