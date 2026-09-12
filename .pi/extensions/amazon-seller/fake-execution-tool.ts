import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createFakeAmazonAdsExecutor,
	type FakeAmazonAdsState,
	type SellerExecutionPlan,
	type SellerExecutionReceipt,
} from "../../../packages/amazon-agent/src/index.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`${label} must contain valid JSON`);
	}
	if (!isRecord(parsed)) throw new Error(`${label} must contain a JSON object`);
	return parsed;
}

function parseExecutionPlan(raw: string): SellerExecutionPlan {
	const parsed = parseJsonObject(raw, "planJson");
	if (
		typeof parsed.id !== "string" ||
		typeof parsed.idempotencyKey !== "string" ||
		typeof parsed.sourceChangeSetId !== "string" ||
		!Number.isInteger(parsed.sourceChangeSetVersion) ||
		!isRecord(parsed.approval) ||
		typeof parsed.approval.actor !== "string" ||
		typeof parsed.approval.decidedAt !== "string" ||
		typeof parsed.approval.contentDigest !== "string" ||
		!Array.isArray(parsed.operations) ||
		!Array.isArray(parsed.skippedReviewOnlyProposalIds)
	) {
		throw new Error("planJson does not contain a valid SellerExecutionPlan shape");
	}
	for (const operation of parsed.operations) {
		if (!isRecord(operation) || typeof operation.proposalId !== "string" || typeof operation.idempotencyKey !== "string") {
			throw new Error("planJson contains an invalid execution operation");
		}
		if (operation.operation === "set-bid") {
			if (
				typeof operation.targetId !== "string" ||
				!isRecord(operation.before) ||
				!isRecord(operation.after) ||
				!isRecord(operation.preconditions) ||
				typeof operation.before.bid !== "number" ||
				typeof operation.after.bid !== "number" ||
				typeof operation.preconditions.expectedCurrentBid !== "number"
			) {
				throw new Error("planJson contains an invalid set-bid operation");
			}
			continue;
		}
		if (operation.operation === "add-negative-exact") {
			if (
				typeof operation.campaignId !== "string" ||
				typeof operation.adGroupId !== "string" ||
				typeof operation.negativeExact !== "string" ||
				!isRecord(operation.preconditions) ||
				operation.preconditions.mustNotAlreadyExist !== true
			) {
				throw new Error("planJson contains an invalid add-negative-exact operation");
			}
			continue;
		}
		throw new Error(`planJson contains unsupported execution operation: ${String(operation.operation)}`);
	}
	if (!parsed.skippedReviewOnlyProposalIds.every((value) => typeof value === "string")) {
		throw new Error("planJson contains invalid skipped review-only proposal IDs");
	}
	return parsed as unknown as SellerExecutionPlan;
}

function parseFakeState(raw: string): FakeAmazonAdsState {
	const parsed = parseJsonObject(raw, "fakeStateJson");
	if (!isRecord(parsed.bidsByTargetId)) {
		throw new Error("fakeStateJson.bidsByTargetId must be an object");
	}
	const bidsByTargetId = new Map<string, number>();
	for (const [targetId, bid] of Object.entries(parsed.bidsByTargetId)) {
		if (targetId.length === 0 || typeof bid !== "number" || !Number.isFinite(bid) || bid <= 0) {
			throw new Error("fakeStateJson contains an invalid target bid");
		}
		bidsByTargetId.set(targetId, bid);
	}
	if (!Array.isArray(parsed.negativeExactByScope) || !parsed.negativeExactByScope.every((value) => typeof value === "string")) {
		throw new Error("fakeStateJson.negativeExactByScope must be an array of strings");
	}
	return {
		bidsByTargetId,
		negativeExactByScope: new Set(parsed.negativeExactByScope),
		processedPlanKeys: new Map(),
	};
}

function serializeFakeState(state: FakeAmazonAdsState): Record<string, unknown> {
	return {
		bidsByTargetId: Object.fromEntries([...state.bidsByTargetId.entries()].sort(([left], [right]) => left.localeCompare(right))),
		negativeExactByScope: [...state.negativeExactByScope].sort(),
		processedPlanKeys: Object.fromEntries(
			[...state.processedPlanKeys.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, receipt]) => [key, receipt satisfies SellerExecutionReceipt]),
		),
	};
}

const fakeExecutePlanTool = defineTool({
	name: "amazon_fake_execute_plan",
	label: "Fake Execute Amazon Plan",
	description:
		"Execute a deterministic SellerExecutionPlan only against caller-supplied in-memory fake Amazon Ads state. Returns explicit stale/idempotent/failure receipts and always performs zero external Amazon writes.",
	parameters: Type.Object({
		planJson: Type.String({ description: "JSON object returned by amazon_build_execution_plan" }),
		fakeStateJson: Type.String({
			description: "Fake state JSON with bidsByTargetId object and negativeExactByScope string array",
		}),
		failProposalIds: Type.Optional(
			Type.Array(Type.String(), { description: "Optional proposal IDs to force into simulated-failure for testing" }),
		),
	}),
	async execute(_toolCallId, params) {
		const plan = parseExecutionPlan(params.planJson);
		const state = parseFakeState(params.fakeStateJson);
		const executor = createFakeAmazonAdsExecutor(state, {
			...(params.failProposalIds ? { failProposalIds: new Set(params.failProposalIds) } : {}),
		});
		const receipt = await executor.execute(plan);
		const result = { receipt, fakeState: serializeFakeState(state) };
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { result },
		};
	},
});

export function registerAmazonFakeExecutionTool(pi: ExtensionAPI): void {
	pi.registerTool(fakeExecutePlanTool);
}
