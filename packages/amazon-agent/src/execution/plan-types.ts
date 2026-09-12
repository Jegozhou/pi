export interface SellerBidExecutionOperation {
	proposalId: string;
	operation: "set-bid";
	targetId: string;
	before: { bid: number };
	after: { bid: number };
	preconditions: { expectedCurrentBid: number };
	idempotencyKey: string;
}

export interface SellerNegativeExactExecutionOperation {
	proposalId: string;
	operation: "add-negative-exact";
	campaignId: string;
	adGroupId: string;
	negativeExact: string;
	preconditions: { mustNotAlreadyExist: true };
	idempotencyKey: string;
}

export type SellerExecutionOperation = SellerBidExecutionOperation | SellerNegativeExactExecutionOperation;

export interface SellerExecutionPlanApproval {
	actor: string;
	decidedAt: string;
	contentDigest: string;
}

export interface SellerExecutionPlan {
	id: string;
	sourceChangeSetId: string;
	sourceChangeSetVersion: number;
	approval: SellerExecutionPlanApproval;
	idempotencyKey: string;
	operations: SellerExecutionOperation[];
	skippedReviewOnlyProposalIds: string[];
}

export interface SellerExecutionPlanOptions {
	expectedVersion?: number;
}
