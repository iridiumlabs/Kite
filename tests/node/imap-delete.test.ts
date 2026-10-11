// @vitest-environment node
import { expect, test, vi } from "vitest";
import type { ImapFlow } from "imapflow";
import { FlowPort } from "../../convex/node/imap";

function setup(uidplus = false) {
  const deleted = new Set([2, 9]); const remaining = new Set([1, 2, 9]);
  const parse = (range: string) => range.split(",").flatMap(part => {
    const [a, b] = part.split(":").map(Number);
    return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
  });
  const client = {
    capabilities: new Set(uidplus ? ["UIDPLUS"] : []),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    search: vi.fn(async () => [...deleted]),
    messageFlagsRemove: vi.fn(async (r: string) => { for (const uid of parse(r)) deleted.delete(uid); return true; }),
    messageFlagsAdd: vi.fn(async (r: string) => { for (const uid of parse(r)) deleted.add(uid); return true; }),
    messageDelete: vi.fn(async (r: string) => {
      for (const uid of parse(r)) deleted.add(uid);
      for (const uid of uidplus ? parse(r) : deleted) remaining.delete(uid);
      return true;
    }),
    messageCopy: vi.fn(async () => ({ uidMap: new Map([[1, 101]]) })),
  };
  return { client, remaining, deleted, port: new FlowPort(client as unknown as ImapFlow) };
}
test.each([false, true])("expunge preserves unrelated deleted messages (UIDPLUS=%s)", async uidplus => {
  const { port, remaining, deleted, client } = setup(uidplus);
  await port.expunge("INBOX", [1, 2], true); // caller hint cannot override real server capabilities
  expect([...remaining]).toEqual([9]); expect(deleted.has(9)).toBe(true);
  expect(client.search).toHaveBeenCalledTimes(uidplus ? 0 : 1);
});
test("COPY/delete fallback protects unrelated deleted mail", async () => {
  const { port, remaining, deleted } = setup();
  expect(await port.moveOrCopy("INBOX", [1], "Archive", false)).toEqual(new Map([[1, 101]]));
  expect([...remaining]).toEqual([2, 9]); expect([...deleted]).toContain(9);
});
test("protected flags are restored when delete fails", async () => {
  const { port, deleted, client } = setup();
  client.messageDelete.mockRejectedValueOnce(new Error("Disconnect"));
  await expect(port.expunge("INBOX", [1], false)).rejects.toThrow("Disconnect");
  expect(deleted.has(2)).toBe(true); expect(deleted.has(9)).toBe(true);
});
test("false STORE results abort before expunge", async () => {
  const { port, client } = setup();
  client.messageFlagsRemove.mockResolvedValueOnce(false);
  await expect(port.expunge("INBOX", [1], false)).rejects.toThrow("Could not protect");
  expect(client.messageDelete).not.toHaveBeenCalled();
});
test("failed protected-flag removal aborts before expunge", async () => {
  const { port, client } = setup();
  client.messageFlagsRemove.mockRejectedValueOnce(new Error("STORE failed"));
  await expect(port.expunge("INBOX", [1], false)).rejects.toThrow();
  expect(client.messageDelete).not.toHaveBeenCalled();
});
