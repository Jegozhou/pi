import { describe, expect, it } from "vitest";
import {
	buildSellerLiveExecutionPreflight,
	createInMemorySellerExecutionIdempotencyStore,
	createSellerExecutionAuthorizationEnvelope,
	type SellerAmazonAdsAccountScope,
	type SellerExecutionIdempotencyReservation,
	type SellerExecutionIdempotencyReservationResult,
	type SellerExecutionIdempotencyStore,
	type SellerExecutionOperation,
	type SellerExecutionPlan,
	type SellerExecutionStateReader,
	type SellerTrustedOperationState,
} from "../src/index.ts";

const SECRET = new TextEncoder().encode("amazon-agent-v1.2-live-preflight-secret");

function scope(): SellerAmazonAdsAccountScope {
	return { profileId: "9876543210", marketplaceId: "ATVPDKIKX0DER", region: "NA" };
}

function bidOperation(): Extract<SellerExecutionOperation, { operation: "set-bid" }> {
	return {
		proposalId: "change:bid",
		operation: "set-bid",
		targetId: "3001",
		before: { bid: 1.2 },
		after: { bid: 0.96 },
		preconditions: { expectedCurrentBid: 1.2 },
		idempotencyKey: "execop:bid",
	};
}

function negativeOperation(): Extract<SellerExecutionOperation, { operation: "add-negative-exact" }> {
	return {
		proposalId: "change:negative",
		operation: "add-negative-exact",
		campaignId: "1001",
		adGroupId: "2001",
		negativeExact: "free trail shoes",
		preconditions: { mustNotAlreadyExist: true },
		idempotencyKey: "execop:negative",
	};
}

function plan(operations: SellerExecutionOperation[] = [bidOperation(), negativeOperation()]): SellerExecutionPlan {
	return {
		id: "execplan:v1.2-live",
		sourceChangeSetId: "changeset:v1.2-live",
		sourceChangeSetVersion: 4,
		approval: {
			actor: "seller-owner",
			decidedAt: "2026-09-13T03:00:00.000Z",
			contentDigest: "approved-live-digest",
		},
		idempotencyKey: "execplan:v1.2-live",
		operations,
		skippedReviewOnlyProposalIds: [],
	};
}

function authorization(executionPlan = plan()) {
	return createSellerExecutionAuthorizationEnvelope(executionPlan, scope(), SECRET, {
		issuedAt: "2026-09-13T03:05:00.000Z",
		expiresAt: "2026-09-13T03:15:00.000Z",
		nonce: "nonce-live-preflight",
	});
}

function readerFor(
	read: (operation: SellerExecutionOperation) => Promise<SellerTrustedOperationState>,
	onRead?: () => void,
): SellerExecutionStateReader {
	return {
		async readOperationState(receivedScope, operation) {
			expect(receivedScope).toEqual(scope());
			onRead?.();
			return read(operation);
		},
	};
}

function readyReader(onRead?: () => void): SellerExecutionStateReader {
	return readerFor(
		async (operation) =>
			operation.operation === "set-bid"
				? { operation: "set-bid", status: "available", currentBid: 1.2 }
				: { operation: "add-negative-exact", status: "available", exists: false },
		onRead,
	);
}

function storeSpy(
	reserveResult: SellerExecutionIdempotencyReservationResult = {
		status: "conflict",
	},
): { store: SellerExecutionIdempotencyStore; requests: SellerExecutionIdempotencyReservation[] } {
	const requests: SellerExecutionIdempotencyReservation[] = [];
	return {
		requests,
		store: {
			name: "test-store",
			async reserve(request) {
				requests.push(structuredClone(request));
				return structuredClone(reserveResult);
			},
		},
	};
}

