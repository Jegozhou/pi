import { randomBytes } from "node:crypto";
import type { SellerApprovalSecret } from "../../../packages/amazon-agent/src/index.ts";

/**
 * Ephemeral per-process secret shared by the approval and dry-run extension tools.
 * It is never exposed as a tool argument or persisted to seller data.
 */
export const amazonApprovalSecret: SellerApprovalSecret = randomBytes(32);
