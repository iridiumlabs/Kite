import { describe, expect, test } from "vitest";
import {
  buildJevRequests,
  decideInbox,
  heuristicClassify,
  mergeJevAnswers,
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
  owner: { name: "Me", addresses: ["me@x.com"] },
  email: {
    from: { name: "Ann", email: "ann@x.com" },
    to: [{ email: "me@x.com" }],
    cc: [],
    subject: "Hi",
    date: 1_700_000_000_000,
    folder: "inbox",
    bodyExcerpt: "x".repeat(5000),
    attachments: Array.from({ length: 20 }, (_, i) => `f${i}.pdf`),
    headers: {
      listUnsubscribe: true,
      listId: "list.example",
      precedence: "bulk",
      autoSubmitted: "no",
    },
  },
  thread: {
    ownerStarted: false,
    ownerParticipated: true,
    directReplyToOwner: true,
    messageCount: 3,
    previousMessages: [
      { from: "owner", snippet: "first" },
      { from: "Ann <ann@x.com>", snippet: "second" },
      { from: "owner", snippet: "third" },
      { from: "Ann <ann@x.com>", snippet: "fourth" },
    ],
  },
  categories: CATS(3),
  model: "jev-test",
};

describe("buildJevRequests", () => {
  test("questions is an object keyed by id with 6 fixed + up to 26 categories", () => {
    const [req] = buildJevRequests({ ...INPUT, categories: CATS(26) });
    expect(Object.keys(req.questions)).toHaveLength(32);
    const ids = Object.keys(req.questions);
    expect(ids).toEqual([
      "inbox",
      "automated",
      "bulk",
      "cold_outreach",
      "needs_attention",
      "genuine_reply",
      ...Array.from({ length: 26 }, (_, i) => `c${i}`),
    ]);
    expect(req.model).toBe("jev-test");
  });

  test("inbox question is a choice with a criteria map", () => {
    const [req] = buildJevRequests(INPUT);
    const q = req.questions.inbox;
    expect(q.type).toBe("choice");
    if (q.type !== "choice") throw new Error("unreachable");
    expect(Object.keys(q.criteria)).toEqual(["primary", "other"]);
    expect(q.criteria.primary).toMatch(/genuine human reply/i);
    expect(q.criteria.other).toMatch(/newsletters/i);
  });

  test("noul questions carry no criteria", () => {
    const [req] = buildJevRequests(INPUT);
    for (const [id, q] of Object.entries(req.questions)) {
      if (id === "inbox") continue;
      expect(q.type).toBe("noul");
      expect("criteria" in q).toBe(false);
    }
    expect(req.questions.c0.instructions).toContain('"Category 0"');
    expect(req.questions.c0.instructions).toContain("desc 0");
  });

  test("categories chunk across requests with global ids", () => {
    const reqs = buildJevRequests({ ...INPUT, categories: CATS(27) });
    expect(reqs).toHaveLength(2);
    expect(Object.keys(reqs[0].questions)).toHaveLength(32);
    expect(Object.keys(reqs[1].questions)).toEqual(["c26"]);

    const more = buildJevRequests({ ...INPUT, categories: CATS(59) });
    expect(more).toHaveLength(3);
    expect(Object.keys(more[2].questions)).toEqual(
      Array.from({ length: 1 }, (_, i) => `c${58 + i}`),
    );
    expect(Object.keys(more[1].questions)).toHaveLength(32);
  });

  test("state shape", () => {
    const [req] = buildJevRequests(INPUT);
    const state = req.state as {
      owner: { name: string; addresses: string[] };
      email: {
        body_excerpt: string;
        attachments: string[];
        date: string;
        headers: Record<string, unknown>;
      };
      thread: { previous_messages: { snippet: string }[] };
    };
    expect(state.owner).toEqual({ name: "Me", addresses: ["me@x.com"] });
    expect(state.email.body_excerpt.length).toBeLessThanOrEqual(2000);
    expect(state.email.attachments).toHaveLength(10);
    expect(state.email.date).toBe("2023-11-14T22:13:20.000Z");
    expect(state.email.headers).toEqual({
      list_unsubscribe: true,
      list_id: "list.example",
      precedence: "bulk",
      auto_submitted: "no",
    });
    expect(state.thread.previous_messages).toHaveLength(3);
    expect(state.thread.previous_messages[0].snippet).toBe("second");
  });

  test("thread is omitted for a new thread", () => {
    const [req] = buildJevRequests({ ...INPUT, thread: undefined });
    expect("thread" in req.state).toBe(false);
  });
});

