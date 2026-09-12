import type { PpcPolicy } from "./types.ts";

export const DEFAULT_PPC_POLICY: Readonly<PpcPolicy> = {
	targetAcos: null,
	minimumClicksNoSale: 10,
	minimumSpendNoSale: 20,
	minimumOrdersScale: 3,
	highAcosMultiplier: 1.5,
	lowAcosScaleMargin: 0.25,
};
