import type { SellerExecutionPlan } from "../execution/plan-types.ts";
import type { SellerAmazonAdsAccountScope } from "./account-scope.ts";
import {
	type SellerExecutionAuthorizationEnvelope,
	type SellerExecutionAuthorizationSecret,
	verifySellerExecutionAuthorizationEnvelope,
} from "./authorization.ts";
import type { SellerExecutionIdempotencyStore } from "./idempotency-store.ts";
import {
	preflightSellerExecutionState,
	type SellerLiveOperationPreflight,
} from "./preflight.ts";
import type { SellerExecutionStateReader } from "./state-reader.ts";

export type SellerLiveExecutionPreflightStatus =
	| "ready-for-live-adapter"
	| "already-desired"
	| "blocked-stale"
	| "blocked-unavailable"
	| "blocked-idempotency-conflict"
	| "replay";

export interface SellerLiveExecutionPreflight {
	status: SellerLiveExecutionPreflightStatus;
	accountScope: SellerAmazonAdsAccountScope;
	planId: string;
	planIdempotencyKey: string;
	sourceChangeSetId: string;
	sourceChangeSetVersion: number;
	approvedContentDigest: string;
	authorizationContentDigest: string;
	reservationId: string | null;
	operations: SellerLiveOperationPreflight[];
	externalWritesPerformed: false;
}

export interface SellerLiveExecutionPreflightOptions {
	now?: string;
}

function resultBase(
	plan: SellerExecutionPlan,
	accountScope: SellerAmazonAdsAccountScope,
	authorizationContentDigest: string,
	operations: SellerLiveOperationPreflight[],
): Omit<SellerLiveExecutionPreflight, "status" | "reservationId"> {
	return {
		accountScope: structuredClone(accountScope),
		planId: plan.id,
		planIdempotencyKey: plan.idempotencyKey,
		sourceChangeSetId: plan.sourceChangeSetId,
		sourceChangeSetVersion: plan.sourceChangeSetVersion,
		approvedContentDigest: plan.approval.contentDigest,
		authorizationContentDigest,
		operations: structuredClone(operations),
		externalWritesPerformed: false,
	};
}

export async function buildSellerLiveExecutionPreflight(
	plan: SellerExecutionPlan,
	authorizationEnvelope: SellerExecutionAuthorizationEnvelope,
	authorizationSecret: SellerExecutionAuthorizationSecret,
	stateReader: SellerExecutionStateReader,
	idempotencyStore: SellerExecutionIdempotencyStore,
	options: SellerLiveExecutionPreflightOptions = {},
): Promise<SellerLiveExecutionPreflight> {
	const authorization = verifySellerExecutionAuthorizationEnvelope(
		authorizationEnvelope,
		plan,
		authorizationSecret,
		options.now !== undefined ? { now: options.now } : {},
	);
	const statePreflight = await preflightSellerExecutionState(plan, authorization.accountScope, stateReader);
	const base = resultBase(plan, authorization.accountScope, authorizationEnvelope.proof.contentDigest, statePreflight.operations);

	if (statePreflight.status === "blocked-unavailable") {
		return { ...base, status: "blocked-unavailable", reservationId: null };
	}
	if (statePreflight.status === "blocked-stale") {
		return { ...base, status: "blocked-stale", reservationId: null };
	}
	if (statePreflight.operations.every((operation) => operation.status === "already-desired")) {
		return { ...base, status: "already-desired", reservationId: null };
	}

	const reservation = await idempotencyStore.reserve({
		accountScope: authorization.accountScope,
		planId: plan.id,
		planIdempotencyKey: plan.idempotencyKey,
		approvedContentDigest: plan.approval.contentDigest,
		authorizationContentDigest: authorizationEnvelope.proof.contentDigest,
	});
	if (reservation.status === "conflict") {
		return { ...base, status: "blocked-idempotency-conflict", reservationId: null };
	}
	return {
		...base,
		status: reservation.status === "replay" ? "replay" : "ready-for-live-adapter",
		reservationId: reservation.reservation.id,
	};
}
