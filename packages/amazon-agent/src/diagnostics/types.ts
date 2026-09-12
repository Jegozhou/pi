import type { AdvertisingMetrics } from "../types/advertising.ts";

export interface PpcPolicy {
	targetAcos: number | null;
	minimumClicksNoSale: number;
	minimumSpendNoSale: number;
	minimumOrdersScale: number;
	highAcosMultiplier: number;
	lowAcosScaleMargin: number;
}

export type FindingCategory = "waste" | "bid-down" | "migration" | "scale";
export type FindingPriority = "high" | "medium" | "low";
export type FindingConfidence = "high" | "medium" | "low";

export interface EvidenceRef {
	sourceFile: string;
	sourceRow: number;
}

export interface PpcSourceContext {
	campaignName: string;
	adGroupName: string;
	targeting: string | null;
	matchType: string | null;
}

export type RecommendedActionType =
	| "negative-exact-candidate"
	| "reduce-bid-candidate"
	| "exact-target-candidate"
	| "scale-candidate";

export interface RecommendedAction {
	type: RecommendedActionType;
	summary: string;
}

export interface FindingMetrics extends AdvertisingMetrics {
	impressions: number | null;
	clicks: number | null;
	spend: number | null;
	attributedOrders: number | null;
	attributedSales: number | null;
}

export interface Finding {
	id: string;
	ruleId: string;
	category: FindingCategory;
	priority: FindingPriority;
	confidence: FindingConfidence;
	entity: {
		type: "search-term";
		value: string;
	};
	context?: PpcSourceContext;
	metrics: FindingMetrics;
	evidence: EvidenceRef[];
	thresholds: Record<string, number | null>;
	rationale: string;
	recommendedAction: RecommendedAction;
	humanApprovalRequired: true;
}
