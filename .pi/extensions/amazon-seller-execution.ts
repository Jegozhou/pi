import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAmazonExecutionDryRunTool } from "./amazon-seller/execution-tool.ts";

export default function (pi: ExtensionAPI) {
	registerAmazonExecutionDryRunTool(pi);
}
