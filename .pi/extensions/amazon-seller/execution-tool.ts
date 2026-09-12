import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildSellerExecutionDryRun,
	type SellerApprovalSecret,
} from "../../../packages/amazon-agent/src/index.ts";
import { parseApprovalEnvelope } from "./approval-envelope-input.ts";
import { registerAmazonExecutionPlanTool } from "./execution-plan-tool.ts";
import { registerAmazonFakeExecutionTool } from "./fake-execution-tool.ts";

function createExecutionDryRunTool(approvalSecret: SellerApprovalSecret) {
	return defineTool({
		name: "amazon_build_execution_dry_run",
		label: "Build Amazon Execution Dry Run",
		description:
			"Verify a host-confirmed signed approval envelope and convert its exact approved Change Set into a local dry-run execution artifact. Performs zero Amazon writes and never accepts a bare approved JSON object.",
		parameters: Type.Object({
			approvalEnvelopeJson: Type.String({
				description: "Exact signed approval envelope returned after host UI confirmation by amazon_decide_change_set",
			}),
			expectedVersion: Type.Optional(
				Type.Integer({ minimum: 1, description: "Optional exact approved Change Set version to reject stale artifacts" }),
			),
		}),
		async execute(_toolCallId, params) {
			const envelope = parseApprovalEnvelope(params.approvalEnvelopeJson);
			const result = buildSellerExecutionDryRun(envelope, approvalSecret, {
				...(params.expectedVersion !== undefined ? { expectedVersion: params.expectedVersion } : {}),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: { result },
			};
		},
	});
}

export function registerAmazonExecutionDryRunTool(pi: ExtensionAPI, approvalSecret: SellerApprovalSecret): void {
	pi.registerTool(createExecutionDryRunTool(approvalSecret));
	registerAmazonExecutionPlanTool(pi, approvalSecret);
	registerAmazonFakeExecutionTool(pi);
}
