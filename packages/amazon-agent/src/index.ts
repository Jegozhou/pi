export { diagnosePpc } from "./diagnostics/diagnose-ppc.ts";
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
export { DelimitedTextError, parseDelimitedText } from "./parsers/delimited.ts";
export { inspectAdvertisingReport, normalizeSearchTermReport } from "./parsers/search-term-report.ts";
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
