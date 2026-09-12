export interface ExtensionAPI {
	registerTool(tool: unknown): void;
}

export function defineTool<T>(tool: T): T {
	return tool;
}
