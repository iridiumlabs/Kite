import { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

export const modules = import.meta.glob(["../../convex/**/*.ts"]);

export type T = ReturnType<typeof makeT>;

export function makeT() {
  return convexTest(schema, modules);
}

export function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedAccount(
  t: T,
  userId: string,
  email = "me@x.com",
): Promise<Id<"accounts">> {
  return await t.run((ctx) =>
    ctx.db.insert("accounts", {
      userId,
      email,
      displayName: "Me",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      username: email,
      status: "ready",
      initialSyncDone: true,
      sortOrder: 0,
      createdAt: Date.now(),
    }),
  );
}

export type TestFolderRole =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "junk";

export async function seedFolder(
  t: T,
  userId: string,
  accountId: Id<"accounts">,
  role: TestFolderRole,
  path: string,
): Promise<Id<"folders">> {
  return await t.run((ctx) =>
    ctx.db.insert("folders", {
      userId,
      accountId,
      path,
      role,
      syncedUids: "",
      flags: "",
      backfillDone: true,
      updatedAt: Date.now(),
    }),
  );
}

export async function seedFolders(
  t: T,
  userId: string,
  accountId: Id<"accounts">,
): Promise<Record<string, Id<"folders">>> {
  const out: Record<string, Id<"folders">> = {};
  for (const [role, path] of [
    ["inbox", "INBOX"],
    ["sent", "Sent"],
    ["drafts", "Drafts"],
    ["archive", "Archive"],
    ["trash", "Trash"],
    ["junk", "Junk"],
  ] as const) {
    out[role] = await seedFolder(t, userId, accountId, role, path);
  }
  return out;
}

export interface TestMessage {
  userId: string;
  accountId: Id<"accounts">;
  folderId: Id<"folders"> | null;
  folderRole: TestFolderRole | "local";
  uid?: number;
  messageIdHeader: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  from: { name?: string; email: string };
  to: { name?: string; email: string }[];
  cc: { name?: string; email: string }[];
  bcc: { name?: string; email: string }[];
  replyTo: { name?: string; email: string }[];
  date: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  isOutbound: boolean;
  hasAttachments: boolean;
  size?: number;
  inbox?: "primary" | "other";
  categoryIds?: Id<"categories">[];
  classifiedBy?: "jev" | "heuristic" | "manual" | "inherited";
  needsClassification?: boolean;
  classifyAttempts?: number;
  bulk?: boolean;
  kiteDraftId?: string;
  sourceStorageId?: Id<"_storage">;
}

let counter = 1;
const BASE_DATE = 1_700_000_000_000;

export function makeMessage(
  userId: string,
  accountId: Id<"accounts">,
  over: Partial<TestMessage> = {},
): TestMessage {
  const n = counter++;
  return {
    userId,
    accountId,
    folderId: null,
    folderRole: "inbox",
    uid: n,
    messageIdHeader: `m${n}@test`,
    subject: `Message ${n}`,
    from: { name: "Sender", email: "sender@x.com" },
    to: [{ email: "me@x.com" }],
    cc: [],
    bcc: [],
    replyTo: [],
    date: BASE_DATE + n,
    snippet: `snippet ${n}`,
    seen: true,
    flagged: false,
    answered: false,
    isOutbound: false,
    hasAttachments: false,
    inbox: "primary",
    needsClassification: false,
    ...over,
  };
}
