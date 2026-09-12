import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAmazonReportFile } from "../../../.pi/extensions/amazon-seller/file-input.ts";
import { buildPpcDiagnosisResult, buildReportInspectionResult } from "../../amazon-agent/src/index.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function supportedReport(row = "Discovery,AG 1,running shoes,BROAD,trail running shoes,1000,20,20,4,100,USD") {
	return [
		"Campaign Name,Ad Group Name,Targeting,Match Type,Customer Search Term,Impressions,Clicks,Spend,7 Day Total Orders (#),7 Day Total Sales,Currency",
		row,
	].join("\n");
}

describe("Amazon Pi tool orchestration", () => {
	it("returns a normalized preview for a supported report", () => {
		const result = buildReportInspectionResult(supportedReport(), "search-term.csv");

		expect(result.inspection.kind).toBe("sponsored-products-search-term");
		expect(result.preview).toHaveLength(1);
		expect(result.preview?.[0]).toMatchObject({
			campaignName: "Discovery",
			customerSearchTerm: "trail running shoes",
			spend: 20,
			attributedSales: 100,
		});
	});

	it("fails closed without a normalized preview for an unsupported report", () => {
		const result = buildReportInspectionResult("Campaign Name,Clicks\nC,3", "unsupported.csv");

		expect(result.inspection.kind).toBe("unknown");
		expect(result.preview).toBeNull();
		expect(result.inspection.missingFields).toContain("attributedSales");
	});

	it("exposes effective policy and deterministic finding counts", () => {
		const result = buildPpcDiagnosisResult(supportedReport(), "search-term.csv", { targetAcos: 0.3 });

		expect(result.rowsAnalyzed).toBe(1);
		expect(result.policy.targetAcos).toBe(0.3);
		expect(result.findingsCount).toBe(2);
		expect(result.byCategory).toEqual({
			waste: 0,
			"bid-down": 0,
			migration: 1,
			scale: 1,
		});
		expect(result.findings.every((finding) => finding.humanApprovalRequired)).toBe(true);
	});

	it("keeps target ACOS null when omitted and suppresses target-dependent findings", () => {
		const result = buildPpcDiagnosisResult(supportedReport(), "search-term.csv");

		expect(result.policy.targetAcos).toBeNull();
		expect(result.findings).toEqual([]);
	});

	it("preserves parse warnings during inspection and rejects invalid numeric diagnosis", () => {
		const report = supportedReport(
			"Discovery,AG 1,running shoes,BROAD,trail running shoes,not-a-number,20,30,0,0,USD",
		);
		const inspection = buildReportInspectionResult(report, "bad.csv");

		expect(inspection.inspection.warnings).toEqual([
			expect.objectContaining({ field: "impressions", sourceRow: 2, rawValue: "not-a-number" }),
		]);
		expect(() => buildPpcDiagnosisResult(report, "bad.csv")).toThrow(/invalid numeric|data quality/i);
	});

	it("rejects directories as report files", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-amazon-"));
		tempDirectories.push(directory);

		await expect(readAmazonReportFile(directory)).rejects.toThrow(/regular file/i);
	});

	it("rejects files above the explicit size boundary", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-amazon-"));
		tempDirectories.push(directory);
		const filePath = join(directory, "large.csv");
		await writeFile(filePath, Buffer.alloc(25 * 1024 * 1024 + 1));

		await expect(readAmazonReportFile(filePath)).rejects.toThrow(/25 MiB/i);
	});
});
