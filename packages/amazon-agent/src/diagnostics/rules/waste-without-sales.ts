import type { AdvertisingMetrics, NormalizedAdvertisingRow } from "../../types/advertising.ts";
import { createFinding } from "../finding.ts";
import type { Finding, PpcPolicy } from "../types.ts";

export const WASTE_WITHOUT_SALES_RULE_ID = "ppc.waste-without-sales.v1";

export function evaluateWasteWithoutSales(
	row: NormalizedAdvertisingRow,
	metrics: AdvertisingMetrics,
	policy: PpcPolicy,
): Finding | null {
	if (row.attributedSales !== 0) return null;

	const enoughClicks = row.clicks !== null && row.clicks >= policy.minimumClicksNoSale;
	const enoughSpend = row.spend !== null && row.spend >= policy.minimumSpendNoSale;
	if (!enoughClicks && !enoughSpend) return null;

	return createFinding({
		ruleId: WASTE_WITHOUT_SALES_RULE_ID,
		category: "waste",
		priority: "high",
		confidence: enoughClicks && enoughSpend ? "high" : "medium",
		row,
		metrics,
		thresholds: {
			minimumClicksNoSale: policy.minimumClicksNoSale,
			minimumSpendNoSale: policy.minimumSpendNoSale,
		},
		rationale: "The search term has zero attributed sales after reaching the configured evidence threshold.",
		recommendedAction: {
			type: "negative-exact-candidate",
			summary: "Review this search term as a negative exact candidate.",
		},
	});
}
