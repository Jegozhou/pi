import { createHash } from "node:crypto";
import {
	assertSellerExecutionIdempotencyReservation,
	type SellerExecutionIdempotencyReservation,
	type SellerExecutionIdempotencyReservationResult,
	type SellerExecutionIdempotencyStore,
	type SellerExecutionReservation,
	sellerExecutionIdempotencyStorageKey,
} from "./idempotency-store.ts";

interface StoredReservation {
	requestDigest: string;
	reservation: SellerExecutionReservation;
}

function canonicalReservationPayload(request: SellerExecutionIdempotencyReservation): string {
	return JSON.stringify({
		accountScope: {
			marketplaceId: request.accountScope.marketplaceId,
			profileId: request.accountScope.profileId,
			region: request.accountScope.region,
		},
		approvedContentDigest: request.approvedContentDigest,
		authorizationContentDigest: request.authorizationContentDigest,
		planId: request.planId,
		planIdempotencyKey: request.planIdempotencyKey,
	});
}

function requestDigest(request: SellerExecutionIdempotencyReservation): string {
	return createHash("sha256").update(canonicalReservationPayload(request)).digest("hex");
}

function reservationFromRequest(request: SellerExecutionIdempotencyReservation): SellerExecutionReservation {
	const digest = requestDigest(request);
	return {
		id: `execres:${digest}`,
		accountScope: structuredClone(request.accountScope),
		planId: request.planId,
		planIdempotencyKey: request.planIdempotencyKey,
		approvedContentDigest: request.approvedContentDigest,
		authorizationContentDigest: request.authorizationContentDigest,
	};
}

export function createInMemorySellerExecutionIdempotencyStore(): SellerExecutionIdempotencyStore {
	const reservations = new Map<string, StoredReservation>();
	return {
		name: "in-memory-seller-execution-idempotency",
		async reserve(request): Promise<SellerExecutionIdempotencyReservationResult> {
			assertSellerExecutionIdempotencyReservation(request);
			const key = sellerExecutionIdempotencyStorageKey(request);
			const digest = requestDigest(request);
			const existing = reservations.get(key);
			if (existing) {
				if (existing.requestDigest !== digest) return { status: "conflict" };
				return { status: "replay", reservation: structuredClone(existing.reservation) };
			}

			const reservation = reservationFromRequest(request);
			reservations.set(key, { requestDigest: digest, reservation: structuredClone(reservation) });
			return { status: "reserved", reservation: structuredClone(reservation) };
		},
	};
}
