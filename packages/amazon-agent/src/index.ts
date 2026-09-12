export { DelimitedTextError, parseDelimitedText } from "./parsers/delimited.ts";
export { inspectAdvertisingReport, normalizeSearchTermReport } from "./parsers/search-term-report.ts";
export { calculateAdvertisingMetrics, safeRatio } from "./metrics/advertising.ts";
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
