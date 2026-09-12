import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativeUrl: string): string {
	return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("Amazon host approval extension wiring", () => {
	it("routes the registered decision tool through the verified host approval flow", () => {
		const indexSource = source("../../../.pi/extensions/amazon-seller/index.ts");
		expect(indexSource).toContain('import { confirmSellerChangeSetDecision } from "./approval-flow.ts"');
		expect(indexSource).toContain('name: "amazon_decide_change_set"');
		expect(indexSource).toContain("await confirmSellerChangeSetDecision({");
		expect(indexSource).toContain("hasUI: ctx?.hasUI ?? false");
		expect(indexSource).toContain("ctx.ui.confirm(title, message, { signal })");
		expect(indexSource).not.toContain("trusted-caller");
	});

	it("does not accept a model-supplied actor parameter for approval", () => {
		const indexSource = source("../../../.pi/extensions/amazon-seller/index.ts");
		const decisionToolStart = indexSource.indexOf('name: "amazon_decide_change_set"');
		const decisionToolEnd = indexSource.indexOf("export default function", decisionToolStart);
		const decisionToolSource = indexSource.slice(decisionToolStart, decisionToolEnd);
		expect(decisionToolSource).not.toContain("actor: Type.String");
		expect(decisionToolSource).not.toContain("params.actor");
	});

	it("shares one ephemeral secret between approval and dry-run registration", () => {
		const indexSource = source("../../../.pi/extensions/amazon-seller/index.ts");
		expect(indexSource).toContain("const approvalSecret: SellerApprovalSecret = randomBytes(32)");
		expect(indexSource).toContain("createDecideChangeSetTool(approvalSecret)");
		expect(indexSource).toContain("registerAmazonExecutionDryRunTool(pi, approvalSecret)");
	});

	it("registered dry-run wrapper only accepts approvalEnvelopeJson", () => {
		const executionSource = source("../../../.pi/extensions/amazon-seller/execution-tool.ts");
		expect(executionSource).toContain("approvalEnvelopeJson");
		expect(executionSource).not.toContain("changeSetJson: Type.String");
		expect(executionSource).toContain("buildSellerExecutionDryRun(envelope, approvalSecret");
	});
});
