import { DEFAULT_PPC_POLICY } from "../diagnostics/policy.ts";
import { diagnosePpc } from "../diagnostics/diagnose-ppc.ts";
import type { Finding, FindingCategory, PpcPolicy } from "../diagnostics/types.ts";
import { inspectAdvertisingReport, normalizeSearchTermReport } from "../parsers/search-term-report.ts";
import type { NormalizedAdvertisingRow, ReportInspection } from "../types/advertising.ts";

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

export type PpcPolicyOverrides = Partial<PpcPolicy>;

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
