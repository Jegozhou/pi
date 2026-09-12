import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildPpcDiagnosisResult,
	buildProfitDiagnosisResult,
	buildReportInspectionResult,
	type PpcPolicyOverrides,
} from "../../../packages/amazon-agent/src/index.ts";
import { readAmazonReportFile } from "./file-input.ts";

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

export default function (pi: ExtensionAPI) {
	pi.registerTool(inspectReportTool);
	pi.registerTool(diagnosePpcTool);
	pi.registerTool(diagnoseProfitTool);
}
