import type { SellerExecutionOperation } from "../execution/plan-types.ts";
import type { SellerAmazonAdsAccountScope } from "./account-scope.ts";

export type SellerTrustedBidState =
	| {
			operation: "set-bid";
			status: "available";
			currentBid: number;
	  }
	| {
			operation: "set-bid";
			status: "unavailable";
			reason: string;
	  };

export type SellerTrustedNegativeExactState =
	| {
			operation: "add-negative-exact";
			status: "available";
			exists: boolean;
	  }
	| {
			operation: "add-negative-exact";
			status: "unavailable";
			reason: string;
	  };

export type SellerTrustedOperationState = SellerTrustedBidState | SellerTrustedNegativeExactState;

export interface SellerExecutionStateReader {
	readOperationState(
		accountScope: SellerAmazonAdsAccountScope,
		operation: SellerExecutionOperation,
	): Promise<SellerTrustedOperationState>;
}
