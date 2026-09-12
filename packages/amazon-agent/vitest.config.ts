import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@earendil-works/pi-ai": fileURLToPath(new URL("./test/shims/pi-ai.ts", import.meta.url)),
			"@earendil-works/pi-coding-agent": fileURLToPath(
				new URL("./test/shims/pi-coding-agent.ts", import.meta.url),
			),
		},
	},
});
