import type {
	BidPolicy,
	BidPolicyOverrides,
	BidSimulation,
	BidSimulationInput,
} from "./types.ts";

export const DEFAULT_BID_POLICY: BidPolicy = {
	maxDecreaseFraction: 0.2,
	minimumBid: 0.02,
	currencyDecimals: 2,
};

function requirePositiveFinite(value: number, label: string): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${label} must be a positive finite number`);
	}
}

function resolvePolicy(overrides: BidPolicyOverrides): BidPolicy {
	const policy = { ...DEFAULT_BID_POLICY, ...overrides };
	if (!Number.isFinite(policy.maxDecreaseFraction) || policy.maxDecreaseFraction <= 0 || policy.maxDecreaseFraction >= 1) {
		throw new RangeError("maxDecreaseFraction must be a finite number in (0, 1)");
	}
	if (!Number.isFinite(policy.minimumBid) || policy.minimumBid <= 0) {
		throw new RangeError("minimumBid must be a positive finite number");
	}
	if (!Number.isInteger(policy.currencyDecimals) || policy.currencyDecimals < 0 || policy.currencyDecimals > 6) {
		throw new RangeError("currencyDecimals must be an integer in [0, 6]");
	}
	return policy;
}

function roundCurrency(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function simulateBidChange(
	input: BidSimulationInput,
	policyOverrides: BidPolicyOverrides = {},
): BidSimulation {
	requirePositiveFinite(input.currentBid, "currentBid");
	requirePositiveFinite(input.observedAcos, "observedAcos");
	requirePositiveFinite(input.targetAcos, "targetAcos");
	if (input.observedAcos <= input.targetAcos) {
		throw new RangeError("observed ACOS must be above target ACOS for a bid-down simulation");
	}

	const policy = resolvePolicy(policyOverrides);
	const rawBid = input.currentBid * (input.targetAcos / input.observedAcos);
	const maximumDecreaseFloor = input.currentBid * (1 - policy.maxDecreaseFraction);

	let constrainedBid = rawBid;
	let guardrailApplied: BidSimulation["guardrailApplied"] = null;
	if (constrainedBid < maximumDecreaseFloor) {
		constrainedBid = maximumDecreaseFloor;
		guardrailApplied = "max-decrease";
	}
	if (constrainedBid < policy.minimumBid) {
		constrainedBid = policy.minimumBid;
		guardrailApplied = "minimum-bid";
	}

	const proposedBid = roundCurrency(constrainedBid, policy.currencyDecimals);
	if (!(proposedBid > 0 && proposedBid < input.currentBid)) {
		throw new RangeError("bid policy must produce a real decrease below the current bid");
	}

	const absoluteDelta = proposedBid - input.currentBid;
	return {
		currentBid: input.currentBid,
		observedAcos: input.observedAcos,
		targetAcos: input.targetAcos,
		rawBid,
		proposedBid,
		absoluteDelta,
		percentDelta: absoluteDelta / input.currentBid,
		guardrailApplied,
		policy,
	};
}
