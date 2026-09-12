export { buildSellerActionPlan } from "./action-plan/build-action-plan.ts";
export type {
	SellerActionDataQuality,
	SellerActionPlan,
	SellerActionPlanInput,
	SellerActionPlanItem,
	SellerActionSource,
	SellerActionStage,
} from "./action-plan/types.ts";
export { diagnosePpc } from "./diagnostics/diagnose-ppc.ts";
export {
	diagnoseProfitability,
	type ProfitabilityPolicy,
} from "./diagnostics/diagnose-profit.ts";
export { DEFAULT_PPC_POLICY } from "./diagnostics/policy.ts";
export type {
	EvidenceRef,
	Finding,
	FindingCategory,
	FindingConfidence,
	FindingMetrics,
	FindingPriority,
	PpcPolicy,
	RecommendedAction,
	RecommendedActionType,
} from "./diagnostics/types.ts";
export { calculateAdvertisingMetrics, safeRatio } from "./metrics/advertising.ts";
export { calculateProfitabilityMetrics } from "./metrics/profitability.ts";
export { DelimitedTextError, parseDelimitedText } from "./parsers/delimited.ts";
export { normalizeProfitabilityReport } from "./parsers/profitability-report.ts";
export { inspectAdvertisingReport, normalizeSearchTermReport } from "./parsers/search-term-report.ts";
export {
	buildPpcDiagnosisResult,
	buildProfitDiagnosisResult,
	buildReportInspectionResult,
	type PpcDiagnosisResult,
	type PpcPolicyOverrides,
	type ProfitDiagnosisResult,
	type ProfitabilityPolicyOverrides,
	type ReportInspectionResult,
} from "./tools/report-tools.ts";
export type {
	AdvertisingMetrics,
	AdvertisingNumericField,
	AdvertisingSemanticField,
	NormalizedAdvertisingRow,
	ReportDelimiter,
	ReportInspection,
	ReportKind,
	ReportWarning,
} from "./types/advertising.ts";
export type {
	NormalizedProfitabilityRow,
	ProfitabilityCostCategory,
	ProfitabilityFinding,
	ProfitabilityMetrics,
	ProfitabilityNumericField,
	ProfitabilityReportInspection,
	ProfitabilityWarning,
} from "./types/profitability.ts";
