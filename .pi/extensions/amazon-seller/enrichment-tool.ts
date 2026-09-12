import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildPpcDiagnosisResult,
	buildProfitDiagnosisResult,
	buildSellerActionPlan,
	buildSellerChangeSet,
	enrichSellerChangeSet,
	normalizeTargetSnapshot,
	type PpcPolicyOverrides,
} from "../../../packages/amazon-agent/src/index.ts";
import { readAmazonReportFile } from "./file-input.ts";

export function registerAmazonEnrichmentTool(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "amazon_enrich_change_set",
			label: "Enrich Amazon Seller Change Set",
			description:
				"Join a local Amazon PPC Search Term report with a local target snapshot to resolve campaign/ad-group/target identity and current bid where possible, then return an enriched pre-execution Change Set. Read-only; does not call Amazon or choose a new bid.",
			parameters: Type.Object({
				ppcFilePath: Type.String({ description: "Path to the Sponsored Products Search Term CSV/TSV report" }),
				targetSnapshotFilePath: Type.String({ description: "Path to a target snapshot CSV/TSV containing campaign/ad-group IDs and optionally target ID/bid" }),
				profitabilityFilePath: Type.Optional(Type.String({ description: "Optional ASIN/SKU profitability CSV/TSV input" })),
				targetAcos: Type.Optional(Type.Number({ description: "Optional seller target ACOS as a fraction, for example 0.30" })),
				requiredContributionMargin: Type.Optional(Type.Number({ description: "Optional required contribution margin as a fraction" })),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum ranked actions to include" })),
			}),
			async execute(_toolCallId, params, signal) {
				const ppcFile = await readAmazonReportFile(params.ppcFilePath, signal);
				const targetFile = await readAmazonReportFile(params.targetSnapshotFilePath, signal);
				const ppcOverrides: PpcPolicyOverrides = {};
				if (params.targetAcos !== undefined) ppcOverrides.targetAcos = params.targetAcos;
				const ppc = buildPpcDiagnosisResult(ppcFile.content, ppcFile.fileName, ppcOverrides);

				let profitability: ReturnType<typeof buildProfitDiagnosisResult> | null = null;
				let profitabilityFile: { fileName: string; sizeBytes: number } | null = null;
				if (params.profitabilityFilePath) {
					const file = await readAmazonReportFile(params.profitabilityFilePath, signal);
					profitability = buildProfitDiagnosisResult(file.content, file.fileName, {
						requiredContributionMargin: params.requiredContributionMargin,
					});
					profitabilityFile = { fileName: file.fileName, sizeBytes: file.sizeBytes };
				}

				const plan = buildSellerActionPlan({
					ppcFindings: ppc.findings,
					profitabilityFindings: profitability?.findings ?? [],
					...(params.limit !== undefined ? { limit: params.limit } : {}),
				});
				const draftChangeSet = buildSellerChangeSet(plan);
				const snapshot = normalizeTargetSnapshot({ content: targetFile.content, fileName: targetFile.fileName });
				const enrichment = enrichSellerChangeSet(draftChangeSet, snapshot);
				const result = { plan, draftChangeSet, enrichedChangeSet: enrichment.changeSet, diagnostics: enrichment.diagnostics };

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: {
						files: {
							ppc: { fileName: ppcFile.fileName, sizeBytes: ppcFile.sizeBytes },
							targetSnapshot: { fileName: targetFile.fileName, sizeBytes: targetFile.sizeBytes },
							profitability: profitabilityFile,
						},
						result,
					},
				};
			},
		}),
	);
}
