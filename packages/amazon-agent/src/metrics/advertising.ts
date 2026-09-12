import type { AdvertisingMetrics, NormalizedAdvertisingRow } from "../types/advertising.ts";

export function safeRatio(numerator: number | null, denominator: number | null): number | null {
	if (numerator === null || denominator === null || denominator === 0) return null;
	return numerator / denominator;
}

export function calculateAdvertisingMetrics(row: NormalizedAdvertisingRow): AdvertisingMetrics {
	return {
		ctr: safeRatio(row.clicks, row.impressions),
		cvr: safeRatio(row.attributedOrders, row.clicks),
		cpc: safeRatio(row.spend, row.clicks),
		acos: safeRatio(row.spend, row.attributedSales),
		roas: safeRatio(row.attributedSales, row.spend),
	};
}
