import type { ReportDelimiter } from "./advertising.ts";

export type TargetSnapshotSemanticField =
	| "campaignName"
	| "campaignId"
	| "adGroupName"
	| "adGroupId"
	| "targeting"
	| "matchType"
	| "targetId"
	| "currentBid"
	| "state";

export interface TargetSnapshotWarning {
	code: "invalid-number";
	field: "currentBid";
	rawValue: string;
	sourceRow: number;
	message: string;
}

export interface NormalizedTargetSnapshotRow {
	campaignName: string;
	campaignId: string;
	adGroupName: string;
	adGroupId: string;
	targeting: string | null;
	matchType: string | null;
	targetId: string | null;
	currentBid: number | null;
	state: string | null;
	sourceFile: string;
	sourceRow: number;
}

export interface TargetSnapshotInspection {
	delimiter: ReportDelimiter;
	headers: string[];
	missingFields: Array<"campaignName" | "campaignId" | "adGroupName" | "adGroupId">;
	warnings: TargetSnapshotWarning[];
	rowCount: number;
}

export interface TargetSnapshotParseResult {
	inspection: TargetSnapshotInspection;
	rows: NormalizedTargetSnapshotRow[];
}
