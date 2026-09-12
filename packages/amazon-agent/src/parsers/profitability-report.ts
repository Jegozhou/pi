import { parseDelimitedText } from "./delimited.ts";
import type { ReportDelimiter } from "../types/advertising.ts";
import type {
	NormalizedProfitabilityRow,
	ProfitabilityNumericField,
	ProfitabilityReportInspection,
	ProfitabilityWarning,
} from "../types/profitability.ts";

type ProfitabilitySemanticField =
	| "marketplace"
	| "asin"
	| "sku"
	| ProfitabilityNumericField
	| "currency";

type ColumnMap = Partial<Record<ProfitabilitySemanticField, number>>;

const NUMERIC_FIELDS: readonly ProfitabilityNumericField[] = [
	"unitsSold",
	"grossSales",
	"refundsAmount",
	"amazonFees",
	"fulfillmentFees",
	"storageFees",
	"advertisingSpend",
	"cogsPerUnit",
	"otherVariableCosts",
];

const HEADER_ALIASES: Readonly<Record<ProfitabilitySemanticField, readonly string[]>> = {
	marketplace: ["marketplace", "marketplaceid", "market"],
	asin: ["asin"],
	sku: ["sku", "sellersku", "merchantsku"],
	unitsSold: ["unitssold", "units", "quantity", "quantitysold"],
	grossSales: ["grosssales", "sales", "productsales", "revenue"],
	refundsAmount: ["refunds", "refundamount", "refundsamount", "returnsamount"],
	amazonFees: ["amazonfees", "sellingfees", "referralfees"],
	fulfillmentFees: ["fulfillmentfees", "fbafees", "fbafee"],
	storageFees: ["storagefees", "storagefee"],
	advertisingSpend: ["advertisingspend", "adspend", "ppcspend"],
	cogsPerUnit: ["cogsperunit", "unitcost", "productcost", "costperunit"],
	otherVariableCosts: ["othervariablecosts", "othervariablecost", "othercosts"],
	currency: ["currency", "currencycode"],
};

function canonicalizeHeader(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectDelimiter(content: string): ReportDelimiter {
	const firstLineEnd = content.search(/[\r\n]/);
	const firstLine = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
	return firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";
}

function mapColumns(headers: readonly string[]): ColumnMap {
	const canonical = headers.map(canonicalizeHeader);
	const result: ColumnMap = {};
	for (const field of Object.keys(HEADER_ALIASES) as ProfitabilitySemanticField[]) {
		const index = canonical.findIndex((header) => HEADER_ALIASES[field].includes(header));
		if (index !== -1) result[field] = index;
	}
	return result;
}

function getCell(row: readonly string[], columns: ColumnMap, field: ProfitabilitySemanticField): string | null {
	const index = columns[field];
	if (index === undefined) return null;
	const value = row[index];
	return value === undefined || value.trim() === "" ? null : value.trim();
}

function parseNumber(
	rawValue: string | null,
	field: ProfitabilityNumericField,
	sourceRow: number,
): { value: number | null; warning: ProfitabilityWarning | null } {
	if (rawValue === null) return { value: null, warning: null };
	const value = Number(rawValue);
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

export function normalizeProfitabilityReport(options: {
	content: string;
	fileName: string;
}): { inspection: ProfitabilityReportInspection; rows: NormalizedProfitabilityRow[] } {
	const delimiter = detectDelimiter(options.content);
	const parsedRows = parseDelimitedText(options.content, delimiter);
	const headers = parsedRows[0] ?? [];
	const columns = mapColumns(headers);
	const missingFields: Array<"asinOrSku" | "grossSales"> = [];
	if (columns.asin === undefined && columns.sku === undefined) missingFields.push("asinOrSku");
	if (columns.grossSales === undefined) missingFields.push("grossSales");
	if (missingFields.length > 0) {
		return {
			inspection: { delimiter, headers, missingFields, warnings: [], rowCount: Math.max(0, parsedRows.length - 1) },
			rows: [],
		};
	}

	const warnings: ProfitabilityWarning[] = [];
	const rows = parsedRows.slice(1).map((row, index): NormalizedProfitabilityRow => {
		const sourceRow = index + 2;
		const numbers: Partial<Record<ProfitabilityNumericField, number | null>> = {};
		for (const field of NUMERIC_FIELDS) {
			const parsed = parseNumber(getCell(row, columns, field), field, sourceRow);
			numbers[field] = parsed.value;
			if (parsed.warning) warnings.push(parsed.warning);
		}

		return {
			marketplace: getCell(row, columns, "marketplace"),
			asin: getCell(row, columns, "asin"),
			sku: getCell(row, columns, "sku"),
			unitsSold: numbers.unitsSold ?? null,
			grossSales: numbers.grossSales ?? null,
			refundsAmount: numbers.refundsAmount ?? null,
			amazonFees: numbers.amazonFees ?? null,
			fulfillmentFees: numbers.fulfillmentFees ?? null,
			storageFees: numbers.storageFees ?? null,
			advertisingSpend: numbers.advertisingSpend ?? null,
			cogsPerUnit: numbers.cogsPerUnit ?? null,
			otherVariableCosts: numbers.otherVariableCosts ?? null,
			currency: getCell(row, columns, "currency"),
			sourceFile: options.fileName,
			sourceRow,
		};
	});

	return {
		inspection: { delimiter, headers, missingFields, warnings, rowCount: rows.length },
		rows,
	};
}
