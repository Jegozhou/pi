import type { SellerExecutionPlan } from "../../execution/plan-types.ts";
import type {
	SellerExecutionAuthorizationEnvelope,
	SellerExecutionAuthorizationSecret,
} from "../../live-execution/authorization.ts";
import {
	buildSellerLiveExecutionPreflight,
	type SellerLiveExecutionPreflight,
} from "../../live-execution/build-live-preflight.ts";
import type { SellerExecutionIdempotencyStore } from "../../live-execution/idempotency-store.ts";
import type { SellerAmazonAdsMcpReadBinding } from "./read-bindings.ts";
import { createSellerAmazonAdsMcpStateReader } from "./state-reader.ts";
import type { SellerAmazonAdsMcpTransport } from "./types.ts";

export interface SellerAmazonAdsMcpLivePreflightInput {
	plan: SellerExecutionPlan;
	authorizationEnvelope: SellerExecutionAuthorizationEnvelope;
	authorizationSecret: SellerExecutionAuthorizationSecret;
	transport: SellerAmazonAdsMcpTransport;
	bindings: readonly SellerAmazonAdsMcpReadBinding[];
	idempotencyStore: SellerExecutionIdempotencyStore;
	now?: string;
}

export async function buildSellerAmazonAdsMcpLivePreflight(
	input: SellerAmazonAdsMcpLivePreflightInput,
): Promise<SellerLiveExecutionPreflight> {
	const stateReader = createSellerAmazonAdsMcpStateReader(input.transport, input.bindings);
	return buildSellerLiveExecutionPreflight(
		input.plan,
		input.authorizationEnvelope,
		input.authorizationSecret,
		stateReader,
		input.idempotencyStore,
		input.now !== undefined ? { now: input.now } : {},
	);
}
