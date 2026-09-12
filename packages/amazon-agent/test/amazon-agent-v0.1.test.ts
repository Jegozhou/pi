import { describe, expect, it } from "vitest";
import {
	calculateAdvertisingMetrics,
	DelimitedTextError,
	inspectAdvertisingReport,
	type NormalizedAdvertisingRow,
	normalizeSearchTermReport,
	parseDelimitedText,
} from "../../amazon-agent/src/index.ts";

describe("Amazon Seller Agent V0.1 domain foundation", () => {
	it("keeps unavailable Amazon measures explicit in normalized records", () => {
		const row: NormalizedAdvertisingRow = {
			campaignName: "Discovery",
			adGroupName: "AG 1",
			targeting: "running shoes",
			matchType: "broad",
			customerSearchTerm: "trail running shoes",
			impressions: 100,
			clicks: 10,
			spend: 8,
			attributedOrders: null,
			attributedUnits: null,
			attributedSales: null,
			currency: "USD",
			sourceFile: "search-term.csv",
			sourceRow: 2,
		};

		expect(row.attributedSales).toBeNull();
	});

	it("parses CSV and TSV including quoted delimiters, escaped quotes, and quoted newlines", () => {
		expect(parseDelimitedText('name,term\r\nA,"shoe, blue"', ",")).toEqual([
			["name", "term"],
			["A", "shoe, blue"],
		]);
		expect(parseDelimitedText('name\tterm\nA\t"trail ""shoe"""', "\t")).toEqual([
			["name", "term"],
			["A", 'trail "shoe"'],
		]);
		expect(parseDelimitedText('name,term\nA,"trail\nrunning"', ",")).toEqual([
			["name", "term"],
			["A", "trail\nrunning"],
		]);
	});

	it("rejects malformed delimited files instead of guessing", () => {
		expect(() => parseDelimitedText('name,term\nA,"broken', ",")).toThrow(DelimitedTextError);
		expect(() => parseDelimitedText("a,b\n1,2,3", ",")).toThrow(DelimitedTextError);
	});

	it("recognizes and normalizes common Sponsored Products search-term headers", () => {
		const content = [
			"Campaign Name,Ad Group Name,Targeting,Match Type,Customer Search Term,Impressions,Clicks,Spend,7 Day Total Orders (#),7 Day Total Units (#),7 Day Total Sales,Currency",
			"Discovery,AG 1,running shoes,BROAD,trail running shoes,1000,20,10,4,5,50,USD",
		].join("\n");

		const inspection = inspectAdvertisingReport({ content, fileName: "search-term.csv" });
		expect(inspection.kind).toBe("sponsored-products-search-term");
		expect(inspection.missingFields).toEqual([]);
		expect(inspection.warnings).toEqual([]);
		expect(inspection.rowCount).toBe(1);

		const rows = normalizeSearchTermReport({ content, fileName: "search-term.csv" });
		expect(rows).toEqual([
			{
				campaignName: "Discovery",
				adGroupName: "AG 1",
				targeting: "running shoes",
				matchType: "BROAD",
				customerSearchTerm: "trail running shoes",
				impressions: 1000,
				clicks: 20,
				spend: 10,
				attributedOrders: 4,
				attributedUnits: 5,
				attributedSales: 50,
				currency: "USD",
				sourceFile: "search-term.csv",
				sourceRow: 2,
			},
		]);
	});

	it("accepts API-style aliases and reordered TSV columns", () => {
		const content = [
			"searchTerm\tcost\tclicks\timpressions\tsales7d\tadGroupName\tcampaignName\tpurchases7d",
			"phone case\t12.5\t25\t500\t100\tAG A\tAuto A\t5",
		].join("\n");

		const inspection = inspectAdvertisingReport({ content, fileName: "api.tsv" });
		expect(inspection.kind).toBe("sponsored-products-search-term");
		expect(inspection.delimiter).toBe("\t");

		const [row] = normalizeSearchTermReport({ content, fileName: "api.tsv" });
		expect(row).toMatchObject({
			campaignName: "Auto A",
			adGroupName: "AG A",
			customerSearchTerm: "phone case",
			impressions: 500,
			clicks: 25,
			spend: 12.5,
			attributedOrders: 5,
			attributedSales: 100,
		});
	});

	it("fails closed when required semantic fields are absent", () => {
		const content = "Campaign Name,Ad Group Name,Customer Search Term,Impressions,Clicks,Spend\nC,A,term,100,3,2";
		const inspection = inspectAdvertisingReport({ content, fileName: "missing-sales.csv" });

		expect(inspection.kind).toBe("unknown");
		expect(inspection.missingFields).toContain("attributedSales");
		expect(() => normalizeSearchTermReport({ content, fileName: "missing-sales.csv" })).toThrow(/required fields/i);
	});

	it("reports invalid numeric cells as warnings and never fabricates zero", () => {
		const content = [
			"Campaign Name,Ad Group Name,Customer Search Term,Impressions,Clicks,Spend,Sales",
			"C,A,term,not-a-number,3,2,20",
		].join("\n");

		const inspection = inspectAdvertisingReport({ content, fileName: "bad-number.csv" });
		expect(inspection.warnings).toEqual([
			expect.objectContaining({
				code: "invalid-number",
				field: "impressions",
				rawValue: "not-a-number",
				sourceRow: 2,
			}),
		]);

		const [row] = normalizeSearchTermReport({ content, fileName: "bad-number.csv" });
		expect(row.impressions).toBeNull();
	});

	it("calculates advertising metrics deterministically without rounding", () => {
		const row: NormalizedAdvertisingRow = {
			campaignName: "C",
			adGroupName: "A",
			targeting: null,
			matchType: null,
			customerSearchTerm: "term",
			impressions: 1000,
			clicks: 20,
			spend: 10,
			attributedOrders: 4,
			attributedUnits: null,
			attributedSales: 50,
			currency: null,
			sourceFile: "fixture.csv",
			sourceRow: 2,
		};

		expect(calculateAdvertisingMetrics(row)).toEqual({
			ctr: 0.02,
			cvr: 0.2,
			cpc: 0.5,
			acos: 0.2,
			roas: 5,
		});
	});

	it("returns null for unavailable or zero-denominator metrics", () => {
		const row: NormalizedAdvertisingRow = {
			campaignName: "C",
			adGroupName: "A",
			targeting: null,
			matchType: null,
			customerSearchTerm: "term",
			impressions: 0,
			clicks: 0,
			spend: 0,
			attributedOrders: null,
			attributedUnits: null,
			attributedSales: 0,
			currency: null,
			sourceFile: "fixture.csv",
			sourceRow: 2,
		};

		expect(calculateAdvertisingMetrics(row)).toEqual({
			ctr: null,
			cvr: null,
			cpc: null,
			acos: null,
			roas: null,
		});
	});
});
