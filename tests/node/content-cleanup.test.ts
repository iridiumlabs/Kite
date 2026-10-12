// @vitest-environment node
import { expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../../convex/_generated/server";
const h = vi.hoisted(() => ({ fetch: vi.fn(), logout: vi.fn(), close: vi.fn() }));
vi.mock("../../convex/_generated/server", () => ({ internalAction: (d: unknown) => d }));
vi.mock("../../convex/node/crypto", () => ({ decryptCredentials: () => ({ username: "u", password: "p" }) }));
vi.mock("../../convex/node/imap", () => ({
  connectImap: async () => ({ logout: h.logout, close: h.close }),
  accountToImapConfig: () => ({}),
  FlowPort: class { fetchSource = h.fetch; },
}));
import { getMessageContent, fetchAttachmentData, downloadAttachment } from "../../convex/node/content";
test.each([getMessageContent, fetchAttachmentData, downloadAttachment])("failed fetch closes its IMAP connection", async action => {
  h.fetch.mockReset().mockRejectedValue(new Error("Message vanished")); h.logout.mockReset().mockResolvedValue(undefined);
  const ctx = { runQuery: async (ref: never) => getFunctionName(ref) === "syncStore:messageRemoteRef"
    ? { folderPath: "INBOX", message: { accountId: "a", uid: 1 } } : {} } as unknown as ActionCtx;
  const handler = (action as unknown as { handler: (ctx: ActionCtx, args: object) => Promise<unknown> }).handler;
  await expect(handler(ctx, { messageId: "m", attachmentId: "att" })).rejects.toThrow("Message vanished");
  expect(h.logout).toHaveBeenCalledOnce();
});
