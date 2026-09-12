import type { Finding, FindingConfidence, FindingPriority, PpcSourceContext } from "../diagnostics/types.ts";
import type { ProfitabilityFinding } from "../types/profitability.ts";

export type SellerActionSource = "ppc" | "profitability";
export type SellerActionStage = "stop-loss" | "optimize" | "grow";
export type SellerActionDataQuality = "complete" | "partial" | "not-applicable";

export interface PpcDecisionContext {
	observedAcos: number | null;
	targetAcos: number | null;
}

export interface SellerActionPlanInput {
	ppcFindings: readonly Finding[];
	profitabilityFindings: readonly ProfitabilityFinding[];
	limit?: number;
}

export interface SellerActionPlanItem {
	id: string;
	rank: number;
	source: SellerActionSource;
	stage: SellerActionStage;
	priority: FindingPriority | ProfitabilityFinding["priority"];
	confidence: FindingConfidence | ProfitabilityFinding["confidence"];
	dataQuality: SellerActionDataQuality;
	entity: { type: "search-term" | "asin" | "sku"; value: string };
	context?: PpcSourceContext;
	decisionContext?: PpcDecisionContext;
	rationale: string;
	recommendedAction: { type: string; summary: string };
	evidence: Array<{ sourceFile: string; sourceRow: number }>;
	sourceFindingId: string;
	sourceRuleId: string;
	humanApprovalRequired: true;
}

export interface SellerActionPlan {
	totalFindings: number;
	returnedItems: number;
	items: SellerActionPlanItem[];
}
