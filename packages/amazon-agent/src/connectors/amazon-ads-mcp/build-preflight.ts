import type { SellerExecutionOperation, SellerExecutionPlan } from "../../execution/plan-types.ts";
import { sellerAmazonAdsAccountScopeKey } from "../../live-execution/account-scope.ts";
import {
	type SellerExecutionAuthorizationEnvelope,
	type SellerExecutionAuthorizationSecret,
	verifySellerExecutionAuthorizationEnvelope,
} from "../../live-execution/authorization.ts";
import {
	buildSellerLiveExecutionPreflight,
	type SellerLiveExecutionPreflight,
} from "../../live-execution/build-live-preflight.ts";
import type { SellerExecutionIdempotencyStore } from "../../live-execution/idempotency-store.ts";
import type { SellerExecutionStateReader } from "../../live-execution/state-reader.ts";
import { inventorySellerAmazonAdsMcpCapabilities } from "./capabilities.ts";
import {
	type SellerAmazonAdsMcpReadBinding,
	type SellerAmazonAdsMcpSemanticRead,
	verifySellerAmazonAdsMcpReadBinding,
} from "./read-bindings.ts";
import { normalizeSellerAmazonAdsMcpSessionContext } from "./session.ts";
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

function semanticForOperation(operation: SellerExecutionOperation): SellerAmazonAdsMcpSemanticRead {
	return operation.operation === "set-bid" ? "read-target-bid" : "read-negative-exact-existence";
}

function exactBinding(
	bindings: readonly SellerAmazonAdsMcpReadBinding[],
	semantic: SellerAmazonAdsMcpSemanticRead,
): SellerAmazonAdsMcpReadBinding {
	const matches = bindings.filter((binding) => binding.semantic === semantic);
	if (matches.length !== 1) {
		throw new Error(`Amazon Ads MCP semantic read binding is missing or ambiguous for ${semantic}`);
	}
	return matches[0]!;
}

function unavailableStateReader(reason: string): SellerExecutionStateReader {
	return {
		async readOperationState(_accountScope, operation) {
			return operation.operation === "set-bid"
				? { operation: "set-bid", status: "unavailable", reason }
				: { operation: "add-negative-exact", status: "unavailable", reason };
		},
	};
}

export async function buildSellerAmazonAdsMcpLivePreflight(
	input: SellerAmazonAdsMcpLivePreflightInput,
): Promise<SellerLiveExecutionPreflight> {
	const verificationOptions = input.now !== undefined ? { now: input.now } : {};
	const authorization = verifySellerExecutionAuthorizationEnvelope(
		input.authorizationEnvelope,
		input.plan,
		input.authorizationSecret,
		verificationOptions,
	);

	let stateReader: SellerExecutionStateReader;
	try {
		const session = normalizeSellerAmazonAdsMcpSessionContext(await input.transport.getSessionContext());
		if (
			sellerAmazonAdsAccountScopeKey(session.accountScope) !==
			sellerAmazonAdsAccountScopeKey(authorization.accountScope)
		) {
			throw new Error(
				"Amazon Ads MCP authenticated session account scope does not match execution authorization scope",
			);
		}

		const inventory = inventorySellerAmazonAdsMcpCapabilities(await input.transport.listTools());
		const requiredSemantics = new Set(input.plan.operations.map(semanticForOperation));
		for (const semantic of requiredSemantics) {
			const binding = exactBinding(input.bindings, semantic);
			verifySellerAmazonAdsMcpReadBinding(binding, inventory, authorization.accountScope);
		}
		stateReader = createSellerAmazonAdsMcpStateReader(input.transport, input.bindings);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stateReader = unavailableStateReader(`Amazon Ads MCP connector preflight unavailable: ${message}`);
	}

	return buildSellerLiveExecutionPreflight(
		input.plan,
		input.authorizationEnvelope,
		input.authorizationSecret,
		stateReader,
		input.idempotencyStore,
		verificationOptions,
	);
}
