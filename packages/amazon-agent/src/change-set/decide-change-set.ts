import { computeSellerChangeSetContentDigest } from "../approval/approval-envelope.ts";
import type { SellerChangeSet, SellerChangeSetDecisionInput } from "./types.ts";

function isMutatingProposal(operation: string): boolean {
	return operation !== "review-profitability";
}

function cloneChangeSet(changeSet: SellerChangeSet): SellerChangeSet {
	return {
		...changeSet,
		sourceActionItemIds: [...changeSet.sourceActionItemIds],
		proposals: changeSet.proposals.map((proposal) => ({
			...proposal,
			entity: { ...proposal.entity },
			...(proposal.context ? { context: { ...proposal.context } } : {}),
			...(proposal.decisionContext ? { decisionContext: { ...proposal.decisionContext } } : {}),
			evidence: proposal.evidence.map((evidence) => ({ ...evidence })),
			missingInputs: [...proposal.missingInputs],
			before: proposal.before ? { ...proposal.before } : null,
			after: proposal.after ? { ...proposal.after } : null,
		})),
		decision: changeSet.decision ? { ...changeSet.decision } : null,
	};
}

export function requestSellerChangeSetApproval(changeSet: SellerChangeSet): SellerChangeSet {
	if (changeSet.status !== "draft") {
		throw new Error(`Approval can only be requested from draft status; received ${changeSet.status}`);
	}

	const mutating = changeSet.proposals.filter((proposal) => isMutatingProposal(proposal.operation));
	const blocked = mutating.filter((proposal) => proposal.readiness === "blocked");
	if (blocked.length > 0) {
		throw new Error(`Cannot request approval while ${blocked.length} mutating proposal(s) are blocked`);
	}

	const ready = mutating.filter((proposal) => proposal.readiness === "ready");
	if (ready.length === 0) {
		throw new Error("Cannot request approval without at least one ready mutating proposal");
	}

	const cloned = cloneChangeSet(changeSet);
	return {
		...cloned,
		version: changeSet.version + 1,
		status: "awaiting-approval",
		decision: null,
	};
}

function assertCanonicalIsoTimestamp(value: string): void {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
		throw new RangeError("decidedAt must be a canonical ISO timestamp");
	}
}

export function decideSellerChangeSet(
	changeSet: SellerChangeSet,
	input: SellerChangeSetDecisionInput,
): SellerChangeSet {
	if (changeSet.status !== "awaiting-approval") {
		throw new Error(`Decision requires awaiting-approval status; received ${changeSet.status}`);
	}
	const actor = input.actor.trim();
	if (!actor) {
		throw new RangeError("actor must be a non-empty string");
	}
	assertCanonicalIsoTimestamp(input.decidedAt);

	const outcome = input.decision === "approve" ? "approved" : "rejected";
	const cloned = cloneChangeSet(changeSet);
	const decided: SellerChangeSet = {
		...cloned,
		version: changeSet.version + 1,
		status: outcome,
		decision: {
			outcome,
			actor,
			decidedAt: input.decidedAt,
			provenance: input.provenance ?? "trusted-caller",
		},
	};

	if (outcome === "approved" && decided.decision) {
		decided.decision.contentDigest = computeSellerChangeSetContentDigest(decided);
	}
	return decided;
}
