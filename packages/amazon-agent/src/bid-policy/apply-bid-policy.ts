import type { SellerChangeProposal, SellerChangeSet } from "../change-set/types.ts";
import { simulateBidChange } from "./simulate-bid.ts";
import type { BidPolicyApplicationResult, BidPolicyOverrides, BidSimulation } from "./types.ts";

function cloneProposal(proposal: SellerChangeProposal): SellerChangeProposal {
	return {
		...proposal,
		entity: { ...proposal.entity },
		...(proposal.context ? { context: { ...proposal.context } } : {}),
		...(proposal.decisionContext ? { decisionContext: { ...proposal.decisionContext } } : {}),
		evidence: proposal.evidence.map((item) => ({ ...item })),
		missingInputs: [...proposal.missingInputs],
		before: proposal.before ? { ...proposal.before } : null,
		after: proposal.after ? { ...proposal.after } : null,
	};
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

function positiveNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function missingBidInputs(proposal: SellerChangeProposal): string[] {
	const missing: string[] = [];
	if (!stringValue(proposal.before?.targetId)) missing.push("target identity");
	if (positiveNumber(proposal.before?.currentBid) === null) missing.push("current bid");
	if (positiveNumber(proposal.decisionContext?.observedAcos) === null) missing.push("observed ACOS");
	if (positiveNumber(proposal.decisionContext?.targetAcos) === null) missing.push("target ACOS");
	return missing;
}

export function applyBidPolicyToChangeSet(
	changeSet: SellerChangeSet,
	policyOverrides: BidPolicyOverrides = {},
): BidPolicyApplicationResult {
	if (changeSet.status !== "draft") {
		throw new Error("Only draft Change Sets can be simulated");
	}

	const readyProposalIds: string[] = [];
	const blockedProposalIds: string[] = [];
	const simulations: BidPolicyApplicationResult["diagnostics"]["simulations"] = [];

	const proposals = changeSet.proposals.map((sourceProposal) => {
		const proposal = cloneProposal(sourceProposal);
		if (proposal.operation !== "set-bid") return proposal;

		const missing = missingBidInputs(proposal);
		if (missing.length > 0) {
			blockedProposalIds.push(proposal.id);
			return { ...proposal, readiness: "blocked" as const, missingInputs: missing, after: null };
		}

		const currentBid = positiveNumber(proposal.before?.currentBid) as number;
		const observedAcos = positiveNumber(proposal.decisionContext?.observedAcos) as number;
		const targetAcos = positiveNumber(proposal.decisionContext?.targetAcos) as number;

		if (observedAcos <= targetAcos) {
			blockedProposalIds.push(proposal.id);
			return {
				...proposal,
				readiness: "blocked" as const,
				missingInputs: ["bid policy precondition: observed ACOS above target ACOS"],
				after: null,
			};
		}

		let simulation: BidSimulation;
		try {
			simulation = simulateBidChange({ currentBid, observedAcos, targetAcos }, policyOverrides);
		} catch (error) {
			const message = error instanceof Error ? error.message : "bid simulation failed";
			if (/maxDecreaseFraction|minimumBid|currencyDecimals/.test(message)) throw error;
			blockedProposalIds.push(proposal.id);
			return { ...proposal, readiness: "blocked" as const, missingInputs: [message], after: null };
		}

		const targetId = stringValue(proposal.before?.targetId) as string;
		const after = {
			...(proposal.before ?? {}),
			targetId,
			proposedBid: simulation.proposedBid,
		};
		delete (after as Record<string, unknown>).currentBid;

		readyProposalIds.push(proposal.id);
		simulations.push({ proposalId: proposal.id, simulation });
		return {
			...proposal,
			readiness: "ready" as const,
			missingInputs: [],
			after,
		};
	});

	return {
		changeSet: {
			...changeSet,
			version: changeSet.version + 1,
			status: "draft",
			proposals,
			decision: null,
		},
		diagnostics: {
			readyProposalIds,
			blockedProposalIds,
			simulations,
		},
	};
}
