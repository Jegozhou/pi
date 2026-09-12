import {
	createSellerApprovalEnvelope,
	decideSellerChangeSet,
	type SellerApprovalEnvelope,
	type SellerApprovalSecret,
	type SellerChangeSet,
} from "../../../packages/amazon-agent/src/index.ts";

export interface SellerApprovalHost {
	hasUI: boolean;
	confirm(title: string, message: string): Promise<boolean>;
}

export interface SellerHostDecisionResult {
	changeSet: SellerChangeSet;
	approvalEnvelope: SellerApprovalEnvelope | null;
}

export function sellerDecisionConfirmationMessage(
	changeSet: SellerChangeSet,
	decision: "approve" | "reject",
): string {
	const proposalLines = changeSet.proposals.flatMap((proposal, index) => [
		`${index + 1}. ${proposal.operation} | ${proposal.entity.type}:${proposal.entity.value} | ${proposal.readiness}`,
		`   before: ${JSON.stringify(proposal.before)}`,
		`   after: ${JSON.stringify(proposal.after)}`,
	]);
	return [
		`Decision: ${decision.toUpperCase()}`,
		`Change Set: ${changeSet.id}`,
		`Version: ${changeSet.version}`,
		"",
		...proposalLines,
		"",
		decision === "approve"
			? "Confirm that you personally approve exactly these changes. This records approval only and does not write to Amazon."
			: "Confirm that you personally reject this exact Change Set.",
	].join("\n");
}

export async function confirmSellerChangeSetDecision(options: {
	changeSet: SellerChangeSet;
	decision: "approve" | "reject";
	secret: SellerApprovalSecret;
	host: SellerApprovalHost;
	now?: () => string;
}): Promise<SellerHostDecisionResult> {
	if (!options.host.hasUI) {
		throw new Error("Amazon Change Set decisions require a dialog-capable host UI for human confirmation");
	}
	const title = options.decision === "approve" ? "Approve Amazon Change Set?" : "Reject Amazon Change Set?";
	const confirmed = await options.host.confirm(
		title,
		sellerDecisionConfirmationMessage(options.changeSet, options.decision),
	);
	if (!confirmed) {
		throw new Error("Human did not confirm the Amazon Change Set decision");
	}

	const changeSet = decideSellerChangeSet(options.changeSet, {
		decision: options.decision,
		actor: "pi-host-user",
		decidedAt: options.now?.() ?? new Date().toISOString(),
		provenance: "host-ui-confirmation",
	});
	return {
		changeSet,
		approvalEnvelope:
			options.decision === "approve" ? createSellerApprovalEnvelope(changeSet, options.secret) : null,
	};
}
