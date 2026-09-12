import { calculateProfitabilityMetrics } from "../metrics/profitability.ts";
import type {
	NormalizedProfitabilityRow,
	ProfitabilityFinding,
	ProfitabilityMetrics,
} from "../types/profitability.ts";

export interface ProfitabilityPolicy {
	requiredContributionMargin: number | null;
}

function entityFor(row: NormalizedProfitabilityRow): { type: "asin" | "sku"; value: string } | null {
	if (row.asin) return { type: "asin", value: row.asin };
	if (row.sku) return { type: "sku", value: row.sku };
	return null;
}

function createProfitFinding(options: {
	ruleId: string;
	priority: "high" | "medium";
	confidence: "high" | "medium";
	row: NormalizedProfitabilityRow;
	metrics: ProfitabilityMetrics;
	policy: ProfitabilityPolicy;
	rationale: string;
}): ProfitabilityFinding | null {
	const entity = entityFor(options.row);
	if (!entity) return null;
	return {
		id: `${options.ruleId}:${options.row.sourceFile}:${options.row.sourceRow}:${entity.value}`,
		ruleId: options.ruleId,
		category: "profit-risk",
		priority: options.priority,
		confidence: options.confidence,
		entity,
		metrics: options.metrics,
		dataQuality: options.metrics.status,
		evidence: [{ sourceFile: options.row.sourceFile, sourceRow: options.row.sourceRow }],
		thresholds: { requiredContributionMargin: options.policy.requiredContributionMargin },
		rationale: options.rationale,
		recommendedAction: {
			type: "review-profitability-candidate",
			summary: "Review price, advertising pressure, Amazon fees, and product costs before changing spend.",
		},
		humanApprovalRequired: true,
	};
}

export function diagnoseProfitability(
	rows: readonly NormalizedProfitabilityRow[],
	policy: ProfitabilityPolicy,
): ProfitabilityFinding[] {
	if (
		policy.requiredContributionMargin !== null &&
		(!Number.isFinite(policy.requiredContributionMargin) ||
			policy.requiredContributionMargin < 0 ||
			policy.requiredContributionMargin >= 1)
	) {
		throw new RangeError("requiredContributionMargin must be null or a finite number in [0, 1)");
	}

	const findings: ProfitabilityFinding[] = [];
	for (const row of rows) {
		const metrics = calculateProfitabilityMetrics(row);
		if (metrics.knownContributionProfit !== null && metrics.knownContributionProfit < 0) {
			const finding = createProfitFinding({
				ruleId: "profit.negative-known-contribution.v1",
				priority: "high",
				confidence: "high",
				row,
				metrics,
				policy,
				rationale:
					"Known supplied costs already exceed gross sales. Missing costs cannot improve this result, so profitability is at risk even when data is partial.",
			});
			if (finding) findings.push(finding);
		}

		if (
			policy.requiredContributionMargin !== null &&
			metrics.knownContributionMargin !== null &&
			metrics.knownContributionMargin < policy.requiredContributionMargin
		) {
			const finding = createProfitFinding({
				ruleId: "profit.below-required-margin.v1",
				priority: metrics.knownContributionMargin < 0 ? "high" : "medium",
				confidence: metrics.status === "complete" ? "high" : "medium",
				row,
				metrics,
				policy,
				rationale: `Known contribution margin ${metrics.knownContributionMargin} is below the seller-required margin ${policy.requiredContributionMargin}.`,
			});
			if (finding) findings.push(finding);
		}
	}

	return findings.sort((left, right) => {
		const priorityDifference = (left.priority === "high" ? 0 : 1) - (right.priority === "high" ? 0 : 1);
		if (priorityDifference !== 0) return priorityDifference;
		const fileDifference = left.evidence[0].sourceFile.localeCompare(right.evidence[0].sourceFile);
		if (fileDifference !== 0) return fileDifference;
		return left.evidence[0].sourceRow - right.evidence[0].sourceRow;
	});
}
