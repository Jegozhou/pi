import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SellerChangeSet } from "../change-set/types.ts";

export type SellerApprovalSecret = string | Uint8Array;

export interface SellerApprovalProof {
	algorithm: "hmac-sha256";
	contentDigest: string;
	signature: string;
}

export interface SellerApprovalEnvelope {
	changeSet: SellerChangeSet;
	proof: SellerApprovalProof;
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value !== null && typeof value === "object") {
		const source = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(source).sort()) {
			const child = source[key];
			if (child !== undefined) result[key] = canonicalize(child);
		}
		return result;
	}
	return value;
}

function digestPayload(changeSet: SellerChangeSet): Record<string, unknown> {
	const decision = changeSet.decision
		? {
			outcome: changeSet.decision.outcome,
			actor: changeSet.decision.actor,
			decidedAt: changeSet.decision.decidedAt,
			provenance: changeSet.decision.provenance ?? null,
		}
		: null;
	return {
		id: changeSet.id,
		version: changeSet.version,
		status: changeSet.status,
		sourceActionItemIds: changeSet.sourceActionItemIds,
		proposals: changeSet.proposals,
		decision,
	};
}

export function computeSellerChangeSetContentDigest(changeSet: SellerChangeSet): string {
	const canonicalJson = JSON.stringify(canonicalize(digestPayload(changeSet)));
	return createHash("sha256").update(canonicalJson).digest("hex");
}

function approvalMessage(changeSet: SellerChangeSet, contentDigest: string): string {
	return `${changeSet.id}\u0000${changeSet.version}\u0000${contentDigest}`;
}

function assertApprovedDigest(changeSet: SellerChangeSet): string {
	if (changeSet.status !== "approved" || changeSet.decision?.outcome !== "approved") {
		throw new Error("Approval envelope requires an approved Change Set");
	}
	if (changeSet.decision.provenance !== "host-ui-confirmation") {
		throw new Error("Approval envelope requires host-ui-confirmation provenance");
	}
	const recordedDigest = changeSet.decision.contentDigest;
	if (!recordedDigest) throw new Error("Approved Change Set is missing its content digest");
	const actualDigest = computeSellerChangeSetContentDigest(changeSet);
	if (actualDigest !== recordedDigest) {
		throw new Error("Approved Change Set content digest mismatch; content may have been tampered with");
	}
	return actualDigest;
}

export function createSellerApprovalEnvelope(
	changeSet: SellerChangeSet,
	secret: SellerApprovalSecret,
): SellerApprovalEnvelope {
	const contentDigest = assertApprovedDigest(changeSet);
	const signature = createHmac("sha256", secret)
		.update(approvalMessage(changeSet, contentDigest))
		.digest("hex");
	return {
		changeSet: structuredClone(changeSet),
		proof: { algorithm: "hmac-sha256", contentDigest, signature },
	};
}

function assertEnvelopeShape(envelope: SellerApprovalEnvelope): void {
	if (!envelope || typeof envelope !== "object") {
		throw new Error("A signed approval envelope is required");
	}
	if (!envelope.changeSet || typeof envelope.changeSet !== "object") {
		throw new Error("Approval envelope is missing its Change Set");
	}
	if (!envelope.proof || typeof envelope.proof !== "object") {
		throw new Error("Approval envelope is missing its proof");
	}
}

export function verifySellerApprovalEnvelope(
	envelope: SellerApprovalEnvelope,
	secret: SellerApprovalSecret,
): SellerChangeSet {
	assertEnvelopeShape(envelope);
	if (envelope.proof.algorithm !== "hmac-sha256") {
		throw new Error(`Unsupported approval proof algorithm: ${envelope.proof.algorithm}`);
	}
	const contentDigest = assertApprovedDigest(envelope.changeSet);
	if (envelope.proof.contentDigest !== contentDigest) {
		throw new Error("Approval proof digest does not match the approved Change Set content");
	}
	const expected = createHmac("sha256", secret)
		.update(approvalMessage(envelope.changeSet, contentDigest))
		.digest("hex");
	const expectedBytes = Buffer.from(expected, "hex");
	const actualBytes = Buffer.from(envelope.proof.signature, "hex");
	if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
		throw new Error("Approval proof signature is invalid");
	}
	return structuredClone(envelope.changeSet);
}
