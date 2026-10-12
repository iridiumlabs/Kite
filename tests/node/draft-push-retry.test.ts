// @vitest-environment node
import { expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../../convex/_generated/server";
import { internal } from "../../convex/_generated/api";
vi.mock("../../convex/_generated/server", () => ({ internalAction: (definition: unknown) => definition }));
import { pushDraftNow } from "../../convex/node/draftsOps";

test.each(["IMAP unavailable", "APPEND rejected", "Mutation response lost"])("scheduled push retains a durable retry after %s", async message => {
  const mutation = vi.fn();
  const ctx = {
    runQuery: vi.fn().mockResolvedValue({ _id: "draft", accountId: "account", remoteDirty: true, status: "editing" }),
    runAction: vi.fn().mockRejectedValue(new Error(message)), runMutation: mutation,
    scheduler: { runAfter: vi.fn() },
  } as unknown as ActionCtx;
  const handler = (pushDraftNow as unknown as { handler: (ctx: ActionCtx, args: { draftId: string }) => Promise<unknown> }).handler;
  await expect(handler(ctx, { draftId: "draft" })).rejects.toThrow(message);
  expect(mutation).toHaveBeenCalledWith(internal.syncStore.retryDraftPush, { draftId: "draft" });
  expect(mutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual([
    "syncStore:acquireLease", "syncStore:retryDraftPush", "syncStore:releaseLease",
  ]);
});
