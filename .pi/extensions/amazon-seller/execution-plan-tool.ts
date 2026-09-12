import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildSellerExecutionPlan,
	type SellerApprovalSecret,
} from "../../../packages/amazon-agent/src/index.ts";
import { parseApprovalEnvelope } from "./approval-envelope-input.ts";

function createExecutionPlanTool(approvalSecret: SellerApprovalSecret) {
	return defineTool({
		name: "amazon_build_execution_plan",
		label: "Build Amazon Execution Plan",
		description:
			"Verify the exact host-confirmed signed approval envelope and compile supported approved mutations into a deterministic execution plan with stale-state preconditions and idempotency keys. This performs zero Amazon writes.",
		parameters: Type.Object({
			approvalEnvelopeJson: Type.String({
				description: "Exact signed approval envelope returned by amazon_decide_change_set after host UI confirmation",
			}),
			expectedVersion: Type.Optional(
				Type.Integer({ minimum: 1, description: "Optional exact approved Change Set version to reject stale artifacts" }),
			),
		}),
		async execute(_toolCallId, params) {
			const envelope = parseApprovalEnvelope(params.approvalEnvelopeJson);
			const result = buildSellerExecutionPlan(envelope, approvalSecret, {
				...(params.expectedVersion !== undefined ? { expectedVersion: params.expectedVersion } : {}),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: { result },
			};
		},
	});
}

export function registerAmazonExecutionPlanTool(pi: ExtensionAPI, approvalSecret: SellerApprovalSecret): void {
	pi.registerTool(createExecutionPlanTool(approvalSecret));
}
