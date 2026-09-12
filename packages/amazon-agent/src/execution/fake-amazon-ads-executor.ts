import type {
	FakeAmazonAdsExecutorOptions,
	FakeAmazonAdsState,
	SellerExecutionAdapter,
	SellerExecutionOperationReceipt,
	SellerExecutionReceipt,
} from "./adapter.ts";
import type { SellerExecutionOperation, SellerExecutionPlan } from "./plan-types.ts";

export function fakeNegativeExactScopeKey(campaignId: string, adGroupId: string, negativeExact: string): string {
	return JSON.stringify([campaignId, adGroupId, negativeExact]);
}

function executeBid(
	state: FakeAmazonAdsState,
	operation: Extract<SellerExecutionOperation, { operation: "set-bid" }>,
): SellerExecutionOperationReceipt {
	const currentBid = state.bidsByTargetId.get(operation.targetId);
	if (currentBid !== operation.preconditions.expectedCurrentBid) {
		return {
			proposalId: operation.proposalId,
			operation: operation.operation,
			idempotencyKey: operation.idempotencyKey,
			status: "blocked-stale",
			message: `Expected current bid ${operation.preconditions.expectedCurrentBid}, received ${String(currentBid)}`,
		};
	}

	state.bidsByTargetId.set(operation.targetId, operation.after.bid);
	return {
		proposalId: operation.proposalId,
		operation: operation.operation,
		idempotencyKey: operation.idempotencyKey,
		status: "applied",
		message: `Fake bid changed from ${operation.before.bid} to ${operation.after.bid}`,
	};
}

function executeNegativeExact(
	state: FakeAmazonAdsState,
	operation: Extract<SellerExecutionOperation, { operation: "add-negative-exact" }>,
): SellerExecutionOperationReceipt {
	const scopeKey = fakeNegativeExactScopeKey(operation.campaignId, operation.adGroupId, operation.negativeExact);
	if (state.negativeExactByScope.has(scopeKey)) {
		return {
			proposalId: operation.proposalId,
			operation: operation.operation,
			idempotencyKey: operation.idempotencyKey,
			status: "already-applied",
			message: "Exact negative already exists in fake state",
		};
	}

	state.negativeExactByScope.add(scopeKey);
	return {
		proposalId: operation.proposalId,
		operation: operation.operation,
		idempotencyKey: operation.idempotencyKey,
		status: "applied",
		message: "Exact negative added to fake state",
	};
}

function executeOperation(
	state: FakeAmazonAdsState,
	operation: SellerExecutionOperation,
): SellerExecutionOperationReceipt {
	return operation.operation === "set-bid" ? executeBid(state, operation) : executeNegativeExact(state, operation);
}

function simulatedFailure(operation: SellerExecutionOperation): SellerExecutionOperationReceipt {
	return {
		proposalId: operation.proposalId,
		operation: operation.operation,
		idempotencyKey: operation.idempotencyKey,
		status: "simulated-failure",
		message: "Forced fake execution failure",
	};
}

function skippedAfterFailure(operation: SellerExecutionOperation): SellerExecutionOperationReceipt {
	return {
		proposalId: operation.proposalId,
		operation: operation.operation,
		idempotencyKey: operation.idempotencyKey,
		status: "skipped-after-failure",
		message: "Skipped because an earlier fake execution operation failed",
	};
}

export function createFakeAmazonAdsExecutor(
	state: FakeAmazonAdsState,
	options: FakeAmazonAdsExecutorOptions = {},
): SellerExecutionAdapter {
	return {
		name: "fake-amazon-ads",
		async execute(plan: SellerExecutionPlan): Promise<SellerExecutionReceipt> {
			const cached = state.processedPlanKeys.get(plan.idempotencyKey);
			if (cached) {
				return structuredClone(cached);
			}

			const operations: SellerExecutionOperationReceipt[] = [];
			let failed = false;
			for (const operation of plan.operations) {
				if (failed) {
					operations.push(skippedAfterFailure(operation));
					continue;
				}
				if (options.failProposalIds?.has(operation.proposalId)) {
					operations.push(simulatedFailure(operation));
					failed = true;
					continue;
				}
				operations.push(executeOperation(state, operation));
			}

			const receipt: SellerExecutionReceipt = {
				planId: plan.id,
				planIdempotencyKey: plan.idempotencyKey,
				adapterName: "fake-amazon-ads",
				externalWritesPerformed: false,
				operations,
			};
			state.processedPlanKeys.set(plan.idempotencyKey, structuredClone(receipt));
			return receipt;
		},
	};
}
