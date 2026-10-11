// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { GET } from "../../app/api/attachments/[messageId]/[attachmentId]/route";

const mocks = vi.hoisted(() => ({ download: vi.fn(), getToken: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ getToken: mocks.getToken }) }));
vi.mock("../../lib/devAuth", () => ({ devAuthEnabled: () => false, signDevToken: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    setAuth() {}
    action = mocks.download;
  },
}));

beforeEach(() => {
  mocks.getToken.mockResolvedValue("test-token");
  mocks.download.mockReset();
});

test.each(["image/svg+xml", "text/html", "application/pdf"])("%s is downloaded, never served as an active inline document", async contentType => {
  mocks.download.mockResolvedValue({ filename: "attachment", contentType, size: 4, data: new ArrayBuffer(4) });
  const response = await GET(new Request("https://post.test/api/attachments/m/a"), {
    params: Promise.resolve({ messageId: "m", attachmentId: "a" }),
  });
  expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
  expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

test("safe raster images remain inline", async () => {
  mocks.download.mockResolvedValue({ filename: "photo.png", contentType: "image/png", size: 4, data: new ArrayBuffer(4) });
  const response = await GET(new Request("https://post.test/api/attachments/m/a"), {
    params: Promise.resolve({ messageId: "m", attachmentId: "a" }),
  });
  expect(response.headers.get("Content-Disposition")).toMatch(/^inline;/);
});
