// @vitest-environment node
import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ fail: false, options: {} as Record<string, unknown>, closes: 0 }));
vi.mock("imapflow", () => ({
  ImapFlow: class extends EventEmitter {
    constructor(options: Record<string, unknown>) { super(); state.options = options; }
    async connect() { if (state.fail) throw new Error("Login failed"); }
    close() { state.closes++; }
  },
}));
import { connectImap } from "../../convex/node/imap";
const cfg = { host: "mail.spacemail.com", port: 993, secure: true, username: "test", password: "test" };
test("IMAP rejects unsupported saved destinations before opening a socket", async () => {
  await expect(connectImap({ ...cfg, host: "127.0.0.1" })).rejects.toThrow("Unsupported mail server");
  await expect(connectImap({ ...cfg, port: 80 })).rejects.toThrow("Unsupported mail port");
});

test("short-lived IMAP actions never auto-IDLE and consume asynchronous socket errors", async () => {
  const client = await connectImap(cfg);
  expect(state.options.disableAutoIdle).toBe(true);
  expect(() => client.emit("error", new Error("Socket timeout"))).not.toThrow();
});
test("failed IMAP connections are closed before propagating their error", async () => {
  state.fail = true;
  await expect(connectImap(cfg)).rejects.toThrow("Login failed");
  expect(state.closes).toBe(1);
});
