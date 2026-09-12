export type ReportKind = "sponsored-products-search-term" | "unknown";
export type ReportDelimiter = "," | "\t";

export type AdvertisingSemanticField =
	| "campaignName"
	| "adGroupName"
	| "targeting"
	| "matchType"
	| "customerSearchTerm"
	| "impressions"
	| "clicks"
	| "spend"
	| "attributedOrders"
	| "attributedUnits"
	| "attributedSales"
	| "currency";

export type AdvertisingNumericField =
	| "impressions"
	| "clicks"
	| "spend"
	| "attributedOrders"
	| "attributedUnits"
	| "attributedSales";

export interface NormalizedAdvertisingRow {
	campaignName: string;
	adGroupName: string;
	targeting: string | null;
	matchType: string | null;
	customerSearchTerm: string;
	impressions: number | null;
	clicks: number | null;
	spend: number | null;
	attributedOrders: number | null;
	attributedUnits: number | null;
	attributedSales: number | null;
	currency: string | null;
	sourceFile: string;
	sourceRow: number;
}

export interface ReportWarning {
	code: "invalid-number";
	field: AdvertisingNumericField;
	rawValue: string;
	sourceRow: number;
	message: string;
}

export interface ReportInspection {
	kind: ReportKind;
	delimiter: ReportDelimiter;
	headers: string[];
	missingFields: AdvertisingSemanticField[];
	warnings: ReportWarning[];
	rowCount: number;
}

export interface AdvertisingMetrics {
	ctr: number | null;
	cvr: number | null;
	cpc: number | null;
	acos: number | null;
	roas: number | null;
}
