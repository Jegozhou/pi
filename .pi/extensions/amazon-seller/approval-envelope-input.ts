import type {
	SellerApprovalEnvelope,
	SellerChangeSet,
} from "../../../packages/amazon-agent/src/index.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseApprovalEnvelope(raw: string): SellerApprovalEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("approvalEnvelopeJson must contain valid JSON");
	}
	if (!isRecord(parsed) || !isRecord(parsed.changeSet) || !isRecord(parsed.proof)) {
		throw new Error("approvalEnvelopeJson must contain changeSet and proof objects");
	}
	if (
		parsed.proof.algorithm !== "hmac-sha256" ||
		typeof parsed.proof.contentDigest !== "string" ||
		typeof parsed.proof.signature !== "string"
	) {
		throw new Error("approvalEnvelopeJson contains an invalid approval proof");
	}
	return {
		changeSet: parsed.changeSet as unknown as SellerChangeSet,
		proof: {
			algorithm: "hmac-sha256",
			contentDigest: parsed.proof.contentDigest,
			signature: parsed.proof.signature,
		},
	};
}
