import type { AdvertisingMetrics, NormalizedAdvertisingRow } from "../types/advertising.ts";
import type { Finding, FindingCategory, FindingConfidence, FindingPriority, RecommendedAction } from "./types.ts";

export function createFinding(options: {
	ruleId: string;
	category: FindingCategory;
	priority: FindingPriority;
	confidence: FindingConfidence;
	row: NormalizedAdvertisingRow;
	metrics: AdvertisingMetrics;
	thresholds: Record<string, number | null>;
	rationale: string;
	recommendedAction: RecommendedAction;
}): Finding {
	const { row } = options;
	return {
		id: `${options.ruleId}:${row.sourceFile}:${row.sourceRow}:${row.customerSearchTerm}`,
		ruleId: options.ruleId,
		category: options.category,
		priority: options.priority,
		confidence: options.confidence,
		entity: {
			type: "search-term",
			value: row.customerSearchTerm,
		},
		context: {
			campaignName: row.campaignName,
			adGroupName: row.adGroupName,
			targeting: row.targeting,
			matchType: row.matchType,
		},
		metrics: {
			...options.metrics,
			impressions: row.impressions,
			clicks: row.clicks,
			spend: row.spend,
			attributedOrders: row.attributedOrders,
			attributedSales: row.attributedSales,
		},
		evidence: [{ sourceFile: row.sourceFile, sourceRow: row.sourceRow }],
		thresholds: options.thresholds,
		rationale: options.rationale,
		recommendedAction: options.recommendedAction,
		humanApprovalRequired: true,
	};
}
