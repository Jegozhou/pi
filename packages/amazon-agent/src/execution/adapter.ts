import type { SellerExecutionPlan } from "./plan-types.ts";

export type SellerExecutionOperationStatus =
	| "applied"
	| "blocked-stale"
	| "already-applied"
	| "simulated-failure"
	| "skipped-after-failure";

export interface SellerExecutionOperationReceipt {
	proposalId: string;
	operation: "set-bid" | "add-negative-exact";
	idempotencyKey: string;
	status: SellerExecutionOperationStatus;
	message: string;
}

export interface SellerExecutionReceipt {
	planId: string;
	planIdempotencyKey: string;
	adapterName: string;
	externalWritesPerformed: false;
	operations: SellerExecutionOperationReceipt[];
}

export interface SellerExecutionAdapter {
	readonly name: string;
	execute(plan: SellerExecutionPlan): Promise<SellerExecutionReceipt>;
}

export interface FakeAmazonAdsState {
	bidsByTargetId: Map<string, number>;
	negativeExactByScope: Set<string>;
	processedPlanKeys: Map<string, SellerExecutionReceipt>;
}

export interface FakeAmazonAdsExecutorOptions {
	failProposalIds?: ReadonlySet<string>;
}
