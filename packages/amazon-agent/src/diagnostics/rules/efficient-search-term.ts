import type { AdvertisingMetrics, NormalizedAdvertisingRow } from "../../types/advertising.ts";
import { createFinding } from "../finding.ts";
import type { Finding, PpcPolicy } from "../types.ts";

export const EFFICIENT_SEARCH_TERM_RULE_ID = "ppc.efficient-search-term.v1";
export const SCALE_EFFICIENT_TARGET_RULE_ID = "ppc.scale-efficient-target.v1";

const DISCOVERY_MATCH_TYPES = new Set([
	"auto",
	"automatic",
	"broad",
	"closematch",
	"complements",
	"loosematch",
	"phrase",
	"substitutes",
]);

function normalizeMatchType(matchType: string | null): string | null {
	if (matchType === null) return null;
	const normalized = matchType
		.trim()
		.toLowerCase()
		.replace(/[^a-z]/g, "");
	return normalized.length === 0 ? null : normalized;
}

function hasEnoughOrders(row: NormalizedAdvertisingRow, policy: PpcPolicy): boolean {
	return row.attributedOrders !== null && row.attributedOrders >= policy.minimumOrdersScale;
}

export function evaluateEfficientSearchTerm(
	row: NormalizedAdvertisingRow,
	metrics: AdvertisingMetrics,
	policy: PpcPolicy,
): Finding | null {
	if (policy.targetAcos === null || metrics.acos === null) return null;
	if (!hasEnoughOrders(row, policy) || metrics.acos > policy.targetAcos) return null;

	const matchType = normalizeMatchType(row.matchType);
	if (matchType === null || !DISCOVERY_MATCH_TYPES.has(matchType)) return null;

	return createFinding({
		ruleId: EFFICIENT_SEARCH_TERM_RULE_ID,
		category: "migration",
		priority: "medium",
		confidence: "high",
		row,
		metrics,
		thresholds: {
			targetAcos: policy.targetAcos,
			minimumOrdersScale: policy.minimumOrdersScale,
		},
		rationale:
			"The search term has enough attributed orders, meets the seller ACOS target, and came from discovery-style targeting.",
		recommendedAction: {
			type: "exact-target-candidate",
			summary: "Review this search term for isolation as an exact target while preserving discovery coverage.",
		},
	});
}

export function evaluateScaleEfficientTarget(
	row: NormalizedAdvertisingRow,
	metrics: AdvertisingMetrics,
	policy: PpcPolicy,
): Finding | null {
	if (policy.targetAcos === null || metrics.acos === null) return null;
	if (!hasEnoughOrders(row, policy)) return null;
	if (!row.targeting || row.targeting.trim().length === 0) return null;

	const threshold = policy.targetAcos * (1 - policy.lowAcosScaleMargin);
	if (metrics.acos > threshold) return null;

	return createFinding({
		ruleId: SCALE_EFFICIENT_TARGET_RULE_ID,
		category: "scale",
		priority: "medium",
		confidence: "high",
		row,
		metrics,
		thresholds: {
			targetAcos: policy.targetAcos,
			lowAcosScaleMargin: policy.lowAcosScaleMargin,
			minimumOrdersScale: policy.minimumOrdersScale,
		},
		rationale:
			"The search term has enough attributed orders, ACOS is sufficiently below the seller target, and its source targeting context is present for a cautious scaling review.",
		recommendedAction: {
			type: "scale-candidate",
			summary:
				"Review the identified source target for cautious bid or budget scaling; budget exhaustion is not inferred from this report.",
		},
	});
}
