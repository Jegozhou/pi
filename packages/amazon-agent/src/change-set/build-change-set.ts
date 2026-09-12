import { createHash } from "node:crypto";
import type { SellerActionPlanItem } from "../action-plan/types.ts";
import type { SellerChangeOperation, SellerChangeProposal, SellerChangeSet, SellerChangeSetInput } from "./types.ts";

function operationFor(item: SellerActionPlanItem): {
	operation: SellerChangeOperation;
	readiness: SellerChangeProposal["readiness"];
	missingInputs: string[];
} {
	switch (item.recommendedAction.type) {
		case "negative-exact-candidate":
			return {
				operation: "add-negative-exact",
				readiness: "blocked",
				missingInputs: ["campaign identity", "ad group identity"],
			};
		case "reduce-bid-candidate":
			return {
				operation: "set-bid",
				readiness: "blocked",
				missingInputs: ["target identity", "current bid", "proposed bid"],
			};
		case "exact-target-candidate":
			return {
				operation: "create-exact-target",
				readiness: "blocked",
				missingInputs: ["destination campaign identity", "destination ad group identity", "proposed bid"],
			};
		case "scale-candidate":
			return {
				operation: "scale",
				readiness: "blocked",
				missingInputs: ["scale mechanism", "target identity", "current value", "proposed value"],
			};
		case "review-profitability-candidate":
			return { operation: "review-profitability", readiness: "review-only", missingInputs: [] };
		default:
			throw new Error(`Unsupported seller action type: ${item.recommendedAction.type}`);
	}
}

function proposalFor(item: SellerActionPlanItem): SellerChangeProposal {
	const mapped = operationFor(item);
	return {
		id: `change:${item.id}`,
		sourceActionItemId: item.id,
		sourceFindingId: item.sourceFindingId,
		sourceRuleId: item.sourceRuleId,
		operation: mapped.operation,
		readiness: mapped.readiness,
		entity: { ...item.entity },
		...(item.context ? { context: { ...item.context } } : {}),
		...(item.decisionContext ? { decisionContext: { ...item.decisionContext } } : {}),
		rationale: item.rationale,
		evidence: item.evidence.map((evidence) => ({ ...evidence })),
		missingInputs: [...mapped.missingInputs],
		before: null,
		after: null,
		humanApprovalRequired: true,
	};
}

function changeSetIdentity(sourceActionItemIds: readonly string[]): string {
	return createHash("sha256").update(JSON.stringify(sourceActionItemIds)).digest("hex").slice(0, 24);
}

export function buildSellerChangeSet(input: SellerChangeSetInput): SellerChangeSet {
	const sourceActionItemIds = input.items.map((item) => item.id);
	return {
		id: `changeset:v1:${changeSetIdentity(sourceActionItemIds)}`,
		version: 1,
		status: "draft",
		sourceActionItemIds,
		proposals: input.items.map(proposalFor),
		decision: null,
	};
}
