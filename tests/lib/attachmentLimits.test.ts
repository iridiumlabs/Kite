import { expect, test } from "vitest";
import { RECEIVED_ATTACHMENT_MAX, checkReceivedAttachmentSize } from "../../convex/lib/attachmentLimits";

test("received attachments leave headroom for encoded return values and metadata", () => {
  expect(RECEIVED_ATTACHMENT_MAX * 4 / 3 + 1024 * 1024).toBeLessThan(16 * 1024 * 1024);
  expect(() => checkReceivedAttachmentSize(RECEIVED_ATTACHMENT_MAX)).not.toThrow();
});

test.each([RECEIVED_ATTACHMENT_MAX + 1, 16 * 1024 * 1024, 20 * 1024 * 1024])(
  "rejects oversized attachment (%s bytes) before crossing an action boundary", bytes => {
    expect(() => checkReceivedAttachmentSize(bytes)).toThrow("10 MB");
  },
);
