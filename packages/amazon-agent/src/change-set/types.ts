import type { PpcDecisionContext, SellerActionPlan, SellerActionPlanItem } from "../action-plan/types.ts";
import type { PpcSourceContext } from "../diagnostics/types.ts";
import type { TargetSnapshotWarning } from "../types/targeting.ts";

export type SellerChangeSetStatus = "draft" | "awaiting-approval" | "approved" | "rejected";
export type SellerChangeProposalReadiness = "blocked" | "review-only" | "ready";
export type SellerDecisionProvenance = "host-ui-confirmation" | "trusted-caller";
export type SellerChangeOperation =
	| "add-negative-exact"
	| "set-bid"
	| "create-exact-target"
	| "scale"
	| "review-profitability";

export interface SellerChangeProposal {
	id: string;
	sourceActionItemId: string;
	sourceFindingId: string;
	sourceRuleId: string;
	operation: SellerChangeOperation;
	readiness: SellerChangeProposalReadiness;
	entity: SellerActionPlanItem["entity"];
	context?: PpcSourceContext;
	decisionContext?: PpcDecisionContext;
	rationale: string;
	evidence: Array<{ sourceFile: string; sourceRow: number }>;
	missingInputs: string[];
	before: Record<string, unknown> | null;
	after: Record<string, unknown> | null;
	humanApprovalRequired: true;
}

export interface SellerChangeSetDecision {
	outcome: "approved" | "rejected";
	actor: string;
	decidedAt: string;
	provenance?: SellerDecisionProvenance;
	contentDigest?: string;
}

export interface SellerChangeSet {
	id: string;
	version: number;
	status: SellerChangeSetStatus;
	sourceActionItemIds: string[];
	proposals: SellerChangeProposal[];
	decision: SellerChangeSetDecision | null;
}

export interface SellerChangeSetDecisionInput {
	decision: "approve" | "reject";
	actor: string;
	decidedAt: string;
	provenance?: SellerDecisionProvenance;
}

export interface SellerChangeSetResolverDiagnostics {
	resolvedProposalIds: string[];
	unresolvedProposalIds: string[];
	ambiguousProposalIds: string[];
	warnings: TargetSnapshotWarning[];
}

export interface SellerChangeSetEnrichmentResult {
	changeSet: SellerChangeSet;
	diagnostics: SellerChangeSetResolverDiagnostics;
}

export type SellerChangeSetInput = SellerActionPlan;
