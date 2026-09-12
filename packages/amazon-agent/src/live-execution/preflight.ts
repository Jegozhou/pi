import type { SellerExecutionOperation, SellerExecutionPlan } from "../execution/plan-types.ts";
import { assertSellerAmazonAdsAccountScope, type SellerAmazonAdsAccountScope } from "./account-scope.ts";
import type { SellerExecutionStateReader, SellerTrustedOperationState } from "./state-reader.ts";

export type SellerLiveOperationPreflightStatus =
	| "ready"
	| "already-desired"
	| "blocked-stale"
	| "blocked-unavailable";

export type SellerLiveOperationObservedState = { currentBid: number } | { exists: boolean } | null;

export interface SellerLiveOperationPreflight {
	proposalId: string;
	operation: SellerExecutionOperation["operation"];
	status: SellerLiveOperationPreflightStatus;
	observed: SellerLiveOperationObservedState;
	message: string;
}

export type SellerExecutionStatePreflightStatus = "ready" | "blocked-stale" | "blocked-unavailable";

export interface SellerExecutionStatePreflight {
	status: SellerExecutionStatePreflightStatus;
	accountScope: SellerAmazonAdsAccountScope;
	planId: string;
	operations: SellerLiveOperationPreflight[];
	externalWritesPerformed: false;
}

function unavailable(operation: SellerExecutionOperation, message: string): SellerLiveOperationPreflight {
	return {
		proposalId: operation.proposalId,
		operation: operation.operation,
		status: "blocked-unavailable",
		observed: null,
		message,
	};
}

function preflightBid(
	operation: Extract<SellerExecutionOperation, { operation: "set-bid" }>,
	state: SellerTrustedOperationState,
): SellerLiveOperationPreflight {
	if (state.operation !== "set-bid") {
		return unavailable(operation, `Trusted state operation mismatch: expected set-bid, received ${state.operation}`);
	}
	if (state.status === "unavailable") {
		return unavailable(operation, `Trusted bid state unavailable: ${state.reason}`);
	}
	if (!Number.isFinite(state.currentBid) || state.currentBid <= 0) {
		return unavailable(operation, "Trusted bid state returned an invalid current bid");
	}
	const observed = { currentBid: state.currentBid };
	if (state.currentBid === operation.preconditions.expectedCurrentBid) {
		return {
			proposalId: operation.proposalId,
			operation: operation.operation,
			status: "ready",
			observed,
			message: `Trusted current bid matches expected before-value ${operation.preconditions.expectedCurrentBid}`,
		};
	}
	if (state.currentBid === operation.after.bid) {
		return {
			proposalId: operation.proposalId,
			operation: operation.operation,
			status: "already-desired",
			observed,
			message: `Trusted current bid already equals approved after-value ${operation.after.bid}`,
		};
	}
	return {
		proposalId: operation.proposalId,
		operation: operation.operation,
		status: "blocked-stale",
		observed,
		message: `Trusted current bid ${state.currentBid} differs from expected before-value ${operation.preconditions.expectedCurrentBid}`,
	};
}

function preflightNegativeExact(
	operation: Extract<SellerExecutionOperation, { operation: "add-negative-exact" }>,
	state: SellerTrustedOperationState,
): SellerLiveOperationPreflight {
	if (state.operation !== "add-negative-exact") {
		return unavailable(
			operation,
			`Trusted state operation mismatch: expected add-negative-exact, received ${state.operation}`,
		);
	}
	if (state.status === "unavailable") {
		return unavailable(operation, `Trusted negative-exact state unavailable: ${state.reason}`);
	}
	if (typeof state.exists !== "boolean") {
		return unavailable(operation, "Trusted negative-exact state returned an invalid existence flag");
	}
	const observed = { exists: state.exists };
	if (state.exists) {
		return {
			proposalId: operation.proposalId,
			operation: operation.operation,
			status: "already-desired",
			observed,
			message: "Approved exact negative already exists in the trusted account scope",
		};
	}
	return {
		proposalId: operation.proposalId,
		operation: operation.operation,
		status: "ready",
		observed,
		message: "Approved exact negative is absent in the trusted account scope",
	};
}

async function preflightOperation(
	accountScope: SellerAmazonAdsAccountScope,
	operation: SellerExecutionOperation,
	reader: SellerExecutionStateReader,
): Promise<SellerLiveOperationPreflight> {
	let state: SellerTrustedOperationState;
	try {
		state = await reader.readOperationState(structuredClone(accountScope), structuredClone(operation));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return unavailable(operation, `Trusted state read failure: ${message}`);
	}
	return operation.operation === "set-bid"
		? preflightBid(operation, state)
		: preflightNegativeExact(operation, state);
}

function batchStatus(operations: SellerLiveOperationPreflight[]): SellerExecutionStatePreflightStatus {
	if (operations.some((operation) => operation.status === "blocked-unavailable")) return "blocked-unavailable";
	if (operations.some((operation) => operation.status === "blocked-stale")) return "blocked-stale";
	return "ready";
}

export async function preflightSellerExecutionState(
	plan: SellerExecutionPlan,
	accountScope: SellerAmazonAdsAccountScope,
	reader: SellerExecutionStateReader,
): Promise<SellerExecutionStatePreflight> {
	assertSellerAmazonAdsAccountScope(accountScope);
	if (!plan || typeof plan !== "object" || !Array.isArray(plan.operations)) {
		throw new Error("Execution plan with operations is required for trusted state preflight");
	}
	const operations: SellerLiveOperationPreflight[] = [];
	for (const operation of plan.operations) {
		operations.push(await preflightOperation(accountScope, operation, reader));
	}
	return {
		status: batchStatus(operations),
		accountScope: structuredClone(accountScope),
		planId: plan.id,
		operations,
		externalWritesPerformed: false,
	};
}
