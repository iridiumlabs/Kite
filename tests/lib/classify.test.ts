import { describe, expect, test } from "vitest";
import {
  buildJevRequests,
  heuristicClassify,
  parseJevResponses,
  type JevRequestInput,
  type JevResponseBody,
} from "../../convex/lib/classify";

const CATS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `cat_${i}`,
    name: `Category ${i}`,
    description: `desc ${i}`,
  }));

const INPUT: JevRequestInput = {
  owner: { emails: ["me@x.com"] },
  message: {
    from: { name: "Ann", email: "ann@x.com" },
    to: [{ email: "me@x.com" }],
    cc: [],
    subject: "Hi",
    date: 1_700_000_000_000,
    snippet: "snippet",
    bodyExcerpt: "x".repeat(5000),
    bulk: false,
    isReply: true,
    folderRole: "inbox",
  },
  thread: {
    ownerParticipated: true,
    isDirectReplyToOwner: true,
    previousSenders: ["ann@x.com"],
    messageCount: 3,
  },
  categories: CATS(3),
  model: "jev-test",
};

describe("buildJevRequests", () => {
  test("first request carries inbox + up to 31 categories", () => {
    const [req] = buildJevRequests({ ...INPUT, categories: CATS(31) });
    expect(req.questions).toHaveLength(32);
    expect(req.questions[0].id).toBe("inbox");
    expect(req.questions[0].type).toBe("choice");
    expect(req.questions[31].id).toBe("c30");
    expect(req.model).toBe("jev-test");
  });

  test("categories chunk across requests with global ids", () => {
    const reqs = buildJevRequests({ ...INPUT, categories: CATS(33) });
    expect(reqs).toHaveLength(2);
    expect(reqs[0].questions).toHaveLength(32);
    expect(reqs[1].questions).toHaveLength(2);
    expect(reqs[1].questions.map((q) => q.id)).toEqual(["c31", "c32"]);
    expect(reqs[1].questions[0].type).toBe("noul");

    const more = buildJevRequests({ ...INPUT, categories: CATS(64) });
    expect(more).toHaveLength(3);
    expect(more[2].questions.map((q) => q.id)).toEqual(["c63"]);
  });

  test("inbox question encodes primary/other criteria", () => {
    const [req] = buildJevRequests(INPUT);
    const q = req.questions[0];
    const primary = q.choices!.find((c) => c.value === "primary")!;
    const other = q.choices!.find((c) => c.value === "other")!;
    expect(primary.criteria).toMatch(/replies/i);
    expect(other.criteria).toMatch(/newsletters|promotions|bulk/i);
  });

  test("body excerpt is capped around 2000 chars", () => {
    const [req] = buildJevRequests(INPUT);
    const excerpt = (req.state as { body_excerpt: string }).body_excerpt;
    expect(excerpt.length).toBeLessThanOrEqual(2000);
  });
});

describe("parseJevResponses", () => {
  test("parses inbox choice, confidence and category nouls", () => {
    const res: JevResponseBody = {
      answers: {
        inbox: { type: "choice", choice: "other", confidence: 0.78 },
        c0: { type: "noul", noul: 0.91 },
        c1: { type: "noul", noul: 0.6 },
        c2: { type: "noul", noul: 0.59 },
      },
    };
    const parsed = parseJevResponses([res], CATS(3));
    expect(parsed.inbox).toBe("other");
    expect(parsed.inboxConfidence).toBe(0.78);
    expect(parsed.categoryIds).toEqual(["cat_0", "cat_1"]);
  });

  test("merges answers across chunked requests", () => {
    const parsed = parseJevResponses(
      [
        { answers: { inbox: { type: "choice", choice: "primary" } } },
        { answers: { c32: { type: "noul", noul: 0.9 } } },
      ],
      CATS(33),
    );
    expect(parsed.inbox).toBe("primary");
    expect(parsed.categoryIds).toEqual(["cat_32"]);
  });

  test("tolerates missing answers", () => {
    const parsed = parseJevResponses([{ answers: {} }], CATS(2));
    expect(parsed.inbox).toBeNull();
    expect(parsed.categoryIds).toEqual([]);
    expect(parseJevResponses([{}], CATS(1)).inbox).toBeNull();
  });
});

describe("heuristicClassify", () => {
  const base = {
    folderRole: "inbox",
    from: { email: "person@x.com" },
    bulk: false,
    isReplyToOwnerThread: false,
  };

  test("junk folder is always other", () => {
    expect(heuristicClassify({ ...base, folderRole: "junk" })).toBe("other");
  });

  test("bulk/list/automation headers mean other", () => {
    expect(heuristicClassify({ ...base, bulk: true })).toBe("other");
    expect(
      heuristicClassify({ ...base, headers: { listUnsubscribe: true } }),
    ).toBe("other");
    expect(heuristicClassify({ ...base, headers: { listId: true } })).toBe(
      "other",
    );
    expect(
      heuristicClassify({ ...base, headers: { precedence: "bulk" } }),
    ).toBe("other");
    expect(
      heuristicClassify({ ...base, headers: { precedence: "list" } }),
    ).toBe("other");
    expect(
      heuristicClassify({ ...base, headers: { autoSubmitted: "auto-replied" } }),
    ).toBe("other");
    expect(
      heuristicClassify({ ...base, headers: { autoSubmitted: "no" } }),
    ).toBe("primary");
    expect(heuristicClassify({ ...base, headers: { esp: true } })).toBe(
      "other",
    );
  });

  test("noreply-style senders are other", () => {
    for (const email of [
      "noreply@x.com",
      "no-reply@x.com",
      "donotreply@x.com",
      "newsletter@x.com",
      "mailer-daemon@x.com",
    ]) {
      expect(
        heuristicClassify({ ...base, from: { email } }),
      ).toBe("other");
    }
  });

  test("human reply to an owner thread is primary, default is primary", () => {
    expect(
      heuristicClassify({ ...base, isReplyToOwnerThread: true }),
    ).toBe("primary");
    expect(heuristicClassify(base)).toBe("primary");
  });
});
