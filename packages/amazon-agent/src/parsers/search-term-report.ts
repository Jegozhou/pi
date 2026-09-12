import { parseDelimitedText } from "./delimited.ts";
import type {
	AdvertisingNumericField,
	AdvertisingSemanticField,
	NormalizedAdvertisingRow,
	ReportDelimiter,
	ReportInspection,
	ReportWarning,
} from "../types/advertising.ts";

type ColumnMap = Partial<Record<AdvertisingSemanticField, number>>;

const REQUIRED_FIELDS: readonly AdvertisingSemanticField[] = [
	"campaignName",
	"adGroupName",
	"customerSearchTerm",
	"impressions",
	"clicks",
	"spend",
	"attributedSales",
];

const NUMERIC_FIELDS: readonly AdvertisingNumericField[] = [
	"impressions",
	"clicks",
	"spend",
	"attributedOrders",
	"attributedUnits",
	"attributedSales",
];

const HEADER_ALIASES: Readonly<Record<AdvertisingSemanticField, readonly string[]>> = {
	campaignName: ["campaignname", "campaign"],
	adGroupName: ["adgroupname", "adgroup"],
	targeting: ["targeting", "targetingexpression", "keywordtext", "keyword", "target"],
	matchType: ["matchtype", "targetingmatchtype"],
	customerSearchTerm: ["customersearchterm", "searchterm", "query"],
	impressions: ["impressions"],
	clicks: ["clicks"],
	spend: ["spend", "cost"],
	attributedOrders: ["orders", "7daytotalorders", "7dayorders", "purchases7d", "purchases"],
	attributedUnits: ["units", "7daytotalunits", "7dayunits", "unitssoldclicks7d"],
	attributedSales: ["sales", "7daytotalsales", "7daysales", "sales7d", "salesclicks7d"],
	currency: ["currency", "currencycode"],
};

function canonicalizeHeader(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectDelimiter(content: string): ReportDelimiter {
	const firstLineEnd = content.search(/[\r\n]/);
	const firstLine = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
	let commas = 0;
	let tabs = 0;
	let inQuotes = false;

	for (let index = 0; index < firstLine.length; index += 1) {
		const char = firstLine[index];
		if (char === '"') {
			if (inQuotes && firstLine[index + 1] === '"') {
				index += 1;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}
		if (!inQuotes && char === ",") commas += 1;
		if (!inQuotes && char === "\t") tabs += 1;
	}

	return tabs > commas ? "\t" : ",";
}

function mapColumns(headers: readonly string[]): ColumnMap {
	const result: ColumnMap = {};
	const canonicalHeaders = headers.map(canonicalizeHeader);
	for (const field of Object.keys(HEADER_ALIASES) as AdvertisingSemanticField[]) {
		const aliases = HEADER_ALIASES[field];
		const index = canonicalHeaders.findIndex((header) => aliases.includes(header));
		if (index !== -1) result[field] = index;
	}
	return result;
}

function getCell(row: readonly string[], columns: ColumnMap, field: AdvertisingSemanticField): string | null {
	const index = columns[field];
	if (index === undefined) return null;
	return row[index] ?? null;
}

function parseNumber(
	rawValue: string | null,
	field: AdvertisingNumericField,
	sourceRow: number,
): { value: number | null; warning: ReportWarning | null } {
	if (rawValue === null || rawValue.trim() === "") return { value: null, warning: null };
	const value = Number(rawValue.trim());
	if (!Number.isFinite(value)) {
		return {
			value: null,
			warning: {
				code: "invalid-number",
				field,
				rawValue,
				sourceRow,
				message: `Invalid numeric value for ${field} at source row ${sourceRow}: ${rawValue}`,
			},
		};
	}
	return { value, warning: null };
}

function parseReport(content: string): {
	delimiter: ReportDelimiter;
	rows: string[][];
	headers: string[];
	columns: ColumnMap;
	missingFields: AdvertisingSemanticField[];
} {
	const delimiter = detectDelimiter(content);
	const rows = parseDelimitedText(content, delimiter);
	const headers = rows[0] ?? [];
	const columns = mapColumns(headers);
	const missingFields = REQUIRED_FIELDS.filter((field) => columns[field] === undefined);
	return { delimiter, rows, headers, columns, missingFields };
}

function collectWarnings(rows: readonly string[][], columns: ColumnMap): ReportWarning[] {
	const warnings: ReportWarning[] = [];
	for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
		for (const field of NUMERIC_FIELDS) {
			const parsed = parseNumber(getCell(rows[rowIndex], columns, field), field, rowIndex + 1);
			if (parsed.warning) warnings.push(parsed.warning);
		}
	}
	return warnings;
}

export function inspectAdvertisingReport(options: { content: string; fileName: string }): ReportInspection {
	const parsed = parseReport(options.content);
	return {
		kind: parsed.missingFields.length === 0 ? "sponsored-products-search-term" : "unknown",
		delimiter: parsed.delimiter,
		headers: parsed.headers,
		missingFields: parsed.missingFields,
		warnings: collectWarnings(parsed.rows, parsed.columns),
		rowCount: Math.max(0, parsed.rows.length - 1),
	};
}

export function normalizeSearchTermReport(options: {
	content: string;
	fileName: string;
}): NormalizedAdvertisingRow[] {
	const parsed = parseReport(options.content);
	if (parsed.missingFields.length > 0) {
		throw new Error(`Search term report is missing required fields: ${parsed.missingFields.join(", ")}`);
	}

	return parsed.rows.slice(1).map((row, index) => {
		const sourceRow = index + 2;
		const impressions = parseNumber(getCell(row, parsed.columns, "impressions"), "impressions", sourceRow).value;
		const clicks = parseNumber(getCell(row, parsed.columns, "clicks"), "clicks", sourceRow).value;
		const spend = parseNumber(getCell(row, parsed.columns, "spend"), "spend", sourceRow).value;
		const attributedOrders = parseNumber(
			getCell(row, parsed.columns, "attributedOrders"),
			"attributedOrders",
			sourceRow,
		).value;
		const attributedUnits = parseNumber(
			getCell(row, parsed.columns, "attributedUnits"),
			"attributedUnits",
			sourceRow,
		).value;
		const attributedSales = parseNumber(
			getCell(row, parsed.columns, "attributedSales"),
			"attributedSales",
			sourceRow,
		).value;

		return {
			campaignName: getCell(row, parsed.columns, "campaignName") ?? "",
			adGroupName: getCell(row, parsed.columns, "adGroupName") ?? "",
			targeting: getCell(row, parsed.columns, "targeting"),
			matchType: getCell(row, parsed.columns, "matchType"),
			customerSearchTerm: getCell(row, parsed.columns, "customerSearchTerm") ?? "",
			impressions,
			clicks,
			spend,
			attributedOrders,
			attributedUnits,
			attributedSales,
			currency: getCell(row, parsed.columns, "currency"),
			sourceFile: options.fileName,
			sourceRow,
		};
	});
}
