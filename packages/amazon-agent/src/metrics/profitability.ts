import type {
	NormalizedProfitabilityRow,
	ProfitabilityCostCategory,
	ProfitabilityMetrics,
} from "../types/profitability.ts";

export function calculateProfitabilityMetrics(row: NormalizedProfitabilityRow): ProfitabilityMetrics {
	const knownCogsTotal = row.unitsSold !== null && row.cogsPerUnit !== null ? row.unitsSold * row.cogsPerUnit : null;
	const missingCostCategories: ProfitabilityCostCategory[] = [];
	const knownCosts: number[] = [];

	const addCost = (value: number | null, category: ProfitabilityCostCategory) => {
		if (value === null) missingCostCategories.push(category);
		else knownCosts.push(value);
	};

	addCost(row.refundsAmount, "refunds");
	addCost(row.amazonFees, "amazon-fees");
	addCost(row.fulfillmentFees, "fulfillment-fees");
	addCost(row.storageFees, "storage-fees");
	addCost(row.advertisingSpend, "advertising-spend");
	addCost(knownCogsTotal, "cogs");
	addCost(row.otherVariableCosts, "other-variable-costs");

	const knownVariableCost = knownCosts.reduce((sum, value) => sum + value, 0);
	const knownContributionProfit = row.grossSales === null ? null : row.grossSales - knownVariableCost;
	const knownContributionMargin =
		knownContributionProfit === null || row.grossSales === null || row.grossSales === 0
			? null
			: knownContributionProfit / row.grossSales;

	return {
		knownCogsTotal,
		knownVariableCost,
		knownContributionProfit,
		knownContributionMargin,
		status: row.grossSales !== null && missingCostCategories.length === 0 ? "complete" : "partial",
		missingCostCategories,
	};
}
