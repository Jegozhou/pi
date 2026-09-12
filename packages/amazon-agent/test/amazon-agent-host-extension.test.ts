import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SellerChangeProposal, SellerChangeSet } from "../src/index.ts";

const modelManifestPath = new URL("../../ai/src/providers/data/.manifest.json", import.meta.url);
const hasModelManifest = existsSync(modelManifestPath);

function awaitingChangeSet(): SellerChangeSet {
	const proposal: SellerChangeProposal = {
		id: "change:host-extension",
		sourceActionItemId: "action:host-extension",
		sourceFindingId: "finding:host-extension",
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
	return {
		id: "changeset:host-extension",
		version: 3,
		status: "awaiting-approval",
		sourceActionItemIds: [proposal.sourceActionItemId],
		proposals: [proposal],
		decision: null,
	};
}

type RegisteredTool = {
	name: string;
	execute: (...args: unknown[]) => Promise<{ content: unknown[]; details?: Record<string, unknown> }>;
};

async function registeredAmazonTools(): Promise<Map<string, RegisteredTool>> {
	const { default: registerAmazonSeller } = await import("../../../.pi/extensions/amazon-seller/index.ts");
	const tools = new Map<string, RegisteredTool>();
	registerAmazonSeller({
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
	} as never);
	return tools;
}

function toolContext(hasUI: boolean, confirmed: boolean) {
	return {
		hasUI,
		ui: {
			confirm: async () => confirmed,
		},
	};
}

describe.skipIf(!hasModelManifest)("Amazon registered host approval tools", () => {
	it("fails closed without UI and when the human declines", async () => {
		const tools = await registeredAmazonTools();
		const decide = tools.get("amazon_decide_change_set");
		expect(decide).toBeDefined();
		const params = { changeSetJson: JSON.stringify(awaitingChangeSet()), decision: "approve", actor: "seller" };

		await expect(
			decide!.execute("tool-call", params, undefined, undefined, toolContext(false, true)),
		).rejects.toThrow(/host ui|dialog/i);
		await expect(
			decide!.execute("tool-call", params, undefined, undefined, toolContext(true, false)),
		).rejects.toThrow(/did not confirm/i);
	});

	it("host confirmation returns a signed envelope accepted by the registered dry-run tool", async () => {
		const tools = await registeredAmazonTools();
		const decide = tools.get("amazon_decide_change_set");
		const executeDryRun = tools.get("amazon_build_execution_dry_run");
		expect(decide).toBeDefined();
		expect(executeDryRun).toBeDefined();

		const approvalResult = await decide!.execute(
			"tool-call",
			{ changeSetJson: JSON.stringify(awaitingChangeSet()), decision: "approve", actor: "seller" },
			undefined,
			undefined,
			toolContext(true, true),
		);
		const envelope = approvalResult.details?.result as {
			changeSet: SellerChangeSet;
			proof: { algorithm: string; contentDigest: string; signature: string };
		};
		expect(envelope.changeSet.decision).toMatchObject({
			outcome: "approved",
			actor: "seller",
			provenance: "host-ui-confirmation",
		});
		expect(envelope.changeSet.decision?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(envelope.proof.algorithm).toBe("hmac-sha256");
		expect(envelope.proof.signature).toMatch(/^[a-f0-9]{64}$/);

		const dryRunResult = await executeDryRun!.execute(
			"tool-call",
			{ approvalEnvelopeJson: JSON.stringify(envelope), expectedVersion: envelope.changeSet.version },
			undefined,
			undefined,
			{},
		);
		expect(dryRunResult.details?.result).toMatchObject({ writesPerformed: false });
	});

	it("registered dry-run tool rejects bare approved Change Set JSON", async () => {
		const tools = await registeredAmazonTools();
		const executeDryRun = tools.get("amazon_build_execution_dry_run");
		expect(executeDryRun).toBeDefined();
		await expect(
			executeDryRun!.execute(
				"tool-call",
				{ approvalEnvelopeJson: JSON.stringify(awaitingChangeSet()) },
				undefined,
				undefined,
				{},
			),
		).rejects.toThrow(/changeSet and proof|approval proof/i);
	});
});
