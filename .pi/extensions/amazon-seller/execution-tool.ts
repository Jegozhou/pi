import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildSellerExecutionDryRun,
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

const buildExecutionDryRunTool = defineTool({
	name: "amazon_build_execution_dry_run",
	label: "Build Amazon Execution Dry Run",
	description:
		"Convert an explicitly approved Amazon Seller Change Set into a validated local dry-run execution artifact. Performs zero Amazon writes, makes no network calls, and never marks a mutation executed.",
	parameters: Type.Object({
		changeSetJson: Type.String({ description: "JSON object for an explicitly approved SellerChangeSet" }),
		expectedVersion: Type.Optional(
			Type.Integer({ minimum: 1, description: "Optional exact approved Change Set version to reject stale artifacts" }),
		),
	}),
	async execute(_toolCallId, params) {
		const changeSet = parseChangeSet(params.changeSetJson);
		const result = buildSellerExecutionDryRun(changeSet, {
			...(params.expectedVersion !== undefined ? { expectedVersion: params.expectedVersion } : {}),
		});
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { result },
		};
	},
});

export function registerAmazonExecutionDryRunTool(pi: ExtensionAPI): void {
	pi.registerTool(buildExecutionDryRunTool);
}
