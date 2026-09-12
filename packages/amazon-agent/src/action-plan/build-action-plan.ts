import type { Finding } from "../diagnostics/types.ts";
import type { ProfitabilityFinding } from "../types/profitability.ts";
import type {
	SellerActionDataQuality,
	SellerActionPlan,
	SellerActionPlanInput,
	SellerActionPlanItem,
	SellerActionSource,
	SellerActionStage,
} from "./types.ts";

const DEFAULT_LIMIT = 10;

interface RankedCandidate {
	score: number;
	item: Omit<SellerActionPlanItem, "rank">;
}

function evidenceLocation(evidence: Array<{ sourceFile: string; sourceRow: number }>): { file: string; row: number } {
	const first = evidence[0];
	return first ? { file: first.sourceFile, row: first.sourceRow } : { file: "", row: Number.MAX_SAFE_INTEGER };
}

function ppcRank(finding: Finding): { score: number; stage: SellerActionStage } {
	switch (finding.category) {
		case "waste": return { score: 400, stage: "stop-loss" };
		case "bid-down": return { score: 300, stage: "optimize" };
		case "migration": return { score: 200, stage: "optimize" };
		case "scale": return { score: 100, stage: "grow" };
	}
}

function profitabilityRank(finding: ProfitabilityFinding): { score: number; stage: SellerActionStage } {
	if (finding.ruleId === "profit.negative-known-contribution.v1") return { score: 500, stage: "stop-loss" };
	return { score: finding.priority === "high" ? 310 : 290, stage: "optimize" };
}

function createItem(options: {
	source: SellerActionSource;
	stage: SellerActionStage;
	dataQuality: SellerActionDataQuality;
	finding: Finding | ProfitabilityFinding;
}): Omit<SellerActionPlanItem, "rank"> {
	const { finding } = options;
	const context = "context" in finding ? finding.context : undefined;
	return {
		id: `action:${options.source}:${finding.id}`,
		source: options.source,
		stage: options.stage,
		priority: finding.priority,
		confidence: finding.confidence,
		dataQuality: options.dataQuality,
		entity: finding.entity,
		...(context ? { context: { ...context } } : {}),
		rationale: finding.rationale,
		recommendedAction: { type: finding.recommendedAction.type, summary: finding.recommendedAction.summary },
		evidence: finding.evidence.map((evidence) => ({ ...evidence })),
		sourceFindingId: finding.id,
		sourceRuleId: finding.ruleId,
		humanApprovalRequired: true,
	};
}

function validateLimit(limit: number): void {
	if (!Number.isInteger(limit) || limit <= 0) throw new RangeError("limit must be a positive integer");
}

export function buildSellerActionPlan(input: SellerActionPlanInput): SellerActionPlan {
	const limit = input.limit ?? DEFAULT_LIMIT;
	validateLimit(limit);
	const candidates: RankedCandidate[] = [];
	const seen = new Set<string>();

	for (const finding of input.ppcFindings) {
		const dedupeKey = `ppc:${finding.id}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		const rank = ppcRank(finding);
		candidates.push({ score: rank.score, item: createItem({ source: "ppc", stage: rank.stage, dataQuality: "not-applicable", finding }) });
	}

	for (const finding of input.profitabilityFindings) {
		const dedupeKey = `profitability:${finding.id}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		const rank = profitabilityRank(finding);
		candidates.push({ score: rank.score, item: createItem({ source: "profitability", stage: rank.stage, dataQuality: finding.dataQuality, finding }) });
	}

	candidates.sort((left, right) => {
		if (left.score !== right.score) return right.score - left.score;
		const leftLocation = evidenceLocation(left.item.evidence);
		const rightLocation = evidenceLocation(right.item.evidence);
		const fileDifference = leftLocation.file.localeCompare(rightLocation.file);
		if (fileDifference !== 0) return fileDifference;
		if (leftLocation.row !== rightLocation.row) return leftLocation.row - rightLocation.row;
		return left.item.sourceFindingId.localeCompare(right.item.sourceFindingId);
	});

	const items = candidates.slice(0, limit).map((candidate, index) => ({ ...candidate.item, rank: index + 1 }));
	return { totalFindings: candidates.length, returnedItems: items.length, items };
}