describe("decideInbox", () => {
  const answers = (over: Record<string, unknown>) => ({
    inbox: { type: "choice" as const, choice: "primary" },
    automated: { type: "noul" as const, noul: 0 },
    bulk: { type: "noul" as const, noul: 0 },
    cold_outreach: { type: "noul" as const, noul: 0 },
    needs_attention: { type: "noul" as const, noul: 0 },
    genuine_reply: { type: "noul" as const, noul: 0 },
    ...(over as Record<string, { type: string }>),
  });

  test("junk folder is always other", () => {
    expect(
      decideInbox(
        answers({ genuine_reply: { type: "noul", noul: 0.99 } }),
        { folderRole: "junk" },
      ),
    ).toBe("other");
  });

  test("genuine human reply beats automation below 0.5", () => {
    expect(
      decideInbox(
        answers({
          genuine_reply: { type: "noul", noul: 0.6 },
          automated: { type: "noul", noul: 0.49 },
        }),
        { folderRole: "inbox" },
      ),
    ).toBe("primary");
    // automated >= 0.5 vetoes the reply override but is below the 0.6
    // "other" threshold, so the inbox choice applies.
    expect(
      decideInbox(
        {
          ...answers({
            genuine_reply: { type: "noul", noul: 0.9 },
            automated: { type: "noul", noul: 0.5 },
          }),
          inbox: { type: "choice", choice: "other" },
        },
        { folderRole: "inbox" },
      ),
    ).toBe("other");
    expect(
      decideInbox(
        answers({
          genuine_reply: { type: "noul", noul: 0.9 },
          automated: { type: "noul", noul: 0.6 },
        }),
        { folderRole: "inbox" },
      ),
    ).toBe("other");
  });

  test("needs_attention >= 0.75 is primary", () => {
    expect(
      decideInbox(
        answers({ needs_attention: { type: "noul", noul: 0.75 } }),
        { folderRole: "inbox" },
      ),
    ).toBe("primary");
    // 0.74 is below the override threshold; the inbox choice applies.
    expect(
      decideInbox(
        {
          ...answers({ needs_attention: { type: "noul", noul: 0.74 } }),
          inbox: { type: "choice", choice: "other" },
        },
        { folderRole: "inbox" },
      ),
    ).toBe("other");
  });

  test("needs_attention does not override bulk or cold outreach", () => {
    // Marketing "act now" pressure is still bulk mail.
    expect(
      decideInbox(
        answers({
          needs_attention: { type: "noul", noul: 0.9 },
          bulk: { type: "noul", noul: 0.8 },
        }),
        { folderRole: "inbox" },
      ),
    ).toBe("other");
    expect(
      decideInbox(
        answers({
          needs_attention: { type: "noul", noul: 0.9 },
          cold_outreach: { type: "noul", noul: 0.8 },
        }),
        { folderRole: "inbox" },
      ),
    ).toBe("other");
    // Borderline signals below 0.5 still allow the override.
    expect(
      decideInbox(
        answers({
          needs_attention: { type: "noul", noul: 0.9 },
          bulk: { type: "noul", noul: 0.4 },
          cold_outreach: { type: "noul", noul: 0.4 },
        }),
        { folderRole: "inbox" },
      ),
    ).toBe("primary");
  });

  test("automated, bulk or cold outreach >= 0.6 is other", () => {
    for (const key of ["automated", "bulk", "cold_outreach"]) {
      expect(
        decideInbox(answers({ [key]: { type: "noul", noul: 0.6 } }), {
          folderRole: "inbox",
        }),
      ).toBe("other");
    }
  });

  test("falls back to the inbox choice, then primary", () => {
    expect(decideInbox(answers({}), { folderRole: "inbox" })).toBe("primary");
    expect(
      decideInbox(
        { inbox: { type: "choice", choice: "other" } },
        { folderRole: "inbox" },
      ),
    ).toBe("other");
    expect(decideInbox({}, { folderRole: "inbox" })).toBe("primary");
  });
});

describe("parseJevResponses", () => {
  test("parses answers into inbox, confidence and categories", () => {
    const res: JevResponseBody = {
      answers: {
        inbox: { type: "choice", choice: "other", confidence: 0.78 },
        automated: { type: "noul", noul: 0 },
        bulk: { type: "noul", noul: 0 },
        cold_outreach: { type: "noul", noul: 0 },
        needs_attention: { type: "noul", noul: 0 },
        genuine_reply: { type: "noul", noul: 0 },
        c0: { type: "noul", noul: 0.91 },
        c1: { type: "noul", noul: 0.6 },
        c2: { type: "noul", noul: 0.59 },
      },
    };
    const parsed = parseJevResponses([res], CATS(3), { folderRole: "inbox" });
    expect(parsed.inbox).toBe("other");
    expect(parsed.inboxConfidence).toBe(0.78);
    expect(parsed.categoryIds).toEqual(["cat_0", "cat_1"]);
  });

  test("merges answers across chunked requests", () => {
    const merged = mergeJevAnswers([
      { answers: { inbox: { type: "choice", choice: "primary" } } },
      { answers: { c32: { type: "noul", noul: 0.9 } } },
    ]);
    const parsed = parseJevResponses(
      [{ answers: merged }],
      CATS(33),
      { folderRole: "inbox" },
    );
    expect(parsed.inbox).toBe("primary");
    expect(parsed.categoryIds).toEqual(["cat_32"]);
  });

  test("tolerates missing answers", () => {
    const parsed = parseJevResponses([{ answers: {} }], CATS(2), {
      folderRole: "inbox",
    });
    expect(parsed.inbox).toBe("primary");
    expect(parsed.categoryIds).toEqual([]);
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
    expect(
      heuristicClassify({ ...base, headers: { precedence: "bulk" } }),
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
      "bounces@x.com",
      "promo@x.com",
    ]) {
      expect(heuristicClassify({ ...base, from: { email } })).toBe("other");
    }
  });

  test("vendor and personal-style senders are not flagged", () => {
    for (const email of [
      "support@x.com",
      "info@x.com",
      "hello@x.com",
      "news@x.com",
      "updates@x.com",
      "bot@x.com",
      "person@x.com",
    ]) {
      expect(heuristicClassify({ ...base, from: { email } })).toBe("primary");
    }
  });

  test("default is primary", () => {
    expect(heuristicClassify(base)).toBe("primary");
    expect(
      heuristicClassify({ ...base, isReplyToOwnerThread: true }),
    ).toBe("primary");
  });
});
