import type { AdvertisingMetrics, NormalizedAdvertisingRow } from "../../types/advertising.ts";
import { createFinding } from "../finding.ts";
import type { Finding, PpcPolicy } from "../types.ts";

export const HIGH_ACOS_RULE_ID = "ppc.high-acos.v1";

export function evaluateHighAcos(
	row: NormalizedAdvertisingRow,
	metrics: AdvertisingMetrics,
	policy: PpcPolicy,
): Finding | null {
	if (policy.targetAcos === null || metrics.acos === null) return null;
	if (row.attributedOrders === null || row.attributedOrders < 1) return null;

	const threshold = policy.targetAcos * policy.highAcosMultiplier;
	if (metrics.acos < threshold) return null;

	return createFinding({
		ruleId: HIGH_ACOS_RULE_ID,
		category: "bid-down",
		priority: "high",
		confidence: row.attributedOrders >= 2 ? "high" : "medium",
		row,
		metrics,
		thresholds: {
			targetAcos: policy.targetAcos,
			highAcosMultiplier: policy.highAcosMultiplier,
		},
		rationale: `Observed ACOS ${metrics.acos} is at or above ${policy.highAcosMultiplier}x the seller target ACOS.`,
		recommendedAction: {
			type: "reduce-bid-candidate",
			summary: "Review this search term or its source target for a cautious bid reduction and relevance check.",
		},
	});
}
