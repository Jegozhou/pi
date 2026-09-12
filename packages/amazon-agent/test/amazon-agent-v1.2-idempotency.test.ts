import { describe, expect, it } from "vitest";
import {
	createInMemorySellerExecutionIdempotencyStore,
	type SellerAmazonAdsAccountScope,
	type SellerExecutionIdempotencyReservation,
	sellerExecutionIdempotencyStorageKey,
} from "../src/index.ts";

function scope(profileId = "9876543210"): SellerAmazonAdsAccountScope {
	return { profileId, marketplaceId: "ATVPDKIKX0DER", region: "NA" };
}

function request(
	overrides: Partial<SellerExecutionIdempotencyReservation> = {},
): SellerExecutionIdempotencyReservation {
	return {
		accountScope: scope(),
		planId: "execplan:v1.2-idempotency",
		planIdempotencyKey: "execplan:v1.2-idempotency",
		approvedContentDigest: "approved-digest",
		authorizationContentDigest: "authorization-digest",
		...overrides,
	};
}

describe("Amazon Seller Agent V1.2 trusted idempotency store", () => {
	it("reserves an account-scoped plan exactly once", async () => {
		const store = createInMemorySellerExecutionIdempotencyStore();
		const result = await store.reserve(request());

		expect(store.name).toBe("in-memory-seller-execution-idempotency");
		expect(result.status).toBe("reserved");
		if (result.status !== "reserved") throw new Error("expected reserved");
		expect(result.reservation).toMatchObject({
			accountScope: scope(),
			planId: "execplan:v1.2-idempotency",
			planIdempotencyKey: "execplan:v1.2-idempotency",
			approvedContentDigest: "approved-digest",
			authorizationContentDigest: "authorization-digest",
		});
		expect(result.reservation.id).toMatch(/^execres:/);
	});

	it("returns replay with the same reservation for identical content", async () => {
		const store = createInMemorySellerExecutionIdempotencyStore();
		const first = await store.reserve(request());
		const second = await store.reserve(request());

		expect(first.status).toBe("reserved");
		expect(second.status).toBe("replay");
		if (first.status !== "reserved" || second.status !== "replay") throw new Error("unexpected status");
		expect(second.reservation).toEqual(first.reservation);
	});

	it("returns conflict when the same scoped key is reused for different authorized content", async () => {
		const store = createInMemorySellerExecutionIdempotencyStore();
		await store.reserve(request());
		const conflict = await store.reserve(request({ authorizationContentDigest: "different-authorization" }));
		expect(conflict).toEqual({ status: "conflict" });
	});

	it("does not let one advertiser profile consume another profile's reservation", async () => {
		const store = createInMemorySellerExecutionIdempotencyStore();
		const first = await store.reserve(request({ accountScope: scope("1111111111") }));
		const second = await store.reserve(request({ accountScope: scope("2222222222") }));

		expect(first.status).toBe("reserved");
		expect(second.status).toBe("reserved");
		if (first.status !== "reserved" || second.status !== "reserved") throw new Error("expected two reservations");
		expect(first.reservation.id).not.toBe(second.reservation.id);
	});

	it("uses account scope plus plan key as the storage namespace", () => {
		const left = sellerExecutionIdempotencyStorageKey(request({ accountScope: scope("1111111111") }));
		const same = sellerExecutionIdempotencyStorageKey(request({ accountScope: scope("1111111111") }));
		const otherAccount = sellerExecutionIdempotencyStorageKey(request({ accountScope: scope("2222222222") }));
		const otherPlan = sellerExecutionIdempotencyStorageKey(request({ planIdempotencyKey: "execplan:other" }));

		expect(left).toBe(same);
		expect(left).not.toBe(otherAccount);
		expect(left).not.toBe(otherPlan);
	});

	it("rejects blank or inconsistent reservation identity", async () => {
		const store = createInMemorySellerExecutionIdempotencyStore();
		await expect(store.reserve(request({ planId: "" }))).rejects.toThrow(/plan/i);
		await expect(store.reserve(request({ planIdempotencyKey: "   " }))).rejects.toThrow(/idempotency/i);
		await expect(store.reserve(request({ approvedContentDigest: "" }))).rejects.toThrow(/digest/i);
		await expect(store.reserve(request({ authorizationContentDigest: "" }))).rejects.toThrow(/authorization|digest/i);
	});

	it("does not mutate the caller request or expose mutable stored reservation state", async () => {
		const store = createInMemorySellerExecutionIdempotencyStore();
		const input = request();
		const before = structuredClone(input);
		const first = await store.reserve(input);
		expect(input).toEqual(before);
		if (first.status !== "reserved") throw new Error("expected reserved");

		first.reservation.accountScope.profileId = "tampered";
		const replay = await store.reserve(request());
		expect(replay.status).toBe("replay");
		if (replay.status !== "replay") throw new Error("expected replay");
		expect(replay.reservation.accountScope.profileId).toBe("9876543210");
	});

	it("creates a deterministic reservation ID for identical reservation content", async () => {
		const firstStore = createInMemorySellerExecutionIdempotencyStore();
		const secondStore = createInMemorySellerExecutionIdempotencyStore();
		const first = await firstStore.reserve(request());
		const second = await secondStore.reserve(request());

		if (first.status !== "reserved" || second.status !== "reserved") throw new Error("expected reserved");
		expect(first.reservation.id).toBe(second.reservation.id);
	});
});
