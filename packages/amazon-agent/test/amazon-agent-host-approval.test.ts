import { describe, expect, it } from "vitest";
import { confirmSellerChangeSetDecision } from "../../../.pi/extensions/amazon-seller/approval-flow.ts";
import { type SellerChangeProposal, type SellerChangeSet, verifySellerApprovalEnvelope } from "../src/index.ts";

function readyProposal(): SellerChangeProposal {
	return {
		id: "change:host-approval",
		sourceActionItemId: "action:host-approval",
		sourceFindingId: "finding:host-approval",
		sourceRuleId: "ppc.high-acos.v1",
		operation: "set-bid",
		readiness: "ready",
		entity: { type: "search-term", value: "trail shoes" },
		rationale: "Reduce bid under guarded policy.",
		evidence: [{ sourceFile: "search.csv", sourceRow: 2 }],
		missingInputs: [],
		before: { campaignId: "1001", adGroupId: "2001", targetId: "3001", currentBid: 1.2 },
		after: { campaignId: "1001", adGroupId: "2001", targetId: "3001", proposedBid: 0.96 },
		humanApprovalRequired: true,
	};
}

function awaitingChangeSet(): SellerChangeSet {
	return {
		id: "changeset:host-approval",
		version: 3,
		status: "awaiting-approval",
		sourceActionItemIds: ["action:host-approval"],
		proposals: [readyProposal()],
		decision: null,
	};
}

describe("Amazon host approval flow", () => {
	it("fails when the host has no dialog-capable UI", async () => {
		await expect(
			confirmSellerChangeSetDecision({
				changeSet: awaitingChangeSet(),
				decision: "approve",
				secret: new TextEncoder().encode("host-secret"),
				host: { hasUI: false, confirm: async () => true },
			}),
		).rejects.toThrow(/host ui|dialog/i);
	});

	it("fails when the human declines the confirmation dialog", async () => {
		let confirmations = 0;
		await expect(
			confirmSellerChangeSetDecision({
				changeSet: awaitingChangeSet(),
				decision: "approve",
				secret: new TextEncoder().encode("host-secret"),
				host: {
					hasUI: true,
					confirm: async () => {
						confirmations += 1;
						return false;
					},
				},
			}),
		).rejects.toThrow(/did not confirm|cancel/i);
		expect(confirmations).toBe(1);
	});

	it("uses host confirmation and host time to create a verifiable signed envelope", async () => {
		const secret = new TextEncoder().encode("host-secret");
		let title = "";
		let message = "";
		const result = await confirmSellerChangeSetDecision({
			changeSet: awaitingChangeSet(),
			decision: "approve",
			secret,
			now: () => "2026-09-13T00:00:00.000Z",
			host: {
				hasUI: true,
				confirm: async (nextTitle, nextMessage) => {
					title = nextTitle;
					message = nextMessage;
					return true;
				},
			},
		});

		expect(title).toMatch(/approve/i);
		expect(message).toContain("changeset:host-approval");
		expect(message).toContain("Version: 3");
		expect(message).toContain("set-bid");
		expect(message).toContain("trail shoes");
		expect(message).toContain("currentBid");
		expect(message).toContain("proposedBid");
		expect(result.changeSet.decision).toMatchObject({
			outcome: "approved",
			actor: "pi-host-user",
			decidedAt: "2026-09-13T00:00:00.000Z",
			provenance: "host-ui-confirmation",
		});
		expect(result.approvalEnvelope).not.toBeNull();
		expect(verifySellerApprovalEnvelope(result.approvalEnvelope!, secret).id).toBe("changeset:host-approval");
	});

	it("records a host-confirmed rejection without issuing an approval envelope", async () => {
		const result = await confirmSellerChangeSetDecision({
			changeSet: awaitingChangeSet(),
			decision: "reject",
			secret: new TextEncoder().encode("host-secret"),
			now: () => "2026-09-13T00:00:00.000Z",
			host: { hasUI: true, confirm: async () => true },
		});
		expect(result.changeSet.status).toBe("rejected");
		expect(result.changeSet.decision?.provenance).toBe("host-ui-confirmation");
		expect(result.approvalEnvelope).toBeNull();
	});
});
