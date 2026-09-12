import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import amazonSellerExtension from "../../../.pi/extensions/amazon-seller/index.ts";
import type { SellerChangeProposal, SellerChangeSet, SellerExecutionPlan, SellerExecutionReceipt } from "../src/index.ts";

interface HostContextFixture {
	hasUI: boolean;
	ui: {
		confirm: (title: string, message: string, options?: { signal?: AbortSignal }) => Promise<boolean>;
	};
}

interface ToolResultFixture {
	content: Array<{ type: string; text: string }>;
	details?: { result?: unknown; [key: string]: unknown };
}

interface RegisteredToolFixture {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal,
		onUpdate?: unknown,
		ctx?: HostContextFixture,
	) => Promise<ToolResultFixture>;
}

function readyBidProposal(): SellerChangeProposal {
	return {
		id: "change:v1.1-host-bid",
		sourceActionItemId: "action:v1.1-host-bid",
		sourceFindingId: "finding:v1.1-host-bid",
		sourceRuleId: "ppc.high-acos.v1",
		operation: "set-bid",
		readiness: "ready",
		entity: { type: "search-term", value: "trail shoes" },
		context: {
			campaignName: "SP Discovery",
			adGroupName: "Shoes",
			targeting: "running shoes",
			matchType: "BROAD",
		},
		decisionContext: { observedAcos: 0.6, targetAcos: 0.3 },
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
		id: "changeset:v1.1-host",
		version: 3,
		status: "awaiting-approval",
		sourceActionItemIds: ["action:v1.1-host-bid"],
		proposals: [readyBidProposal()],
		decision: null,
	};
}

function registeredTools(): Map<string, RegisteredToolFixture> {
	const tools = new Map<string, RegisteredToolFixture>();
	const pi = {
		registerTool(tool: unknown) {
			const registered = tool as RegisteredToolFixture;
			tools.set(registered.name, registered);
		},
	} as unknown as ExtensionAPI;
	amazonSellerExtension(pi);
	return tools;
}

function requireTool(tools: Map<string, RegisteredToolFixture>, name: string): RegisteredToolFixture {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Missing registered tool: ${name}`);
	return tool;
}

async function approvedEnvelopeFromHost(tools: Map<string, RegisteredToolFixture>): Promise<unknown> {
	const decisionTool = requireTool(tools, "amazon_decide_change_set");
	const controller = new AbortController();
	const result = await decisionTool.execute(
		"decision-call",
		{ changeSetJson: JSON.stringify(awaitingChangeSet()), decision: "approve" },
		controller.signal,
		undefined,
		{
			hasUI: true,
			ui: { confirm: async () => true },
		},
	);
	return result.details?.result;
}

describe("Amazon Seller Agent V1.1 host execution tools", () => {
	it("registers execution-plan and fake-execution tools but no live executor", () => {
		const tools = registeredTools();
		expect(tools.has("amazon_build_execution_plan")).toBe(true);
		expect(tools.has("amazon_fake_execute_plan")).toBe(true);
		expect([...tools.keys()].some((name) => /live.*execute|execute.*live|real.*execute/i.test(name))).toBe(false);
	});

	it("builds an execution plan from the exact host-signed approval envelope", async () => {
		const tools = registeredTools();
		const envelope = await approvedEnvelopeFromHost(tools);
		const planTool = requireTool(tools, "amazon_build_execution_plan");
		const controller = new AbortController();
		const result = await planTool.execute(
			"plan-call",
			{ approvalEnvelopeJson: JSON.stringify(envelope), expectedVersion: 4 },
			controller.signal,
		);
		const plan = result.details?.result as SellerExecutionPlan;

		expect(plan.sourceChangeSetId).toBe("changeset:v1.1-host");
		expect(plan.sourceChangeSetVersion).toBe(4);
		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]).toMatchObject({ operation: "set-bid", targetId: "3001" });
	});

	it("rejects bare approved-like JSON when building an execution plan", async () => {
		const tools = registeredTools();
		const planTool = requireTool(tools, "amazon_build_execution_plan");
		const controller = new AbortController();
		await expect(
			planTool.execute(
				"plan-call",
				{ approvalEnvelopeJson: JSON.stringify(awaitingChangeSet()) },
				controller.signal,
			),
		).rejects.toThrow(/proof|approval.*envelope|changeSet/i);
	});

	it("fake-executes a host-approved plan with zero external writes", async () => {
		const tools = registeredTools();
		const envelope = await approvedEnvelopeFromHost(tools);
		const controller = new AbortController();
		const planResult = await requireTool(tools, "amazon_build_execution_plan").execute(
			"plan-call",
			{ approvalEnvelopeJson: JSON.stringify(envelope), expectedVersion: 4 },
			controller.signal,
		);
		const plan = planResult.details?.result as SellerExecutionPlan;
		const fakeResult = await requireTool(tools, "amazon_fake_execute_plan").execute(
			"fake-call",
			{
				planJson: JSON.stringify(plan),
				fakeStateJson: JSON.stringify({ bidsByTargetId: { "3001": 1.2 }, negativeExactByScope: [] }),
			},
			controller.signal,
		);
		const output = fakeResult.details?.result as { receipt: SellerExecutionReceipt };

		expect(output.receipt.externalWritesPerformed).toBe(false);
		expect(output.receipt.operations).toEqual([
			expect.objectContaining({ operation: "set-bid", status: "applied" }),
		]);
	});
});
