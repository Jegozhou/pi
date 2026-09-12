import type { SellerAmazonAdsAccountScope } from "./account-scope.ts";
import { assertSellerAmazonAdsAccountScope, sellerAmazonAdsAccountScopeKey } from "./account-scope.ts";

export interface SellerExecutionIdempotencyReservation {
	accountScope: SellerAmazonAdsAccountScope;
	planId: string;
	planIdempotencyKey: string;
	approvedContentDigest: string;
	authorizationContentDigest: string;
}

export interface SellerExecutionReservation extends SellerExecutionIdempotencyReservation {
	id: string;
}

export type SellerExecutionIdempotencyReservationResult =
	| { status: "reserved"; reservation: SellerExecutionReservation }
	| { status: "replay"; reservation: SellerExecutionReservation }
	| { status: "conflict" };

export interface SellerExecutionIdempotencyStore {
	readonly name: string;
	reserve(request: SellerExecutionIdempotencyReservation): Promise<SellerExecutionIdempotencyReservationResult>;
}

function assertNonBlank(value: string, label: string): void {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
}

export function assertSellerExecutionIdempotencyReservation(request: SellerExecutionIdempotencyReservation): void {
	if (!request || typeof request !== "object") {
		throw new Error("Execution idempotency reservation request is required");
	}
	assertSellerAmazonAdsAccountScope(request.accountScope);
	assertNonBlank(request.planId, "Execution plan ID");
	assertNonBlank(request.planIdempotencyKey, "Execution plan idempotency key");
	assertNonBlank(request.approvedContentDigest, "Approved content digest");
	assertNonBlank(request.authorizationContentDigest, "Execution authorization content digest");
}

export function sellerExecutionIdempotencyStorageKey(request: SellerExecutionIdempotencyReservation): string {
	assertSellerExecutionIdempotencyReservation(request);
	return JSON.stringify([sellerAmazonAdsAccountScopeKey(request.accountScope), request.planIdempotencyKey]);
}