describe("Amazon Seller Agent V1.2 live execution preflight", () => {
	it("returns ready-for-live-adapter only after verified auth, trusted state, and scoped reservation", async () => {
		const executionPlan = plan();
		const store = createInMemorySellerExecutionIdempotencyStore();
		const result = await buildSellerLiveExecutionPreflight(
			executionPlan,
			authorization(executionPlan),
			SECRET,
			readyReader(),
			store,
			{ now: "2026-09-13T03:10:00.000Z" },
		);

		expect(result).toMatchObject({
			status: "ready-for-live-adapter",
			accountScope: scope(),
			planId: executionPlan.id,
			planIdempotencyKey: executionPlan.idempotencyKey,
			externalWritesPerformed: false,
		});
		expect(result.reservationId).toMatch(/^execres:/);
		expect(result.operations.map((operation) => operation.status)).toEqual(["ready", "ready"]);
	});

	it("stops before trusted state reads or reservation when authorization is expired", async () => {
		const executionPlan = plan();
		let reads = 0;
		const { store, requests } = storeSpy();
		await expect(
			buildSellerLiveExecutionPreflight(
				executionPlan,
				authorization(executionPlan),
				SECRET,
				readyReader(() => {
					reads += 1;
				}),
				store,
				{ now: "2026-09-13T03:16:00.000Z" },
			),
		).rejects.toThrow(/expired/i);
		expect(reads).toBe(0);
		expect(requests).toHaveLength(0);
	});

	it("rejects account-scope tampering before trusted reads", async () => {
		const executionPlan = plan();
		const envelope = authorization(executionPlan);
		envelope.authorization.accountScope.profileId = "1111111111";
		let reads = 0;
		const { store, requests } = storeSpy();
		await expect(
			buildSellerLiveExecutionPreflight(
				executionPlan,
				envelope,
				SECRET,
				readyReader(() => {
					reads += 1;
				}),
				store,
				{ now: "2026-09-13T03:10:00.000Z" },
			),
		).rejects.toThrow(/digest|signature|tamper/i);
		expect(reads).toBe(0);
		expect(requests).toHaveLength(0);
	});

	it("rejects an authorization envelope bound to a different plan", async () => {
		const executionPlan = plan();
		const other = structuredClone(executionPlan);
		other.id = "execplan:other";
		other.idempotencyKey = "execplan:other";
		const { store, requests } = storeSpy();
		await expect(
			buildSellerLiveExecutionPreflight(executionPlan, authorization(other), SECRET, readyReader(), store, {
				now: "2026-09-13T03:10:00.000Z",
			}),
		).rejects.toThrow(/plan|identity|mismatch/i);
		expect(requests).toHaveLength(0);
	});

	it("blocks the full batch on stale state and does not reserve idempotency", async () => {
		const executionPlan = plan();
		const { store, requests } = storeSpy();
		const result = await buildSellerLiveExecutionPreflight(
			executionPlan,
			authorization(executionPlan),
			SECRET,
			readerFor(async (operation) =>
				operation.operation === "set-bid"
					? { operation: "set-bid", status: "available", currentBid: 0.8 }
					: { operation: "add-negative-exact", status: "available", exists: false },
			),
			store,
			{ now: "2026-09-13T03:10:00.000Z" },
		);
		expect(result.status).toBe("blocked-stale");
		expect(result.reservationId).toBeNull();
		expect(requests).toHaveLength(0);
		expect(result.externalWritesPerformed).toBe(false);
	});

	it("blocks the full batch on unavailable state and does not reserve idempotency", async () => {
		const executionPlan = plan([negativeOperation()]);
		const { store, requests } = storeSpy();
		const result = await buildSellerLiveExecutionPreflight(
			executionPlan,
			authorization(executionPlan),
			SECRET,
			readerFor(async () => ({ operation: "add-negative-exact", status: "unavailable", reason: "read timeout" })),
			store,
			{ now: "2026-09-13T03:10:00.000Z" },
		);
		expect(result.status).toBe("blocked-unavailable");
		expect(requests).toHaveLength(0);
	});

	it("does not reserve or invoke a live adapter when every operation is already desired", async () => {
		const executionPlan = plan();
		const { store, requests } = storeSpy();
		const result = await buildSellerLiveExecutionPreflight(
			executionPlan,
			authorization(executionPlan),
			SECRET,
			readerFor(async (operation) =>
				operation.operation === "set-bid"
					? { operation: "set-bid", status: "available", currentBid: 0.96 }
					: { operation: "add-negative-exact", status: "available", exists: true },
			),
			store,
			{ now: "2026-09-13T03:10:00.000Z" },
		);
		expect(result.status).toBe("already-desired");
		expect(result.reservationId).toBeNull();
		expect(requests).toHaveLength(0);
	});

	it("returns replay when the same scoped authorized plan was already reserved", async () => {
		const executionPlan = plan();
		const store = createInMemorySellerExecutionIdempotencyStore();
		const first = await buildSellerLiveExecutionPreflight(
			executionPlan,
			authorization(executionPlan),
			SECRET,
			readyReader(),
			store,
			{ now: "2026-09-13T03:10:00.000Z" },
		);
		const second = await buildSellerLiveExecutionPreflight(
			executionPlan,
			authorization(executionPlan),
			SECRET,
			readyReader(),
			store,
			{ now: "2026-09-13T03:10:00.000Z" },
		);
		expect(first.status).toBe("ready-for-live-adapter");
		expect(second.status).toBe("replay");
		expect(second.reservationId).toBe(first.reservationId);
	});

	it("blocks an idempotency conflict after trusted state passes", async () => {
		const executionPlan = plan();
		const { store, requests } = storeSpy({ status: "conflict" });
		const result = await buildSellerLiveExecutionPreflight(
			executionPlan,
			authorization(executionPlan),
			SECRET,
			readyReader(),
			store,
			{ now: "2026-09-13T03:10:00.000Z" },
		);
		expect(result.status).toBe("blocked-idempotency-conflict");
		expect(result.reservationId).toBeNull();
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			accountScope: scope(),
			planId: executionPlan.id,
			planIdempotencyKey: executionPlan.idempotencyKey,
			approvedContentDigest: executionPlan.approval.contentDigest,
		});
	});
});
