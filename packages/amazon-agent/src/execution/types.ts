export type SellerExecutionMode = "dry-run";

export type SellerExecutionCheck =
	| "approved-change-set"
	| "proposal-ready"
	| "target-id-present"
	| "campaign-id-present"
	| "ad-group-id-present"
	| "before-value-present"
	| "after-value-present";

export interface SellerBidDryRunOperation {
	proposalId: string;
	operation: "set-bid";
	targetId: string;
	before: { bid: number };
	after: { bid: number };
	checks: SellerExecutionCheck[];
}

export interface SellerNegativeExactDryRunOperation {
	proposalId: string;
	operation: "add-negative-exact";
	campaignId: string;
	adGroupId: string;
	negativeExact: string;
	checks: SellerExecutionCheck[];
}

export type SellerDryRunOperation = SellerBidDryRunOperation | SellerNegativeExactDryRunOperation;

export interface SellerExecutionDryRun {
	id: string;
	mode: SellerExecutionMode;
	sourceChangeSetId: string;
	sourceChangeSetVersion: number;
	approvedBy: string;
	approvedAt: string;
	writesPerformed: false;
	operations: SellerDryRunOperation[];
	skippedReviewOnlyProposalIds: string[];
}

export interface SellerExecutionDryRunOptions {
	expectedVersion?: number;
}
