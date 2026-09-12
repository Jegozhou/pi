import type { SellerChangeSet } from "../change-set/types.ts";

export interface BidPolicy {
	maxDecreaseFraction: number;
	minimumBid: number;
	currencyDecimals: number;
}

export interface BidSimulationInput {
	currentBid: number;
	observedAcos: number;
	targetAcos: number;
}

export type BidGuardrailApplied = "max-decrease" | "minimum-bid" | null;

export interface BidSimulation {
	currentBid: number;
	observedAcos: number;
	targetAcos: number;
	rawBid: number;
	proposedBid: number;
	absoluteDelta: number;
	percentDelta: number;
	guardrailApplied: BidGuardrailApplied;
	policy: BidPolicy;
}

export type BidPolicyOverrides = Partial<BidPolicy>;

export interface BidPolicyDiagnostics {
	readyProposalIds: string[];
	blockedProposalIds: string[];
	simulations: Array<{ proposalId: string; simulation: BidSimulation }>;
}

export interface BidPolicyApplicationResult {
	changeSet: SellerChangeSet;
	diagnostics: BidPolicyDiagnostics;
}
