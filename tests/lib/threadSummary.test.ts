import { describe, expect, test } from "vitest";
import {
  computeListKey,
  computeLocation,
  summarizeThread,
  type SummaryMessage,
} from "../../convex/lib/threadSummary";

const NOW = 1_700_000_000_000;
const OWNER = ["me@x.com"];

function msg(partial: Partial<SummaryMessage>): SummaryMessage {
  return {
    folderRole: "inbox",
    date: NOW,
    seen: true,
    flagged: false,
    isOutbound: false,
    categoryIds: [],
    subject: "s",
    snippet: "snip",
    from: { email: "other@x.com" },
    hasAttachments: false,
    ...partial,
  };
}

const EXISTING = { inboxManual: false };

describe("computeLocation", () => {
  test("priority inbox > archive > trash > none", () => {
    expect(computeLocation(["inbox"])).toBe("inbox");
    expect(computeLocation(["junk"])).toBe("inbox");
    expect(computeLocation(["archive", "trash"])).toBe("archive");
    expect(computeLocation(["trash", "sent"])).toBe("trash");
    expect(computeLocation(["sent", "drafts", "local"])).toBe("none");
    expect(computeLocation(["archive", "inbox"])).toBe("inbox");
  });
});

describe("summarizeThread", () => {
  test("basic counts and fields", () => {
    const s = summarizeThread(
      [
        msg({ date: 1, seen: false }),
        msg({ date: 2, seen: false, flagged: true, hasAttachments: true }),
        msg({ date: 3, isOutbound: true, folderRole: "sent", seen: true }),
      ],
      EXISTING,
      OWNER,
      NOW,
    );
    expect(s.messageCount).toBe(3);
    expect(s.unreadCount).toBe(2);
    expect(s.unread).toBe(true);
    expect(s.starred).toBe(true);
    expect(s.hasAttachments).toBe(true);
    expect(s.hasSent).toBe(true);
    expect(s.location).toBe("inbox");
    expect(s.listKey).toBe("primary");
    expect(s.lastMessageAt).toBe(3);
  });

  test("inbox comes from latest inbound in inbox location", () => {
    const s = summarizeThread(
      [
        msg({ date: 1, inbox: "primary" }),
        msg({ date: 2, inbox: "other" }),
        msg({ date: 3, isOutbound: true, folderRole: "sent" }),
      ],
      EXISTING,
      OWNER,
      NOW,
    );
    expect(s.inbox).toBe("other");
  });

  test("inbox falls back to latest inbound with a value, then existing, then primary", () => {
    const withArchived = summarizeThread(
      [
        msg({ date: 1, inbox: "other", folderRole: "archive" }),
        msg({ date: 2, folderRole: "archive" }),
      ],
      EXISTING,
      OWNER,
      NOW,
    );
    expect(withArchived.inbox).toBe("other");
    expect(withArchived.location).toBe("archive");

    const noValue = summarizeThread(
      [msg({ date: 1 })],
      { inboxManual: false, inbox: "other" },
      OWNER,
      NOW,
    );
    expect(noValue.inbox).toBe("other");

    const fallback = summarizeThread([msg({ date: 1 })], EXISTING, OWNER, NOW);
    expect(fallback.inbox).toBe("primary");
  });

  test("unreadCount is zero when location is trash, ignores outbound", () => {
    const s = summarizeThread(
      [
        msg({ date: 1, seen: false, folderRole: "trash" }),
        msg({ date: 2, seen: false, isOutbound: true, folderRole: "trash" }),
      ],
      EXISTING,
      OWNER,
      NOW,
    );
    expect(s.location).toBe("trash");
    expect(s.unreadCount).toBe(0);
    expect(s.unread).toBe(false);
    expect(s.listKey).toBe("trash");
  });

  test("unseen inbound in trash folder does not count when thread stays in inbox", () => {
    const s = summarizeThread(
      [
        msg({ date: 1, seen: false, folderRole: "trash" }),
        msg({ date: 2, seen: false, folderRole: "inbox" }),
      ],
      EXISTING,
      OWNER,
      NOW,
    );
    expect(s.location).toBe("inbox");
    expect(s.unreadCount).toBe(1);
  });

  test("categoryIds union over inbound only, stable first-seen order", () => {
    const s = summarizeThread(
      [
        msg({ date: 1, categoryIds: ["b", "a"] }),
        msg({ date: 2, categoryIds: ["a", "c"], isOutbound: true }),
        msg({ date: 3, categoryIds: ["d", "a"] }),
      ],
      EXISTING,
      OWNER,
      NOW,
    );
    expect(s.categoryIds).toEqual(["b", "a", "d"]);
  });

  test("participants prefer non-owner senders, most recent first, max 4", () => {
    const senders = [
      "me@x.com",
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
      "e@x.com",
    ];
    const s = summarizeThread(
      senders.map((email, i) =>
        msg({ date: i + 1, from: { email }, isOutbound: email === "me@x.com" }),
      ),
      EXISTING,
      OWNER,
      NOW,
    );
    expect(s.participants.map((p) => p.email)).toEqual([
      "e@x.com",
      "d@x.com",
      "c@x.com",
      "b@x.com",
    ]);
  });

  test("subject and snippet from latest non-draft message", () => {
    const s = summarizeThread(
      [
        msg({ date: 1, subject: "Re: First", snippet: "old" }),
        msg({ date: 5, folderRole: "drafts", subject: "WIP", snippet: "draft" }),
        msg({ date: 3, subject: "Fwd: Real", snippet: "latest body" }),
      ],
      EXISTING,
      OWNER,
      NOW,
    );
    expect(s.subject).toBe("Real");
    expect(s.snippet).toBe("latest body");
    expect(s.hasDraft).toBe(true);
  });

  test("snoozed listKey only while snoozedUntil is in the future in inbox", () => {
    const base = [msg({ date: 1, inbox: "other" })];
    const snoozed = summarizeThread(
      base,
      { inboxManual: false, snoozedUntil: NOW + 1000 },
      OWNER,
      NOW,
    );
    expect(snoozed.listKey).toBe("snoozed");
    const expired = summarizeThread(
      base,
      { inboxManual: false, snoozedUntil: NOW - 1 },
      OWNER,
      NOW,
    );
    expect(expired.listKey).toBe("other");
  });
});

describe("computeListKey", () => {
  test("rules", () => {
    expect(computeListKey("archive", "primary", undefined, NOW)).toBe("archive");
    expect(computeListKey("trash", "other", undefined, NOW)).toBe("trash");
    expect(computeListKey("none", "primary", undefined, NOW)).toBe("none");
    expect(computeListKey("inbox", "other", undefined, NOW)).toBe("other");
    expect(computeListKey("inbox", "other", NOW + 5, NOW)).toBe("snoozed");
  });
});
