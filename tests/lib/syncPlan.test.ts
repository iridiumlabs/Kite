import { describe, expect, test } from "vitest";
import {
  planFolderSync,
  initialWindowRange,
  roleForMailbox,
  reconcileMoves,
  FLAGS_FULL_INTERVAL_MS,
  type FolderStatus,
  type FolderStoredState,
  type SyncCapabilities,
} from "../../convex/lib/syncPlan";

const CAPS: SyncCapabilities = {
  condstore: true,
  qresync: true,
  move: true,
  uidplus: true,
  specialUse: true,
};
const NO_CAPS: SyncCapabilities = {
  condstore: false,
  qresync: false,
  move: false,
  uidplus: false,
  specialUse: false,
};
const NOW = 1_700_000_000_000;

function stored(over: Partial<FolderStoredState> = {}): FolderStoredState {
  return {
    path: "INBOX",
    role: "inbox",
    uidValidity: 111,
    uidNext: 11,
    highestModseq: "50",
    unseen: 1,
    messages: 10,
    syncedUids: "1-10",
    oldestUid: 1,
    backfillDone: true,
    lastFlagsFullAt: NOW,
    ...over,
  };
}

function status(over: Partial<FolderStatus> = {}): FolderStatus {
  return {
    uidValidity: 111,
    uidNext: 11,
    highestModseq: "50",
    messages: 10,
    unseen: 1,
    ...over,
  };
}

describe("planFolderSync", () => {
  test("empty stored state plans an initial window fetch", () => {
    const plan = planFolderSync(
      stored({
        uidValidity: undefined,
        uidNext: undefined,
        syncedUids: "",
      }),
      status(),
      CAPS,
      NOW,
    );
    expect(plan).toEqual({ kind: "initial", window: 300 });
  });

  test("initial window is role-specific", () => {
    for (const [role, window] of [
      ["inbox", 300],
      ["sent", 200],
      ["drafts", 100],
      ["archive", 100],
    ] as const) {
      const plan = planFolderSync(
        stored({
          role,
          uidValidity: undefined,
          uidNext: undefined,
          syncedUids: "",
        }),
        status(),
        CAPS,
        NOW,
      );
      expect(plan).toEqual({ kind: "initial", window });
    }
  });

  test("uidvalidity mismatch forces a reset", () => {
    const plan = planFolderSync(
      stored(),
      status({ uidValidity: 999 }),
      CAPS,
      NOW,
    );
    expect(plan.kind).toBe("uidvalidityReset");
  });

  test("unchanged folder is skipped", () => {
    const plan = planFolderSync(stored(), status(), CAPS, NOW);
    expect(plan.kind).toBe("skip");
  });

  test("new uids trigger a fetch and vanished detection", () => {
    const plan = planFolderSync(
      stored(),
      status({ uidNext: 15, messages: 14 }),
      CAPS,
      NOW,
    );
    expect(plan.kind).toBe("incremental");
    if (plan.kind !== "incremental") return;
    expect(plan.fetchFromUid).toBe(11);
    expect(plan.detectVanished).toBe(true);
  });

  test("message count mismatch triggers vanished detection", () => {
    const plan = planFolderSync(
      stored(),
      status({ messages: 8 }),
      CAPS,
      NOW,
    );
    expect(plan.kind).toBe("incremental");
    if (plan.kind !== "incremental") return;
    expect(plan.fetchFromUid).toBeNull();
    expect(plan.detectVanished).toBe(true);
  });

  test("modseq change uses condstore flag fetch when supported", () => {
    const plan = planFolderSync(
      stored(),
      status({ highestModseq: "60" }),
      CAPS,
      NOW,
    );
    expect(plan.kind).toBe("incremental");
    if (plan.kind !== "incremental") return;
    expect(plan.flagMode).toBe("condstore");
    expect(plan.flagsSinceModseq).toBe("50");
  });

  test("unseen change falls back to a full flag fetch without condstore", () => {
    const plan = planFolderSync(
      stored(),
      status({ unseen: 2 }),
      NO_CAPS,
      NOW,
    );
    expect(plan.kind).toBe("incremental");
    if (plan.kind !== "incremental") return;
    expect(plan.flagMode).toBe("full");
  });

  test("stale flags trigger a full fetch past the interval", () => {
    const plan = planFolderSync(
      stored({ lastFlagsFullAt: NOW - FLAGS_FULL_INTERVAL_MS - 1 }),
      status(),
      NO_CAPS,
      NOW,
    );
    if (plan.kind !== "incremental") throw new Error(plan.kind);
    expect(plan.flagMode).toBe("full");
  });

  test("missing modseq disables condstore flag mode", () => {
    const plan = planFolderSync(
      stored({ highestModseq: undefined, unseen: 1 }),
      status({ highestModseq: undefined, messages: 10 }),
      CAPS,
      NOW,
    );
    expect(plan.kind).toBe("skip");
  });

  test("unseen changed without condstore support does a full fetch", () => {
    const plan = planFolderSync(
      stored({ highestModseq: "50", unseen: 1 }),
      status({ highestModseq: "50", unseen: 3 }),
      CAPS,
      NOW,
    );
    // highestModseq unchanged so condstore is not selected; unseen changed
    // forces a full flag refresh.
    if (plan.kind !== "incremental") throw new Error(plan.kind);
    expect(plan.flagMode).toBe("full");
  });
});

