import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildSellerExecutionDryRun,
	verifySellerApprovalEnvelope,
	type SellerApprovalEnvelope,
	type SellerApprovalSecret,
	type SellerChangeSet,
} from "../../../packages/amazon-agent/src/index.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseApprovalEnvelope(raw: string): SellerApprovalEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("approvalEnvelopeJson must contain valid JSON");
	}
	if (!isRecord(parsed) || !isRecord(parsed.changeSet) || !isRecord(parsed.proof)) {
		throw new Error("approvalEnvelopeJson must contain changeSet and proof objects");
	}
	if (
		parsed.proof.algorithm !== "hmac-sha256" ||
		typeof parsed.proof.contentDigest !== "string" ||
		typeof parsed.proof.signature !== "string"
	) {
		throw new Error("approvalEnvelopeJson contains an invalid approval proof");
	}
	return {
		changeSet: parsed.changeSet as unknown as SellerChangeSet,
		proof: {
			algorithm: "hmac-sha256",
			contentDigest: parsed.proof.contentDigest,
			signature: parsed.proof.signature,
		},
	};
}

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
			const changeSet = verifySellerApprovalEnvelope(envelope, approvalSecret);
			const result = buildSellerExecutionDryRun(changeSet, {
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
}
