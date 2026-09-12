import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	applyBidPolicyToChangeSet,
	type BidPolicyOverrides,
	type SellerChangeSet,
} from "../../../packages/amazon-agent/src/index.ts";

function parseChangeSet(raw: string): SellerChangeSet {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("changeSetJson must contain valid JSON");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("changeSetJson must contain a JSON object");
	}
	return parsed as SellerChangeSet;
}

const simulateBidChangeTool = defineTool({
	name: "amazon_simulate_bid_change",
	label: "Simulate Amazon Bid Change",
	description:
		"Apply a deterministic proportional bid-down policy to enriched draft set-bid proposals. Uses current bid, observed ACOS, seller target ACOS, and explicit guardrails to create a proposed bid. Domain-state only: no Amazon credentials, API calls, or execution.",
	parameters: Type.Object({
		changeSetJson: Type.String({ description: "JSON object for an enriched draft SellerChangeSet" }),
		maxDecreaseFraction: Type.Optional(
			Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1, description: "Maximum single-step bid decrease as a fraction; default 0.20" }),
		),
		minimumBid: Type.Optional(
			Type.Number({ exclusiveMinimum: 0, description: "Absolute minimum proposed bid; default 0.02" }),
		),
		currencyDecimals: Type.Optional(
			Type.Integer({ minimum: 0, maximum: 6, description: "Bid rounding precision; default 2" }),
		),
	}),
	async execute(_toolCallId, params) {
		const changeSet = parseChangeSet(params.changeSetJson);
		const overrides: BidPolicyOverrides = {};
		if (params.maxDecreaseFraction !== undefined) overrides.maxDecreaseFraction = params.maxDecreaseFraction;
		if (params.minimumBid !== undefined) overrides.minimumBid = params.minimumBid;
		if (params.currencyDecimals !== undefined) overrides.currencyDecimals = params.currencyDecimals;
		const result = applyBidPolicyToChangeSet(changeSet, overrides);
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { result },
		};
	},
});

export function registerAmazonBidPolicyTool(pi: ExtensionAPI): void {
	pi.registerTool(simulateBidChangeTool);
}
