import type { NormalizedTargetSnapshotRow, TargetSnapshotParseResult } from "../types/targeting.ts";
import type { SellerChangeProposal, SellerChangeSet, SellerChangeSetEnrichmentResult } from "./types.ts";

function normalized(value: string | null | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

function nonEmpty(value: string | null | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

type ResolvableTargetSnapshotRow = NormalizedTargetSnapshotRow & {
	campaignId: string;
	adGroupId: string;
	targetId: string;
};

function isResolvableTargetRow(row: NormalizedTargetSnapshotRow): row is ResolvableTargetSnapshotRow {
	return nonEmpty(row.campaignId) && nonEmpty(row.adGroupId) && nonEmpty(row.targetId);
}

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

function adGroupMatches(
	proposal: SellerChangeProposal,
	rows: readonly NormalizedTargetSnapshotRow[],
): NormalizedTargetSnapshotRow[] {
	if (!proposal.context) return [];
	return rows.filter(
		(row) =>
			normalized(row.campaignName) === normalized(proposal.context?.campaignName) &&
			normalized(row.adGroupName) === normalized(proposal.context?.adGroupName),
	);
}

function uniqueAdGroupIdentity(
	rows: readonly NormalizedTargetSnapshotRow[],
): NormalizedTargetSnapshotRow | null | "ambiguous" {
	const usable = rows.filter((row) => nonEmpty(row.campaignId) && nonEmpty(row.adGroupId));
	const byIdentity = new Map<string, NormalizedTargetSnapshotRow>();
	for (const row of usable) byIdentity.set(`${row.campaignId}\u0000${row.adGroupId}`, row);
	if (byIdentity.size === 0) return null;
	if (byIdentity.size > 1) return "ambiguous";
	return [...byIdentity.values()][0] ?? null;
}

function targetMatches(
	proposal: SellerChangeProposal,
	rows: readonly NormalizedTargetSnapshotRow[],
): NormalizedTargetSnapshotRow[] {
	if (!proposal.context?.targeting) return [];
	return adGroupMatches(proposal, rows).filter((row) => {
		if (normalized(row.targeting) !== normalized(proposal.context?.targeting)) return false;
		if (proposal.context?.matchType && normalized(row.matchType) !== normalized(proposal.context.matchType))
			return false;
		return true;
	});
}

function targetStateKey(row: NormalizedTargetSnapshotRow): string {
	return [
		row.campaignId,
		row.adGroupId,
		normalized(row.targeting),
		normalized(row.matchType),
		row.currentBid === null ? "null" : String(row.currentBid),
		normalized(row.state),
	].join("\u0000");
}

function uniqueTarget(rows: readonly NormalizedTargetSnapshotRow[]): NormalizedTargetSnapshotRow | null | "ambiguous" {
	const usable = rows.filter(isResolvableTargetRow);
	const byTarget = new Map<string, ResolvableTargetSnapshotRow[]>();
	for (const row of usable) {
		const group = byTarget.get(row.targetId) ?? [];
		group.push(row);
		byTarget.set(row.targetId, group);
	}
	if (byTarget.size === 0) return null;
	if (byTarget.size > 1) return "ambiguous";
	const group = [...byTarget.values()][0] ?? [];
	const states = new Set(group.map(targetStateKey));
	if (states.size !== 1) return "ambiguous";
	return group[0] ?? null;
}

function enrichNegativeExact(proposal: SellerChangeProposal, rows: readonly NormalizedTargetSnapshotRow[]) {
	const match = uniqueAdGroupIdentity(adGroupMatches(proposal, rows));
	if (match === "ambiguous") return { kind: "ambiguous" as const, proposal };
	if (!match) return { kind: "unresolved" as const, proposal };
	return {
		kind: "resolved" as const,
		proposal: {
			...proposal,
			readiness: "ready" as const,
			missingInputs: [],
			before: {
				campaignId: match.campaignId,
				adGroupId: match.adGroupId,
				searchTerm: proposal.entity.value,
			},
			after: {
				campaignId: match.campaignId,
				adGroupId: match.adGroupId,
				negativeExact: proposal.entity.value,
			},
		},
	};
}

function enrichTargetOperation(proposal: SellerChangeProposal, rows: readonly NormalizedTargetSnapshotRow[]) {
	const match = uniqueTarget(targetMatches(proposal, rows));
	if (match === "ambiguous") return { kind: "ambiguous" as const, proposal };
	if (!match) return { kind: "unresolved" as const, proposal };

	const before = {
		campaignId: match.campaignId,
		adGroupId: match.adGroupId,
		targetId: match.targetId,
		currentBid: match.currentBid,
	};

	if (proposal.operation === "set-bid") {
		return {
			kind: "resolved" as const,
			proposal: {
				...proposal,
				before,
				after: null,
				readiness: "blocked" as const,
				missingInputs: match.currentBid === null ? ["current bid", "proposed bid"] : ["proposed bid"],
			},
		};
	}

	if (proposal.operation === "scale") {
		return {
			kind: "resolved" as const,
			proposal: {
				...proposal,
				before,
				after: null,
				readiness: "blocked" as const,
				missingInputs:
					match.currentBid === null
						? ["scale mechanism", "current value", "proposed value"]
						: ["scale mechanism", "proposed value"],
			},
		};
	}

	return { kind: "unresolved" as const, proposal };
}

export function enrichSellerChangeSet(
	changeSet: SellerChangeSet,
	snapshot: TargetSnapshotParseResult,
): SellerChangeSetEnrichmentResult {
	if (changeSet.status !== "draft") {
		throw new Error("Only draft Change Sets can be enriched");
	}

	const resolvedProposalIds: string[] = [];
	const unresolvedProposalIds: string[] = [];
	const ambiguousProposalIds: string[] = [];

	const proposals = changeSet.proposals.map((sourceProposal) => {
		const proposal = cloneProposal(sourceProposal);
		if (proposal.operation === "review-profitability") return proposal;

		const result =
			proposal.operation === "add-negative-exact"
				? enrichNegativeExact(proposal, snapshot.rows)
				: proposal.operation === "set-bid" || proposal.operation === "scale"
					? enrichTargetOperation(proposal, snapshot.rows)
					: { kind: "unresolved" as const, proposal };

		if (result.kind === "resolved") resolvedProposalIds.push(proposal.id);
		if (result.kind === "unresolved") unresolvedProposalIds.push(proposal.id);
		if (result.kind === "ambiguous") ambiguousProposalIds.push(proposal.id);
		return result.proposal;
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
			resolvedProposalIds,
			unresolvedProposalIds,
			ambiguousProposalIds,
			warnings: snapshot.inspection.warnings.map((warning) => ({ ...warning })),
		},
	};
}
