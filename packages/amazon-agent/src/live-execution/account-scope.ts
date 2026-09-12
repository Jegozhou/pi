export type SellerAmazonAdsRegion = "NA" | "EU" | "FE";

export interface SellerAmazonAdsAccountScope {
	profileId: string;
	marketplaceId: string;
	region: SellerAmazonAdsRegion;
}

export function assertSellerAmazonAdsAccountScope(scope: SellerAmazonAdsAccountScope): void {
	if (!scope || typeof scope !== "object") {
		throw new Error("Amazon Ads account scope is required");
	}
	if (typeof scope.profileId !== "string" || scope.profileId.trim().length === 0) {
		throw new Error("Amazon Ads account scope requires a non-empty profileId");
	}
	if (typeof scope.marketplaceId !== "string" || scope.marketplaceId.trim().length === 0) {
		throw new Error("Amazon Ads account scope requires a non-empty marketplaceId");
	}
	if (scope.region !== "NA" && scope.region !== "EU" && scope.region !== "FE") {
		throw new Error(`Unsupported Amazon Ads account scope region: ${String(scope.region)}`);
	}
}

export function sellerAmazonAdsAccountScopeKey(scope: SellerAmazonAdsAccountScope): string {
	assertSellerAmazonAdsAccountScope(scope);
	return JSON.stringify([scope.region, scope.marketplaceId, scope.profileId]);
}
