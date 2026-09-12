export { buildSellerActionPlan } from "./action-plan/build-action-plan.ts";
export type {
	PpcDecisionContext,
	SellerActionDataQuality,
	SellerActionPlan,
	SellerActionPlanInput,
	SellerActionPlanItem,
	SellerActionSource,
	SellerActionStage,
} from "./action-plan/types.ts";
export {
	computeSellerChangeSetContentDigest,
	createSellerApprovalEnvelope,
	verifySellerApprovalEnvelope,
} from "./approval/approval-envelope.ts";
export type {
	SellerApprovalEnvelope,
	SellerApprovalProof,
	SellerApprovalSecret,
} from "./approval/approval-envelope.ts";
export { applyBidPolicyToChangeSet } from "./bid-policy/apply-bid-policy.ts";
export { DEFAULT_BID_POLICY, simulateBidChange } from "./bid-policy/simulate-bid.ts";
export type {
	BidGuardrailApplied,
	BidPolicy,
	BidPolicyApplicationResult,
	BidPolicyDiagnostics,
	BidPolicyOverrides,
	BidSimulation,
	BidSimulationInput,
} from "./bid-policy/types.ts";
export { buildSellerChangeSet } from "./change-set/build-change-set.ts";
export { decideSellerChangeSet, requestSellerChangeSetApproval } from "./change-set/decide-change-set.ts";
export { enrichSellerChangeSet } from "./change-set/enrich-change-set.ts";
export type {
	SellerChangeOperation,
	SellerChangeProposal,
	SellerChangeProposalReadiness,
	SellerChangeSet,
	SellerChangeSetDecision,
	SellerChangeSetDecisionInput,
	SellerChangeSetEnrichmentResult,
	SellerChangeSetInput,
	SellerChangeSetResolverDiagnostics,
	SellerChangeSetStatus,
	SellerDecisionProvenance,
} from "./change-set/types.ts";
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
	PpcSourceContext,
	RecommendedAction,
	RecommendedActionType,
} from "./diagnostics/types.ts";
export { buildSellerExecutionDryRun } from "./execution/build-dry-run.ts";
export type {
	SellerBidDryRunOperation,
	SellerDryRunOperation,
	SellerExecutionCheck,
	SellerExecutionDryRun,
	SellerExecutionDryRunOptions,
	SellerExecutionMode,
	SellerNegativeExactDryRunOperation,
} from "./execution/types.ts";
export { calculateAdvertisingMetrics, safeRatio } from "./metrics/advertising.ts";
export { calculateProfitabilityMetrics } from "./metrics/profitability.ts";
export { DelimitedTextError, parseDelimitedText } from "./parsers/delimited.ts";
export { normalizeProfitabilityReport } from "./parsers/profitability-report.ts";
export { inspectAdvertisingReport, normalizeSearchTermReport } from "./parsers/search-term-report.ts";
export { normalizeTargetSnapshot } from "./parsers/target-snapshot.ts";
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
export type {
	NormalizedTargetSnapshotRow,
	TargetSnapshotInspection,
	TargetSnapshotParseResult,
	TargetSnapshotSemanticField,
	TargetSnapshotWarning,
} from "./types/targeting.ts";
