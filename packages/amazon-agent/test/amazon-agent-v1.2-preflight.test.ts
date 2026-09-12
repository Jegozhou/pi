import { describe, expect, it } from "vitest";
import {
	preflightSellerExecutionState,
	type SellerAmazonAdsAccountScope,
	type SellerExecutionOperation,
	type SellerExecutionPlan,
	type SellerExecutionStateReader,
	type SellerTrustedOperationState,
} from "../src/index.ts";

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

function plan(operations: SellerExecutionOperation[]): SellerExecutionPlan {
	return {
		id: "execplan:v1.2-preflight",
		sourceChangeSetId: "changeset:v1.2-preflight",
		sourceChangeSetVersion: 4,
		approval: {
			actor: "seller-owner",
			decidedAt: "2026-09-13T03:00:00.000Z",
			contentDigest: "digest-preflight",
		},
		idempotencyKey: "execplan:v1.2-preflight",
		operations,
		skippedReviewOnlyProposalIds: [],
	};
}

function readerFor(
	read: (operation: SellerExecutionOperation) => Promise<SellerTrustedOperationState>,
): SellerExecutionStateReader {
	return {
		async readOperationState(receivedScope, operation) {
			expect(receivedScope).toEqual(scope());
			return read(operation);
		},
	};
}

describe("Amazon Seller Agent V1.2 trusted state preflight", () => {
	it("marks an exact current-bid match ready", async () => {
		const result = await preflightSellerExecutionState(
			plan([bidOperation()]),
			scope(),
			readerFor(async () => ({ operation: "set-bid", status: "available", currentBid: 1.2 })),
		);
		expect(result.status).toBe("ready");
		expect(result.operations).toEqual([
			expect.objectContaining({ proposalId: "change:bid", operation: "set-bid", status: "ready" }),
		]);
		expect(result.externalWritesPerformed).toBe(false);
	});

	it("treats a bid already at the approved after-value as already desired", async () => {
		const result = await preflightSellerExecutionState(
			plan([bidOperation()]),
			scope(),
			readerFor(async () => ({ operation: "set-bid", status: "available", currentBid: 0.96 })),
		);
		expect(result.status).toBe("ready");
		expect(result.operations[0]).toMatchObject({ status: "already-desired", observed: { currentBid: 0.96 } });
	});

	it("blocks a stale bid instead of overwriting it", async () => {
		const result = await preflightSellerExecutionState(
			plan([bidOperation()]),
			scope(),
			readerFor(async () => ({ operation: "set-bid", status: "available", currentBid: 0.8 })),
		);
		expect(result.status).toBe("blocked-stale");
		expect(result.operations[0]).toMatchObject({ status: "blocked-stale", observed: { currentBid: 0.8 } });
		expect(result.externalWritesPerformed).toBe(false);
	});

	it("treats an existing scoped exact negative as already desired", async () => {
		const result = await preflightSellerExecutionState(
			plan([negativeOperation()]),
			scope(),
			readerFor(async () => ({ operation: "add-negative-exact", status: "available", exists: true })),
		);
		expect(result.status).toBe("ready");
		expect(result.operations[0]).toMatchObject({ status: "already-desired", observed: { exists: true } });
	});

	it("marks a missing scoped exact negative ready to add", async () => {
		const result = await preflightSellerExecutionState(
			plan([negativeOperation()]),
			scope(),
			readerFor(async () => ({ operation: "add-negative-exact", status: "available", exists: false })),
		);
		expect(result.status).toBe("ready");
		expect(result.operations[0]).toMatchObject({ status: "ready", observed: { exists: false } });
	});

	it("blocks unavailable trusted state", async () => {
		const result = await preflightSellerExecutionState(
			plan([bidOperation()]),
			scope(),
			readerFor(async () => ({ operation: "set-bid", status: "unavailable", reason: "target not returned" })),
		);
		expect(result.status).toBe("blocked-unavailable");
		expect(result.operations[0]).toMatchObject({ status: "blocked-unavailable" });
	});

	it("fails the whole batch closed when one operation is stale", async () => {
		const result = await preflightSellerExecutionState(
			plan([bidOperation(), negativeOperation()]),
			scope(),
			readerFor(async (operation) =>
				operation.operation === "set-bid"
					? { operation: "set-bid", status: "available", currentBid: 0.8 }
					: { operation: "add-negative-exact", status: "available", exists: false },
			),
		);
		expect(result.status).toBe("blocked-stale");
		expect(result.operations.map((operation) => operation.status)).toEqual(["blocked-stale", "ready"]);
		expect(result.externalWritesPerformed).toBe(false);
	});

	it("converts a trusted-reader exception into an explicit unavailable block", async () => {
		const result = await preflightSellerExecutionState(
			plan([negativeOperation()]),
			scope(),
			readerFor(async () => {
				throw new Error("temporary read failure");
			}),
		);
		expect(result.status).toBe("blocked-unavailable");
		expect(result.operations[0]).toMatchObject({ status: "blocked-unavailable" });
		expect(result.operations[0]?.message).toMatch(/read failure|unavailable/i);
	});

	it("blocks a reader response for the wrong operation kind", async () => {
		const result = await preflightSellerExecutionState(
			plan([bidOperation()]),
			scope(),
			readerFor(async () => ({ operation: "add-negative-exact", status: "available", exists: false })),
		);
		expect(result.status).toBe("blocked-unavailable");
		expect(result.operations[0]?.message).toMatch(/mismatch|operation/i);
	});
});