describe("initialWindowRange", () => {
  test("empty folder yields null", () => {
    expect(initialWindowRange(1, 300)).toBeNull();
  });
  test("window smaller than mailbox", () => {
    expect(initialWindowRange(501, 300)).toEqual([201, 500]);
  });
  test("window larger than mailbox clamps to 1", () => {
    expect(initialWindowRange(50, 300)).toEqual([1, 49]);
  });
});

describe("roleForMailbox", () => {
  test("INBOX is always inbox", () => {
    expect(roleForMailbox({ path: "INBOX" })).toBe("inbox");
  });
  test("special-use wins over name", () => {
    expect(
      roleForMailbox({ path: "Weird Name", specialUse: "\\Sent" }),
    ).toBe("sent");
    expect(
      roleForMailbox({ path: "Stuff", specialUse: "\\Junk" }),
    ).toBe("junk");
  });
  test("name fallbacks", () => {
    expect(roleForMailbox({ path: "Sent Items" })).toBe("sent");
    expect(roleForMailbox({ path: "Drafts" })).toBe("drafts");
    expect(roleForMailbox({ path: "Archives" })).toBe("archive");
    expect(roleForMailbox({ path: "Deleted Items" })).toBe("trash");
    expect(roleForMailbox({ path: "Spam" })).toBe("junk");
  });
  test("nested leaf names are recognized", () => {
    expect(roleForMailbox({ path: "Mail/Sent" })).toBe("sent");
  });
  test("unmapped folders return null", () => {
    expect(roleForMailbox({ path: "Receipts 2024" })).toBeNull();
  });
});

describe("reconcileMoves", () => {
  const ref = (over: Partial<{
    folderId: string;
    folderRole: string;
    uid: number;
    messageIdHeader: string;
  }> = {}) => ({
    folderId: "fB",
    folderRole: "archive",
    uid: 40,
    messageIdHeader: "a@x",
    ...over,
  });

  test("vanished message reappearing elsewhere relocates", () => {
    const r = reconcileMoves(
      [
        {
          docId: "doc1",
          folderId: "fA",
          uid: 5,
          messageIdHeader: "a@x",
        },
      ],
      [ref()],
      new Map(),
    );
    expect(r.relocations).toEqual([
      { docId: "doc1", folderId: "fB", folderRole: "archive", uid: 40 },
    ]);
    expect(r.inserts).toEqual([]);
    expect(r.deletions).toEqual([]);
  });

  test("unmatched vanished docs are deleted", () => {
    const r = reconcileMoves(
      [{ docId: "doc1", folderId: "fA", uid: 5, messageIdHeader: "a@x" }],
      [],
      new Map(),
    );
    expect(r.deletions).toEqual(["doc1"]);
  });

  test("unmatched new uids are inserted", () => {
    const r = reconcileMoves([], [ref()], new Map());
    expect(r.inserts).toEqual([ref()]);
    expect(r.deletions).toEqual([]);
  });

  test("already-tracked duplicate location is not reinserted", () => {
    const existing = new Map([
      [
        "a@x",
        [{ docId: "doc1", folderId: "fB", folderRole: "archive", uid: 40 }],
      ],
    ]);
    const r = reconcileMoves([], [ref()], existing);
    expect(r.inserts).toEqual([]);
  });

  test("two copies vanished and two reappear relocates both", () => {
    const r = reconcileMoves(
      [
        { docId: "d1", folderId: "fA", uid: 1, messageIdHeader: "a@x" },
        { docId: "d2", folderId: "fC", uid: 7, messageIdHeader: "a@x" },
      ],
      [ref({ folderId: "fD", uid: 9 }), ref({ folderId: "fE", uid: 3 })],
      new Map(),
    );
    expect(r.relocations).toHaveLength(2);
    expect(r.deletions).toEqual([]);
    expect(r.inserts).toEqual([]);
  });
});
