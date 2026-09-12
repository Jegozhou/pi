import { calculateAdvertisingMetrics } from "../metrics/advertising.ts";
import type { NormalizedAdvertisingRow } from "../types/advertising.ts";
import { evaluateEfficientSearchTerm, evaluateScaleEfficientTarget } from "./rules/efficient-search-term.ts";
import { evaluateHighAcos } from "./rules/high-acos.ts";
import { evaluateWasteWithoutSales } from "./rules/waste-without-sales.ts";
import type { Finding, FindingPriority, PpcPolicy } from "./types.ts";

const PRIORITY_ORDER: Readonly<Record<FindingPriority, number>> = {
	high: 0,
	medium: 1,
	low: 2,
};

function validatePolicy(policy: PpcPolicy): void {
	if (policy.targetAcos !== null && (!Number.isFinite(policy.targetAcos) || policy.targetAcos <= 0)) {
		throw new RangeError("targetAcos must be null or a positive finite number");
	}
	if (!Number.isFinite(policy.minimumClicksNoSale) || policy.minimumClicksNoSale < 0) {
		throw new RangeError("minimumClicksNoSale must be a non-negative finite number");
	}
	if (!Number.isFinite(policy.minimumSpendNoSale) || policy.minimumSpendNoSale < 0) {
		throw new RangeError("minimumSpendNoSale must be a non-negative finite number");
	}
	if (!Number.isFinite(policy.minimumOrdersScale) || policy.minimumOrdersScale < 1) {
		throw new RangeError("minimumOrdersScale must be a positive finite number");
	}
	if (!Number.isFinite(policy.highAcosMultiplier) || policy.highAcosMultiplier < 1) {
		throw new RangeError("highAcosMultiplier must be a finite number greater than or equal to 1");
	}
	if (!Number.isFinite(policy.lowAcosScaleMargin) || policy.lowAcosScaleMargin < 0 || policy.lowAcosScaleMargin >= 1) {
		throw new RangeError("lowAcosScaleMargin must be a finite number in [0, 1)");
	}
}

export function diagnosePpc(rows: readonly NormalizedAdvertisingRow[], policy: PpcPolicy): Finding[] {
	validatePolicy(policy);
	const findings: Finding[] = [];

	for (const row of rows) {
		const metrics = calculateAdvertisingMetrics(row);
		const candidates = [
			evaluateWasteWithoutSales(row, metrics, policy),
			evaluateHighAcos(row, metrics, policy),
			evaluateEfficientSearchTerm(row, metrics, policy),
			evaluateScaleEfficientTarget(row, metrics, policy),
		];
		for (const finding of candidates) {
			if (finding !== null) findings.push(finding);
		}
	}

	return findings.sort((left, right) => {
		const priorityDifference = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
		if (priorityDifference !== 0) return priorityDifference;
		const fileDifference = left.evidence[0].sourceFile.localeCompare(right.evidence[0].sourceFile);
		if (fileDifference !== 0) return fileDifference;
		const rowDifference = left.evidence[0].sourceRow - right.evidence[0].sourceRow;
		if (rowDifference !== 0) return rowDifference;
		const ruleDifference = left.ruleId.localeCompare(right.ruleId);
		if (ruleDifference !== 0) return ruleDifference;
		return left.entity.value.localeCompare(right.entity.value);
	});
}
