// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../../convex/_generated/server";
const h = vi.hoisted(() => ({ append: vi.fn(), search: vi.fn(), expunge: vi.fn(), logout: vi.fn() }));
vi.mock("../../convex/_generated/server", () => ({ internalAction: (d: unknown) => d }));
vi.mock("../../convex/node/crypto", () => ({ decryptCredentials: () => ({ username: "u", password: "p" }) }));
vi.mock("../../convex/node/draftAttachments", () => ({ materializeDraftAttachments: async (_ctx: unknown, draft: unknown) => draft }));
vi.mock("../../convex/node/imap", () => ({
  connectImap: async () => ({ logout: h.logout }), accountToImapConfig: () => ({}),
  FlowPort: class { append = h.append; searchHeader = h.search; expunge = h.expunge; },
}));
import { pushDraftUnderLease } from "../../convex/node/draftsOps";
beforeEach(() => { h.append.mockReset().mockResolvedValue({}); h.search.mockReset().mockResolvedValue([10]); h.expunge.mockReset(); h.logout.mockReset().mockResolvedValue(undefined); });
function setup(recorded = true, remoteUid?: number) {
  const draft = { _id: "draft", accountId: "acct", remoteDirty: true, updatedAt: 100, remoteUid, messageIdHeader: "draft@x", to: [], cc: [], bcc: [], subject: "", text: "", html: "", attachments: [] };
  const mutation = vi.fn(async (ref, args: unknown) => { void args; return getFunctionName(ref) === "syncStore:upsertFolder" ? "folder" : recorded; });
  const ctx = {
    runQuery: vi.fn(async ref => {
      const name = getFunctionName(ref);
      if (name === "syncStore:draftById") return draft;
      if (name === "syncStore:getAccountDoc") return { email: "me@x", displayName: "Me" };
      if (name === "syncStore:folderByRole") return { path: "Drafts" };
      return {};
    }), runMutation: mutation,
  } as unknown as ActionCtx;
  const handler = (pushDraftUnderLease as unknown as { handler: (ctx: ActionCtx, args: { draftId: string }) => Promise<unknown> }).handler;
  return { run: () => handler(ctx, { draftId: "draft" }), mutation };
}
test("no APPENDUID is resolved before recording clean and cleans earlier copies", async () => {
  h.search.mockResolvedValue([3, 9, 10]);
  const { run, mutation } = setup(true, 2);
  expect(await run()).toEqual({ uid: 10 });
  expect(h.search).toHaveBeenCalledWith("Drafts", "X-Post-Draft-Id", "draft@x");
  expect(mutation.mock.calls[1][1]).toMatchObject({ uid: 10 });
  expect(h.expunge).toHaveBeenCalledWith("Drafts", [3, 9, 2], true);
});
test("unidentified append is never marked clean", async () => {
  h.search.mockResolvedValue([]);
  const { run, mutation } = setup();
  await expect(run()).rejects.toThrow("could not be reconciled");
  expect(mutation).not.toHaveBeenCalled();
});
test("a discarded draft cleans all appended copies", async () => {
  h.search.mockResolvedValue([8, 10]);
  const { run } = setup(false);
  expect(await run()).toEqual({ uid: undefined });
  expect(h.expunge).toHaveBeenCalledWith("Drafts", [8, 10], true);
});
