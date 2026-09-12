import type { SellerExecutionOperation } from "../../execution/plan-types.ts";
import {
	assertSellerAmazonAdsAccountScope,
	type SellerAmazonAdsAccountScope,
	sellerAmazonAdsAccountScopeKey,
} from "../../live-execution/account-scope.ts";
import type { SellerExecutionStateReader, SellerTrustedOperationState } from "../../live-execution/state-reader.ts";
import { inventorySellerAmazonAdsMcpCapabilities } from "./capabilities.ts";
import {
	type SellerAmazonAdsMcpReadBinding,
	type SellerAmazonAdsMcpSemanticRead,
	verifySellerAmazonAdsMcpReadBinding,
} from "./read-bindings.ts";
import { normalizeSellerAmazonAdsMcpSessionContext } from "./session.ts";
import type { SellerAmazonAdsMcpReadRequest, SellerAmazonAdsMcpTransport } from "./types.ts";

type TrustedStateReadStage =
	| "account-scope-validation"
	| "session-validation"
	| "capability-catalog-validation"
	| "semantic-binding-validation"
	| "connector-read"
	| "result-validation";

function unavailable(operation: SellerExecutionOperation, stage: TrustedStateReadStage): SellerTrustedOperationState {
	const reason = `Amazon Ads MCP trusted state unavailable: ${stage}`;
	return operation.operation === "set-bid"
		? { operation: "set-bid", status: "unavailable", reason }
		: { operation: "add-negative-exact", status: "unavailable", reason };
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

function requestForOperation(
	binding: SellerAmazonAdsMcpReadBinding,
	accountScope: SellerAmazonAdsAccountScope,
	operation: SellerExecutionOperation,
): SellerAmazonAdsMcpReadRequest {
	if (operation.operation === "set-bid") {
		return {
			toolName: binding.toolName,
			arguments: {
				profileId: accountScope.profileId,
				marketplaceId: accountScope.marketplaceId,
				region: accountScope.region,
				targetId: operation.targetId,
			},
		};
	}
	return {
		toolName: binding.toolName,
		arguments: {
			profileId: accountScope.profileId,
			marketplaceId: accountScope.marketplaceId,
			region: accountScope.region,
			campaignId: operation.campaignId,
			adGroupId: operation.adGroupId,
			negativeExact: operation.negativeExact,
		},
	};
}

function parseBidResult(value: unknown): SellerTrustedOperationState {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Amazon Ads MCP target-bid read returned an invalid or ambiguous result");
	}
	const currentBid = (value as Record<string, unknown>).currentBid;
	if (typeof currentBid !== "number" || !Number.isFinite(currentBid) || currentBid <= 0) {
		throw new Error("Amazon Ads MCP target-bid read returned an invalid currentBid");
	}
	return { operation: "set-bid", status: "available", currentBid };
}

function parseNegativeResult(value: unknown): SellerTrustedOperationState {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Amazon Ads MCP negative-exact read returned an invalid or ambiguous result");
	}
	const exists = (value as Record<string, unknown>).exists;
	if (typeof exists !== "boolean") {
		throw new Error("Amazon Ads MCP negative-exact read returned an invalid existence flag");
	}
	return { operation: "add-negative-exact", status: "available", exists };
}

export function createSellerAmazonAdsMcpStateReader(
	transport: SellerAmazonAdsMcpTransport,
	bindings: readonly SellerAmazonAdsMcpReadBinding[],
): SellerExecutionStateReader {
	return {
		async readOperationState(accountScope, operation) {
			let stage: TrustedStateReadStage = "account-scope-validation";
			try {
				assertSellerAmazonAdsAccountScope(accountScope);

				stage = "session-validation";
				const session = normalizeSellerAmazonAdsMcpSessionContext(await transport.getSessionContext());
				if (sellerAmazonAdsAccountScopeKey(session.accountScope) !== sellerAmazonAdsAccountScopeKey(accountScope)) {
					throw new Error("Amazon Ads MCP authenticated session account scope does not match requested scope");
				}

				stage = "capability-catalog-validation";
				const inventory = inventorySellerAmazonAdsMcpCapabilities(await transport.listTools());

				stage = "semantic-binding-validation";
				const semantic = semanticForOperation(operation);
				const binding = exactBinding(bindings, semantic);
				const verifiedBinding = verifySellerAmazonAdsMcpReadBinding(binding, inventory, accountScope);
				const request = requestForOperation(verifiedBinding, accountScope, operation);

				stage = "connector-read";
				const result = await transport.callReadTool(structuredClone(request));

				stage = "result-validation";
				return operation.operation === "set-bid" ? parseBidResult(result) : parseNegativeResult(result);
			} catch {
				return unavailable(operation, stage);
			}
		},
	};
}
