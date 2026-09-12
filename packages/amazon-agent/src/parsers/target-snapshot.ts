import { parseDelimitedText } from "./delimited.ts";
import type { ReportDelimiter } from "../types/advertising.ts";
import type {
	NormalizedTargetSnapshotRow,
	TargetSnapshotInspection,
	TargetSnapshotParseResult,
	TargetSnapshotSemanticField,
	TargetSnapshotWarning,
} from "../types/targeting.ts";

type ColumnMap = Partial<Record<TargetSnapshotSemanticField, number>>;

const REQUIRED_FIELDS = ["campaignName", "campaignId", "adGroupName", "adGroupId"] as const;

const HEADER_ALIASES: Readonly<Record<TargetSnapshotSemanticField, readonly string[]>> = {
	campaignName: ["campaignname", "campaign"],
	campaignId: ["campaignid", "campaignidentifier"],
	adGroupName: ["adgroupname", "adgroup"],
	adGroupId: ["adgroupid", "adgroupidentifier"],
	targeting: ["targeting", "target", "keyword", "keywordtext", "targetingexpression"],
	matchType: ["matchtype", "targetingmatchtype"],
	targetId: ["targetid", "targetingid", "keywordid"],
	currentBid: ["bid", "currentbid", "keywordbid", "targetbid"],
	state: ["state", "status"],
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
	const canonicalHeaders = headers.map(canonicalizeHeader);
	const result: ColumnMap = {};
	for (const field of Object.keys(HEADER_ALIASES) as TargetSnapshotSemanticField[]) {
		const index = canonicalHeaders.findIndex((header) => HEADER_ALIASES[field].includes(header));
		if (index !== -1) result[field] = index;
	}
	return result;
}

function cell(row: readonly string[], columns: ColumnMap, field: TargetSnapshotSemanticField): string | null {
	const index = columns[field];
	if (index === undefined) return null;
	const value = row[index];
	return value === undefined || value.trim() === "" ? null : value.trim();
}

function parseBid(rawValue: string | null, sourceRow: number): { value: number | null; warning: TargetSnapshotWarning | null } {
	if (rawValue === null) return { value: null, warning: null };
	const value = Number(rawValue);
	if (!Number.isFinite(value) || value <= 0) {
		return {
			value: null,
			warning: {
				code: "invalid-number",
				field: "currentBid",
				rawValue,
				sourceRow,
				message: `Invalid numeric value for currentBid at source row ${sourceRow}: ${rawValue}`,
			},
		};
	}
	return { value, warning: null };
}

export function normalizeTargetSnapshot(options: { content: string; fileName: string }): TargetSnapshotParseResult {
	const delimiter = detectDelimiter(options.content);
	const parsedRows = parseDelimitedText(options.content, delimiter);
	const headers = parsedRows[0] ?? [];
	const columns = mapColumns(headers);
	const missingFields = REQUIRED_FIELDS.filter((field) => columns[field] === undefined);
	if (missingFields.length > 0) {
		throw new Error(`Target snapshot is missing required fields: ${missingFields.join(", ")}`);
	}

	const warnings: TargetSnapshotWarning[] = [];
	const rows: NormalizedTargetSnapshotRow[] = parsedRows.slice(1).map((row, index) => {
		const sourceRow = index + 2;
		const bid = parseBid(cell(row, columns, "currentBid"), sourceRow);
		if (bid.warning) warnings.push(bid.warning);
		return {
			campaignName: cell(row, columns, "campaignName") ?? "",
			campaignId: cell(row, columns, "campaignId") ?? "",
			adGroupName: cell(row, columns, "adGroupName") ?? "",
			adGroupId: cell(row, columns, "adGroupId") ?? "",
			targeting: cell(row, columns, "targeting"),
			matchType: cell(row, columns, "matchType"),
			targetId: cell(row, columns, "targetId"),
			currentBid: bid.value,
			state: cell(row, columns, "state"),
			sourceFile: options.fileName,
			sourceRow,
		};
	});

	const inspection: TargetSnapshotInspection = {
		delimiter,
		headers,
		missingFields: [],
		warnings,
		rowCount: rows.length,
	};

	return { inspection, rows };
}
