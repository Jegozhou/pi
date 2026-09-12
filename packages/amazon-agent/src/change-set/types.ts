import type { SellerActionPlan, SellerActionPlanItem } from "../action-plan/types.ts";

export type SellerChangeSetStatus = "draft" | "awaiting-approval" | "approved" | "rejected";
export type SellerChangeProposalReadiness = "blocked" | "review-only" | "ready";
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
}

export type SellerChangeSetInput = SellerActionPlan;
