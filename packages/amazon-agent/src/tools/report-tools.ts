import { diagnosePpc } from "../diagnostics/diagnose-ppc.ts";
import {
	diagnoseProfitability,
	type ProfitabilityPolicy,
} from "../diagnostics/diagnose-profit.ts";
import { DEFAULT_PPC_POLICY } from "../diagnostics/policy.ts";
import type { Finding, FindingCategory, PpcPolicy } from "../diagnostics/types.ts";
import { calculateProfitabilityMetrics } from "../metrics/profitability.ts";
import { normalizeProfitabilityReport } from "../parsers/profitability-report.ts";
import { inspectAdvertisingReport, normalizeSearchTermReport } from "../parsers/search-term-report.ts";
import type { NormalizedAdvertisingRow, ReportInspection } from "../types/advertising.ts";
import type {
	NormalizedProfitabilityRow,
	ProfitabilityFinding,
	ProfitabilityMetrics,
	ProfitabilityReportInspection,
} from "../types/profitability.ts";

export interface ReportInspectionResult {
	inspection: ReportInspection;
	preview: NormalizedAdvertisingRow[] | null;
}

export interface PpcDiagnosisResult {
	inspection: ReportInspection;
	policy: PpcPolicy;
	rowsAnalyzed: number;
	findingsCount: number;
	byCategory: Record<FindingCategory, number>;
	findings: Finding[];
}

export interface ProfitDiagnosisResult {
	inspection: ProfitabilityReportInspection;
	policy: ProfitabilityPolicy;
	rowsAnalyzed: number;
	results: Array<{
		entity: { asin: string | null; sku: string | null };
		metrics: ProfitabilityMetrics;
		source: { sourceFile: string; sourceRow: number };
	}>;
	findingsCount: number;
	findings: ProfitabilityFinding[];
}

export type PpcPolicyOverrides = Partial<PpcPolicy>;
export type ProfitabilityPolicyOverrides = Partial<ProfitabilityPolicy>;

export function buildReportInspectionResult(content: string, fileName: string): ReportInspectionResult {
	const inspection = inspectAdvertisingReport({ content, fileName });
	if (inspection.kind === "unknown") return { inspection, preview: null };

	return {
		inspection,
		preview: normalizeSearchTermReport({ content, fileName }).slice(0, 5),
	};
}

export function buildPpcDiagnosisResult(
	content: string,
	fileName: string,
	policyOverrides: PpcPolicyOverrides = {},
): PpcDiagnosisResult {
	const inspection = inspectAdvertisingReport({ content, fileName });
	if (inspection.kind !== "sponsored-products-search-term") {
		throw new Error(`Unsupported report for PPC diagnosis; missing required fields: ${inspection.missingFields.join(", ")}`);
	}

	const policy: PpcPolicy = { ...DEFAULT_PPC_POLICY, ...policyOverrides };
	const rows = normalizeSearchTermReport({ content, fileName });
	if (rows.length === 0) {
		throw new Error("Insufficient PPC data: report contains no data rows");
	}
	const findings = diagnosePpc(rows, policy);
	const byCategory: Record<FindingCategory, number> = {
		waste: 0,
		"bid-down": 0,
		migration: 0,
		scale: 0,
	};
	for (const finding of findings) byCategory[finding.category] += 1;

	return {
		inspection,
		policy,
		rowsAnalyzed: rows.length,
		findingsCount: findings.length,
		byCategory,
		findings,
	};
}

export function buildProfitDiagnosisResult(
	content: string,
	fileName: string,
	policyOverrides: ProfitabilityPolicyOverrides = {},
): ProfitDiagnosisResult {
	const parsed = normalizeProfitabilityReport({ content, fileName });
	if (parsed.inspection.missingFields.length > 0) {
		throw new Error(
			`Unsupported profitability input; missing required fields: ${parsed.inspection.missingFields.join(", ")}`,
		);
	}
	if (parsed.rows.length === 0) {
		throw new Error("Insufficient profitability data: report contains no data rows");
	}
	const policy: ProfitabilityPolicy = {
		requiredContributionMargin: policyOverrides.requiredContributionMargin ?? null,
	};
	const findings = diagnoseProfitability(parsed.rows, policy);
	return {
		inspection: parsed.inspection,
		policy,
		rowsAnalyzed: parsed.rows.length,
		results: parsed.rows.map((row: NormalizedProfitabilityRow) => ({
			entity: { asin: row.asin, sku: row.sku },
			metrics: calculateProfitabilityMetrics(row),
			source: { sourceFile: row.sourceFile, sourceRow: row.sourceRow },
		})),
		findingsCount: findings.length,
		findings,
	};
}
