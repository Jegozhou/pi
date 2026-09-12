import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildPpcDiagnosisResult,
	buildProfitDiagnosisResult,
	buildReportInspectionResult,
	buildSellerActionPlan,
	buildSellerChangeSet,
	decideSellerChangeSet,
	requestSellerChangeSetApproval,
	type PpcPolicyOverrides,
	type SellerActionPlan,
	type SellerChangeSet,
} from "../../../packages/amazon-agent/src/index.ts";
import { registerAmazonEnrichmentTool } from "./enrichment-tool.ts";
import { readAmazonReportFile } from "./file-input.ts";

function parseJsonObject<T>(raw: string, label: string): T {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`${label} must contain valid JSON`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${label} must contain a JSON object`);
	}
	return parsed as T;
}

const inspectReportTool = defineTool({
	name: "amazon_inspect_report",
	label: "Inspect Amazon Report",
	description:
		"Read one explicitly selected local Amazon Ads CSV/TSV report, recognize its schema, report missing fields and parse warnings, and return up to five normalized preview rows. Read-only; does not access an Amazon account.",
	parameters: Type.Object({
		filePath: Type.String({ description: "Path to the local Amazon Ads CSV or TSV report to inspect" }),
	}),
	async execute(_toolCallId, params, signal) {
		const file = await readAmazonReportFile(params.filePath, signal);
		const result = buildReportInspectionResult(file.content, file.fileName);
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { file: { fileName: file.fileName, sizeBytes: file.sizeBytes }, result },
		};
	},
});

const diagnosePpcTool = defineTool({
	name: "amazon_diagnose_ppc",
	label: "Diagnose Amazon PPC",
	description:
		"Read one explicitly selected local Amazon Sponsored Products Search Term CSV/TSV report and produce deterministic, evidence-backed PPC findings. Recommendations are candidates only and always require human approval.",
	parameters: Type.Object({
		filePath: Type.String({ description: "Path to the local Amazon Ads Search Term CSV or TSV report" }),
		targetAcos: Type.Optional(Type.Number({ description: "Seller target ACOS as a fraction, for example 0.30 for 30%" })),
		minimumClicksNoSale: Type.Optional(Type.Number({ description: "Minimum clicks before a zero-sales search term can be flagged" })),
		minimumSpendNoSale: Type.Optional(Type.Number({ description: "Minimum spend before a zero-sales search term can be flagged" })),
		minimumOrdersScale: Type.Optional(Type.Number({ description: "Minimum attributed orders before migration or scaling findings" })),
		highAcosMultiplier: Type.Optional(Type.Number({ description: "High-ACOS threshold multiplier applied to target ACOS" })),
		lowAcosScaleMargin: Type.Optional(Type.Number({ description: "Required fractional margin below target ACOS for a scale candidate" })),
	}),
	async execute(_toolCallId, params, signal) {
		const file = await readAmazonReportFile(params.filePath, signal);
		const policyOverrides: PpcPolicyOverrides = {};
		if (params.targetAcos !== undefined) policyOverrides.targetAcos = params.targetAcos;
		if (params.minimumClicksNoSale !== undefined) policyOverrides.minimumClicksNoSale = params.minimumClicksNoSale;
		if (params.minimumSpendNoSale !== undefined) policyOverrides.minimumSpendNoSale = params.minimumSpendNoSale;
		if (params.minimumOrdersScale !== undefined) policyOverrides.minimumOrdersScale = params.minimumOrdersScale;
		if (params.highAcosMultiplier !== undefined) policyOverrides.highAcosMultiplier = params.highAcosMultiplier;
		if (params.lowAcosScaleMargin !== undefined) policyOverrides.lowAcosScaleMargin = params.lowAcosScaleMargin;

		const result = buildPpcDiagnosisResult(file.content, file.fileName, policyOverrides);
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { file: { fileName: file.fileName, sizeBytes: file.sizeBytes }, result },
		};
	},
});

const diagnoseProfitTool = defineTool({
	name: "amazon_diagnose_profit",
	label: "Diagnose Amazon Profitability",
	description:
		"Read one explicitly selected local seller profitability CSV/TSV input and calculate known contribution economics from supplied values only. Missing costs remain explicit; results are never represented as net profit.",
	parameters: Type.Object({
		filePath: Type.String({ description: "Path to the local profitability CSV or TSV input" }),
		requiredContributionMargin: Type.Optional(
			Type.Number({ description: "Optional seller-required contribution margin as a fraction, for example 0.20" }),
		),
	}),
	async execute(_toolCallId, params, signal) {
		const file = await readAmazonReportFile(params.filePath, signal);
		const result = buildProfitDiagnosisResult(file.content, file.fileName, {
			requiredContributionMargin: params.requiredContributionMargin,
		});
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { file: { fileName: file.fileName, sizeBytes: file.sizeBytes }, result },
		};
	},
});

const buildActionPlanTool = defineTool({
	name: "amazon_build_action_plan",
	label: "Build Amazon Seller Action Plan",
	description:
		"Read one or both explicitly selected local Amazon PPC and profitability reports, run deterministic diagnostics, and return one ranked action plan. Read-only; never executes changes and every candidate keeps human approval required.",
	parameters: Type.Object({
		ppcFilePath: Type.Optional(Type.String({ description: "Optional path to a Sponsored Products Search Term CSV or TSV report" })),
		profitabilityFilePath: Type.Optional(Type.String({ description: "Optional path to an ASIN/SKU profitability CSV or TSV input" })),
		targetAcos: Type.Optional(Type.Number({ description: "Optional seller target ACOS as a fraction, for example 0.30" })),
		requiredContributionMargin: Type.Optional(
			Type.Number({ description: "Optional seller-required contribution margin as a fraction, for example 0.20" }),
		),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum ranked actions to return" })),
	}),
	async execute(_toolCallId, params, signal) {
		if (!params.ppcFilePath && !params.profitabilityFilePath) {
			throw new Error("Provide ppcFilePath, profitabilityFilePath, or both");
		}

		let ppcResult: ReturnType<typeof buildPpcDiagnosisResult> | null = null;
		let profitabilityResult: ReturnType<typeof buildProfitDiagnosisResult> | null = null;
		const files: Record<string, { fileName: string; sizeBytes: number }> = {};

		if (params.ppcFilePath) {
			const file = await readAmazonReportFile(params.ppcFilePath, signal);
			const overrides: PpcPolicyOverrides = {};
			if (params.targetAcos !== undefined) overrides.targetAcos = params.targetAcos;
			ppcResult = buildPpcDiagnosisResult(file.content, file.fileName, overrides);
			files.ppc = { fileName: file.fileName, sizeBytes: file.sizeBytes };
		}

		if (params.profitabilityFilePath) {
			const file = await readAmazonReportFile(params.profitabilityFilePath, signal);
			profitabilityResult = buildProfitDiagnosisResult(file.content, file.fileName, {
				requiredContributionMargin: params.requiredContributionMargin,
			});
			files.profitability = { fileName: file.fileName, sizeBytes: file.sizeBytes };
		}

		const plan = buildSellerActionPlan({
			ppcFindings: ppcResult?.findings ?? [],
			profitabilityFindings: profitabilityResult?.findings ?? [],
			...(params.limit !== undefined ? { limit: params.limit } : {}),
		});
		const result = {
			plan,
			sources: {
				ppc: ppcResult
					? {
						rowsAnalyzed: ppcResult.rowsAnalyzed,
						findingsCount: ppcResult.findingsCount,
						policy: ppcResult.policy,
						warnings: ppcResult.inspection.warnings,
					}
					: null,
				profitability: profitabilityResult
					? {
						rowsAnalyzed: profitabilityResult.rowsAnalyzed,
						findingsCount: profitabilityResult.findingsCount,
						policy: profitabilityResult.policy,
						warnings: profitabilityResult.inspection.warnings,
					}
					: null,
			},
		};

		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { files, result },
		};
	},
});

const buildChangeSetTool = defineTool({
	name: "amazon_build_change_set",
	label: "Build Amazon Seller Change Set",
	description:
		"Convert a seller Action Plan into an auditable pre-execution Change Set. Missing account identifiers or before/after values stay explicitly blocked; this tool never calls Amazon or executes a mutation.",
	parameters: Type.Object({
		actionPlanJson: Type.String({ description: "JSON object for a SellerActionPlan returned by amazon_build_action_plan" }),
	}),
	async execute(_toolCallId, params) {
		const actionPlan = parseJsonObject<SellerActionPlan>(params.actionPlanJson, "actionPlanJson");
		const result = buildSellerChangeSet(actionPlan);
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { result },
		};
	},
});

const requestChangeSetApprovalTool = defineTool({
	name: "amazon_request_change_set_approval",
	label: "Request Amazon Change Set Approval",
	description:
		"Move a fully specified Change Set from draft to awaiting-approval. Fails closed if a mutating proposal is blocked or if there is no ready mutation. This does not execute anything.",
	parameters: Type.Object({
		changeSetJson: Type.String({ description: "JSON object for a SellerChangeSet" }),
	}),
	async execute(_toolCallId, params) {
		const changeSet = parseJsonObject<SellerChangeSet>(params.changeSetJson, "changeSetJson");
		const result = requestSellerChangeSetApproval(changeSet);
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { result },
		};
	},
});

const decideChangeSetTool = defineTool({
	name: "amazon_decide_change_set",
	label: "Record Amazon Change Set Decision",
	description:
		"Record an explicit human approve/reject decision for a Change Set already awaiting approval. Approval means approved for a future executor only; nothing is executed or written to Amazon.",
	parameters: Type.Object({
		changeSetJson: Type.String({ description: "JSON object for a SellerChangeSet in awaiting-approval status" }),
		decision: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
		actor: Type.String({ description: "Non-empty identifier for the human making the decision" }),
		decidedAt: Type.String({ description: "Canonical ISO timestamp, for example 2026-09-13T00:00:00.000Z" }),
	}),
	async execute(_toolCallId, params) {
		const changeSet = parseJsonObject<SellerChangeSet>(params.changeSetJson, "changeSetJson");
		const result = decideSellerChangeSet(changeSet, {
			decision: params.decision,
			actor: params.actor,
			decidedAt: params.decidedAt,
		});
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			details: { result },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(inspectReportTool);
	pi.registerTool(diagnosePpcTool);
	pi.registerTool(diagnoseProfitTool);
	pi.registerTool(buildActionPlanTool);
	pi.registerTool(buildChangeSetTool);
	pi.registerTool(requestChangeSetApprovalTool);
	pi.registerTool(decideChangeSetTool);
	registerAmazonEnrichmentTool(pi);
}
