// @vitest-environment node
import { expect, test } from "vitest";
import { DEV_MAILBOX_NAMES, devMailFixtures } from "../../scripts/dev-mail-fixtures";

test("each test mailbox has varied mail without real recipient data", () => {
  expect(DEV_MAILBOX_NAMES).toHaveLength(2);
  for (const work of [false, true]) {
    const rows = devMailFixtures("sample@ethereal.email", work, 1_800_000_000_000);
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map(r => r.mail.messageId)).size).toBe(12);
    expect(rows.filter(r => r.folder === "inbox")).toHaveLength(9);
    for (const folder of ["sent", "archive", "trash"]) expect(rows.some(r => r.folder === folder)).toBe(true);
    expect(rows.some(r => r.flags.includes("\\Seen"))).toBe(true);
    expect(rows.some(r => !r.flags.includes("\\Seen"))).toBe(true);
    expect(rows.some(r => r.flags.includes("\\Flagged"))).toBe(true);
    expect(rows.some(r => r.mail.html)).toBe(true);
    expect(rows.some(r => r.mail.attachments?.length === 2)).toBe(true);
    expect(rows[1].mail.inReplyTo).toBe(rows[0].mail.messageId);
    expect(rows[2].mail.references).toEqual([rows[0].mail.messageId, rows[1].mail.messageId]);
  }
});

test("mailbox message IDs cannot collide across accounts", () => {
  const personal = new Set(devMailFixtures("personal@ethereal.email", false).map(r => r.mail.messageId));
  expect(devMailFixtures("work@ethereal.email", true).some(r => personal.has(r.mail.messageId))).toBe(false);
});
