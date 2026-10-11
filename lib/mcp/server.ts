// Assembles the Post MCP server: registers every tool group against the
// given McpServer. getBackend is resolved per call so the request's API key
// is what authorizes each Convex call.
import type { McpServer } from "@modelcontextprotocol/server";
import type { BackendFor } from "./tools/common";
import { registerMailboxTools } from "./tools/mailboxes";
import { registerReadingTools } from "./tools/reading";
import { registerSendingTools } from "./tools/sending";
import { registerDraftTools } from "./tools/drafts";
import { registerOrganizingTools } from "./tools/organizing";
import { registerCategoryTools } from "./tools/categories";

export const SERVER_INSTRUCTIONS =
  "Post gives you full access to the user's Spacemail mailboxes. " +
  "Conversations are threads; ids returned by one tool can be passed to any other. " +
  "Received mail that is not archived or trashed lives in exactly one of two inboxes: " +
  "primary (important, personal, needs attention) or other (newsletters, " +
  "notifications, promotions, outreach). Custom categories are optional labels " +
  "that can overlap with either inbox. Archive removes a thread from both inboxes " +
  "and all category views without losing its classification; restore brings it back. " +
  "Sending is real and immediate: pass a unique idempotencyKey per intended email so " +
  "retries never send twice. Bulk tools accept up to 100 ids. " +
  "Times are ISO 8601 in UTC.";

export function registerPostTools(server: McpServer, getBackend: BackendFor) {
  registerMailboxTools(server, getBackend);
  registerReadingTools(server, getBackend);
  registerSendingTools(server, getBackend);
  registerDraftTools(server, getBackend);
  registerOrganizingTools(server, getBackend);
  registerCategoryTools(server, getBackend);
}
