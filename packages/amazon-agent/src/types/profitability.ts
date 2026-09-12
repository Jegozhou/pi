import type { ReportDelimiter } from "./advertising.ts";

export type ProfitabilityCostCategory =
	| "refunds"
	| "amazon-fees"
	| "fulfillment-fees"
	| "storage-fees"
	| "advertising-spend"
	| "cogs"
	| "other-variable-costs";

export type ProfitabilityNumericField =
	| "unitsSold"
	| "grossSales"
	| "refundsAmount"
	| "amazonFees"
	| "fulfillmentFees"
	| "storageFees"
	| "advertisingSpend"
	| "cogsPerUnit"
	| "otherVariableCosts";

export interface NormalizedProfitabilityRow {
	marketplace: string | null;
	asin: string | null;
	sku: string | null;
	unitsSold: number | null;
	grossSales: number | null;
	refundsAmount: number | null;
	amazonFees: number | null;
	fulfillmentFees: number | null;
	storageFees: number | null;
	advertisingSpend: number | null;
	cogsPerUnit: number | null;
	otherVariableCosts: number | null;
	currency: string | null;
	sourceFile: string;
	sourceRow: number;
}

export interface ProfitabilityWarning {
	code: "invalid-number";
	field: ProfitabilityNumericField;
	rawValue: string;
	sourceRow: number;
	message: string;
}

export interface ProfitabilityReportInspection {
	delimiter: ReportDelimiter;
	headers: string[];
	missingFields: Array<"asinOrSku" | "grossSales">;
	warnings: ProfitabilityWarning[];
	rowCount: number;
}

export interface ProfitabilityMetrics {
	knownCogsTotal: number | null;
	knownVariableCost: number;
	knownContributionProfit: number | null;
	knownContributionMargin: number | null;
	status: "complete" | "partial";
	missingCostCategories: ProfitabilityCostCategory[];
}

export interface ProfitabilityFinding {
	id: string;
	ruleId: string;
	category: "profit-risk";
	priority: "high" | "medium";
	confidence: "high" | "medium";
	entity: { type: "asin" | "sku"; value: string };
	metrics: ProfitabilityMetrics;
	dataQuality: "complete" | "partial";
	evidence: Array<{ sourceFile: string; sourceRow: number }>;
	thresholds: { requiredContributionMargin: number | null };
	rationale: string;
	recommendedAction: { type: "review-profitability-candidate"; summary: string };
	humanApprovalRequired: true;
}
