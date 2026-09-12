import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SellerApprovalSecret } from "../approval/approval-envelope.ts";
import type { SellerExecutionPlan } from "../execution/plan-types.ts";
import {
	assertSellerAmazonAdsAccountScope,
	type SellerAmazonAdsAccountScope,
} from "./account-scope.ts";

export type SellerExecutionAuthorizationSecret = SellerApprovalSecret;

export interface SellerExecutionAuthorization {
	planId: string;
	planIdempotencyKey: string;
	sourceChangeSetId: string;
	sourceChangeSetVersion: number;
	approvedContentDigest: string;
	accountScope: SellerAmazonAdsAccountScope;
	issuedAt: string;
	expiresAt: string;
	nonce: string;
	provenance: "trusted-host";
}

export interface SellerExecutionAuthorizationProof {
	algorithm: "hmac-sha256";
	contentDigest: string;
	signature: string;
}

export interface SellerExecutionAuthorizationEnvelope {
	authorization: SellerExecutionAuthorization;
	proof: SellerExecutionAuthorizationProof;
}

export interface SellerExecutionAuthorizationCreateOptions {
	issuedAt: string;
	expiresAt: string;
	nonce: string;
}

export interface SellerExecutionAuthorizationVerifyOptions {
	now?: string;
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

function timestampMillis(value: string, label: string): number {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} timestamp is required`);
	}
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds)) {
		throw new Error(`${label} must be a valid timestamp`);
	}
	return milliseconds;
}

function assertPlanIdentity(plan: SellerExecutionPlan): void {
	if (!plan || typeof plan !== "object") throw new Error("Execution plan is required");
	if (typeof plan.id !== "string" || plan.id.length === 0) throw new Error("Execution plan ID is required");
	if (typeof plan.idempotencyKey !== "string" || plan.idempotencyKey.length === 0) {
		throw new Error("Execution plan idempotency key is required");
	}
	if (typeof plan.sourceChangeSetId !== "string" || plan.sourceChangeSetId.length === 0) {
		throw new Error("Execution plan source Change Set ID is required");
	}
	if (!Number.isInteger(plan.sourceChangeSetVersion) || plan.sourceChangeSetVersion < 1) {
		throw new Error("Execution plan source Change Set version must be a positive integer");
	}
	if (typeof plan.approval?.contentDigest !== "string" || plan.approval.contentDigest.length === 0) {
		throw new Error("Execution plan approved content digest is required");
	}
}

function authorizationFromPlan(
	plan: SellerExecutionPlan,
	accountScope: SellerAmazonAdsAccountScope,
	options: SellerExecutionAuthorizationCreateOptions,
): SellerExecutionAuthorization {
	assertPlanIdentity(plan);
	assertSellerAmazonAdsAccountScope(accountScope);
	const issuedAt = timestampMillis(options.issuedAt, "issuedAt");
	const expiresAt = timestampMillis(options.expiresAt, "expiresAt");
	if (expiresAt <= issuedAt) {
		throw new Error("Execution authorization expiresAt must be after issuedAt");
	}
	if (typeof options.nonce !== "string" || options.nonce.trim().length === 0) {
		throw new Error("Execution authorization nonce is required");
	}
	return {
		planId: plan.id,
		planIdempotencyKey: plan.idempotencyKey,
		sourceChangeSetId: plan.sourceChangeSetId,
		sourceChangeSetVersion: plan.sourceChangeSetVersion,
		approvedContentDigest: plan.approval.contentDigest,
		accountScope: structuredClone(accountScope),
		issuedAt: options.issuedAt,
		expiresAt: options.expiresAt,
		nonce: options.nonce,
		provenance: "trusted-host",
	};
}

function computeAuthorizationDigest(authorization: SellerExecutionAuthorization): string {
	const canonicalJson = JSON.stringify(canonicalize(authorization));
	return createHash("sha256").update(canonicalJson).digest("hex");
}

function signatureMessage(authorization: SellerExecutionAuthorization, contentDigest: string): string {
	return `${authorization.planId}\u0000${authorization.planIdempotencyKey}\u0000${authorization.nonce}\u0000${contentDigest}`;
}

function assertAuthorizationShape(authorization: SellerExecutionAuthorization): void {
	if (!authorization || typeof authorization !== "object") {
		throw new Error("Execution authorization is required");
	}
	if (authorization.provenance !== "trusted-host") {
		throw new Error("Execution authorization requires trusted-host provenance");
	}
	assertSellerAmazonAdsAccountScope(authorization.accountScope);
	if (typeof authorization.planId !== "string" || authorization.planId.length === 0) {
		throw new Error("Execution authorization planId is required");
	}
	if (typeof authorization.planIdempotencyKey !== "string" || authorization.planIdempotencyKey.length === 0) {
		throw new Error("Execution authorization plan idempotency key is required");
	}
	if (typeof authorization.sourceChangeSetId !== "string" || authorization.sourceChangeSetId.length === 0) {
		throw new Error("Execution authorization source Change Set ID is required");
	}
	if (!Number.isInteger(authorization.sourceChangeSetVersion) || authorization.sourceChangeSetVersion < 1) {
		throw new Error("Execution authorization source Change Set version must be a positive integer");
	}
	if (typeof authorization.approvedContentDigest !== "string" || authorization.approvedContentDigest.length === 0) {
		throw new Error("Execution authorization approved content digest is required");
	}
	if (typeof authorization.nonce !== "string" || authorization.nonce.trim().length === 0) {
		throw new Error("Execution authorization nonce is required");
	}
	const issuedAt = timestampMillis(authorization.issuedAt, "issuedAt");
	const expiresAt = timestampMillis(authorization.expiresAt, "expiresAt");
	if (expiresAt <= issuedAt) {
		throw new Error("Execution authorization expiresAt must be after issuedAt");
	}
}

function assertAuthorizationMatchesPlan(
	authorization: SellerExecutionAuthorization,
	plan: SellerExecutionPlan,
): void {
	assertPlanIdentity(plan);
	if (
		authorization.planId !== plan.id ||
		authorization.planIdempotencyKey !== plan.idempotencyKey ||
		authorization.sourceChangeSetId !== plan.sourceChangeSetId ||
		authorization.sourceChangeSetVersion !== plan.sourceChangeSetVersion ||
		authorization.approvedContentDigest !== plan.approval.contentDigest
	) {
		throw new Error("Execution authorization plan identity mismatch");
	}
}

export function createSellerExecutionAuthorizationEnvelope(
	plan: SellerExecutionPlan,
	accountScope: SellerAmazonAdsAccountScope,
	secret: SellerExecutionAuthorizationSecret,
	options: SellerExecutionAuthorizationCreateOptions,
): SellerExecutionAuthorizationEnvelope {
	const authorization = authorizationFromPlan(plan, accountScope, options);
	const contentDigest = computeAuthorizationDigest(authorization);
	const signature = createHmac("sha256", secret)
		.update(signatureMessage(authorization, contentDigest))
		.digest("hex");
	return {
		authorization,
		proof: { algorithm: "hmac-sha256", contentDigest, signature },
	};
}

export function verifySellerExecutionAuthorizationEnvelope(
	envelope: SellerExecutionAuthorizationEnvelope,
	plan: SellerExecutionPlan,
	secret: SellerExecutionAuthorizationSecret,
	options: SellerExecutionAuthorizationVerifyOptions = {},
): SellerExecutionAuthorization {
	if (!envelope || typeof envelope !== "object" || !envelope.authorization || !envelope.proof) {
		throw new Error("A signed execution authorization envelope is required");
	}
	assertAuthorizationShape(envelope.authorization);
	if (envelope.proof.algorithm !== "hmac-sha256") {
		throw new Error(`Unsupported execution authorization proof algorithm: ${String(envelope.proof.algorithm)}`);
	}
	const contentDigest = computeAuthorizationDigest(envelope.authorization);
	if (envelope.proof.contentDigest !== contentDigest) {
		throw new Error("Execution authorization content digest mismatch; authorization may have been tampered with");
	}
	const expected = createHmac("sha256", secret)
		.update(signatureMessage(envelope.authorization, contentDigest))
		.digest("hex");
	const expectedBytes = Buffer.from(expected, "hex");
	const actualBytes = Buffer.from(envelope.proof.signature, "hex");
	if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
		throw new Error("Execution authorization signature is invalid");
	}
	assertAuthorizationMatchesPlan(envelope.authorization, plan);

	const nowValue = options.now ?? new Date().toISOString();
	const now = timestampMillis(nowValue, "now");
	const issuedAt = timestampMillis(envelope.authorization.issuedAt, "issuedAt");
	const expiresAt = timestampMillis(envelope.authorization.expiresAt, "expiresAt");
	if (now < issuedAt) throw new Error("Execution authorization is not yet valid before issuedAt");
	if (now >= expiresAt) throw new Error("Execution authorization has expired");

	return structuredClone(envelope.authorization);
}
