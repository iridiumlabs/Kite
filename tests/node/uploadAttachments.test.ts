// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { uploadSendAttachments } from "../../lib/mcp/uploadAttachments";
afterEach(() => vi.unstubAllGlobals());
test("large MCP inline attachments are HTTP-uploaded before Convex actions", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ storageId: "stored" }));
  vi.stubGlobal("fetch", fetch);
  const bytes = Buffer.alloc(4 * 1024 * 1024, 5);
  const refs = await uploadSendAttachments([{ filename: "large.bin", contentType: "application/octet-stream", contentBase64: bytes.toString("base64") }, { messageId: "m", attachmentId: "a" }], "secret", "https://test.convex.cloud");
  expect(refs).toEqual([{ storageId: "stored", filename: "large.bin", contentType: "application/octet-stream" }, { messageId: "m", attachmentId: "a" }]);
  const [url, options] = fetch.mock.calls[0];
  expect(String(url)).toBe("https://test.convex.site/send-attachment");
  expect(options.headers.authorization).toBe("Bearer secret");
  expect(Buffer.from(options.body).equals(bytes)).toBe(true);
});
test("upload failures abort and oversize files never upload", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("failed", { status: 500 })); vi.stubGlobal("fetch", fetch);
  await expect(uploadSendAttachments([{ filename: "x", contentType: "text/plain", contentBase64: "eA==" }], "k", "https://test.convex.cloud")).rejects.toThrow("upload failed");
  fetch.mockClear();
  await expect(uploadSendAttachments([{ filename: "x", contentType: "text/plain", contentBase64: Buffer.alloc(25 * 1024 * 1024 + 1).toString("base64") }], "k", "https://test.convex.cloud")).rejects.toThrow("25 MB");
  expect(fetch).not.toHaveBeenCalled();
});
