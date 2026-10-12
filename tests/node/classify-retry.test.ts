// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../../convex/_generated/server";
const h = vi.hoisted(() => ({ connect: vi.fn(), logout: vi.fn(), fetch: vi.fn() }));
vi.mock("../../convex/_generated/server", () => ({ internalAction: (d: unknown) => d }));
vi.mock("../../convex/node/crypto", () => ({ decryptCredentials: () => ({ username: "u", password: "p" }) }));
vi.mock("../../convex/node/imap", () => ({
  connectImap: h.connect,
  FlowPort: class { fetchSource = h.fetch; },
}));
vi.mock("../../convex/node/mailParser", () => ({ MailParserPort: class {
  async parse() { return { from: { email: "sender@x" }, to: [], cc: [], subject: "", text: "", references: [], attachments: [], headers: {} }; }
} }));
vi.mock("../../convex/lib/jev", () => ({ callJev: vi.fn().mockRejectedValue(new Error("Jev down")) }));
import { retryBatch } from "../../convex/node/classify";
afterEach(() => vi.unstubAllEnvs());
test("broken account advances all its rows and does not abort later accounts", async () => {
  vi.stubEnv("EXPERIENTIAL_API_KEY", "key");
  h.connect.mockReset().mockRejectedValueOnce(new Error("Expired credentials")).mockResolvedValueOnce({ logout: h.logout });
  h.logout.mockResolvedValue(undefined); h.fetch.mockResolvedValue(new Uint8Array());
  const broken = Array.from({ length: 13 }, (_, i) => ({ _id: "bad" + i, accountId: "bad", classifyAttempts: 0, folderRole: "inbox", folderPath: "INBOX", uid: i + 1, classificationCategories: [] }));
  const good = { ...broken[0], _id: "good0", accountId: "good" };
  const mutation = vi.fn();
  const ctx = {
    runQuery: vi.fn(async ref => {
      const name = getFunctionName(ref);
      if (name === "syncStore:needsClassification") return [...broken, good];
      if (name === "syncStore:getSecret") return {};
      if (name === "syncStore:getAccountSyncState") return { account: { email: "me@x", imapHost: "mail.spacemail.com", imapPort: 993, imapSecure: true } };
      if (name === "syncStore:threadContexts") return [];
    }),
    runMutation: mutation,
  } as unknown as ActionCtx;
  const handler = (retryBatch as unknown as { handler: (ctx: ActionCtx) => Promise<unknown> }).handler;
  expect(await handler(ctx)).toEqual({ retried: 1 });
  expect(mutation.mock.calls[0][1].updates).toHaveLength(13);
  expect(mutation.mock.calls[0][1].updates.every((u: { classifyAttempts: number }) => u.classifyAttempts === 1)).toBe(true);
  expect(mutation.mock.calls[1][1].updates).toMatchObject([{ messageId: "good0", classifyAttempts: 1 }]);
  expect(h.logout).toHaveBeenCalledOnce();
});
