import { uidCount, parseUidSet } from "./uidset";
import type { FolderRole } from "./types";

export interface SyncCapabilities {
  condstore: boolean;
  qresync: boolean;
  move: boolean;
  uidplus: boolean;
  specialUse: boolean;
}

export interface FolderStoredState {
  path: string;
  role: FolderRole;
  uidValidity?: number;
  uidNext?: number;
  highestModseq?: string;
  unseen?: number;
  messages?: number;
  syncedUids: string;
  oldestUid?: number;
  backfillDone: boolean;
  lastFlagsFullAt?: number;
}

export interface FolderStatus {
  uidValidity: number;
  uidNext: number;
  highestModseq?: string;
  messages: number;
  unseen: number;
}

export const FLAGS_FULL_INTERVAL_MS = 10 * 60 * 1000;
export const FOLDER_DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const INITIAL_WINDOW: Record<FolderRole, number> = {
  inbox: 300,
  sent: 200,
  drafts: 100,
  archive: 100,
  trash: 100,
  junk: 100,
};

export type FolderPlan =
  | { kind: "skip" }
  | { kind: "initial"; window: number }
  | { kind: "uidvalidityReset" }
  | {
      kind: "incremental";
      fetchFromUid: number | null;
      detectVanished: boolean;
      flagMode: "condstore" | "full" | "none";
      flagsSinceModseq?: string;
    };

// Decides what a folder sync needs to do, given the stored sync state, the
// fresh STATUS result and server capabilities. An unchanged folder produces
// "skip" so sync performs zero DB writes for it.
export function planFolderSync(
  stored: FolderStoredState,
  status: FolderStatus,
  caps: SyncCapabilities,
  now: number,
): FolderPlan {
  if (
    stored.uidValidity === undefined &&
    stored.syncedUids === "" &&
    stored.uidNext === undefined
  ) {
    return { kind: "initial", window: INITIAL_WINDOW[stored.role] };
  }

  if (stored.uidValidity !== status.uidValidity) {
    return { kind: "uidvalidityReset" };
  }

  const synced = parseUidSet(stored.syncedUids);
  const syncedCount = uidCount(synced);
  const fromUid = stored.uidNext ?? 1;
  const newUids = Math.max(0, status.uidNext - fromUid);
  const fetchFromUid = newUids > 0 ? fromUid : null;

  // Anything that makes the stored UID set suspect triggers a UID SEARCH:
  // a message count that cannot be explained by arrivals alone, or any new
  // arrivals (cheap insurance against add+expunge in the same window).
  const detectVanished =
    status.messages !== syncedCount + newUids || newUids > 0;

  let flagMode: "condstore" | "full" | "none" = "none";
  let flagsSinceModseq: string | undefined;
  const modseqChanged =
    status.highestModseq !== undefined &&
    stored.highestModseq !== undefined &&
    status.highestModseq !== stored.highestModseq;
  const unseenChanged =
    stored.unseen !== undefined && status.unseen !== stored.unseen;
  const flagsStale =
    stored.lastFlagsFullAt === undefined ||
    now - stored.lastFlagsFullAt > FLAGS_FULL_INTERVAL_MS;

  if (caps.condstore && stored.highestModseq !== undefined && modseqChanged) {
    flagMode = "condstore";
    flagsSinceModseq = stored.highestModseq;
  } else if (syncedCount > 0 && (unseenChanged || flagsStale)) {
    flagMode = "full";
  }

  if (
    fetchFromUid === null &&
    !detectVanished &&
    flagMode === "none" &&
    stored.unseen === status.unseen &&
    stored.messages === status.messages &&
    stored.highestModseq === status.highestModseq
  ) {
    return { kind: "skip" };
  }

  return {
    kind: "incremental",
    fetchFromUid,
    detectVanished,
    flagMode,
    flagsSinceModseq,
  };
}

// UIDs to fetch on the very first sync: the newest `window` UIDs below
// uidNext. Returns [first, last] inclusive or null when the folder is empty.
export function initialWindowRange(
  uidNext: number,
  window: number,
): [number, number] | null {
  if (uidNext <= 1) return null;
  const last = uidNext - 1;
  return [Math.max(1, last - window + 1), last];
}

const SPECIAL_USE_ROLES: [RegExp, FolderRole][] = [
  [/^\\sent$/i, "sent"],
  [/^\\drafts$/i, "drafts"],
  [/^\\archive$/i, "archive"],
  [/^\\trash$/i, "trash"],
  [/^\\junk$/i, "junk"],
];

const NAME_ROLE_FALLBACKS: [RegExp, FolderRole][] = [
  [/^sent( items| messages| mail)?$/i, "sent"],
  [/^drafts?$/i, "drafts"],
  [/^(archive|archives|all mail)$/i, "archive"],
  [/^(trash|deleted( items| messages)?|bin|deleted items)$/i, "trash"],
  [/^(junk|spam|bulk mail|junk e-?mail)$/i, "junk"],
];

export interface ListedMailbox {
  path: string;
  specialUse?: string;
}

// Maps a server mailbox to a folder role. INBOX always maps to inbox;
// SPECIAL-USE attributes win over name fallbacks.
export function roleForMailbox(m: ListedMailbox): FolderRole | null {
  if (m.path === "INBOX") return "inbox";
  if (m.specialUse) {
    for (const [re, role] of SPECIAL_USE_ROLES) {
      if (re.test(m.specialUse)) return role;
    }
  }
  const leaf = m.path.split(/[/.]/).pop() ?? m.path;
  for (const [re, role] of NAME_ROLE_FALLBACKS) {
    if (re.test(m.path) || re.test(leaf)) return role;
  }
  return null;
}

export interface ExistingMsg {
  docId: string;
  folderId: string;
  folderRole: string;
  uid?: number;
}

export interface NewMsgRef {
  folderId: string;
  folderRole: string;
  uid: number;
  messageIdHeader: string;
}

export interface ReconcileResult {
  relocations: {
    docId: string;
    folderId: string;
    folderRole: string;
    uid: number;
  }[];
  inserts: NewMsgRef[];
  deletions: string[];
}

// Reconciles server-side changes account-wide: a UID that newly appears in
// folder B whose Message-ID matches a doc that vanished from folder A in the
// same run is a move, not a delete+insert. Vanished docs that did not move
// are deleted; new UIDs that are not relocations are inserted.
export function reconcileMoves(
  vanished: { docId: string; folderId: string; uid: number; messageIdHeader: string }[],
  newMessages: NewMsgRef[],
  existingByMsgId: Map<string, ExistingMsg[]>,
): ReconcileResult {
  const relocatedDocIds = new Set<string>();
  const relocations: ReconcileResult["relocations"] = [];
  const inserts: NewMsgRef[] = [];
  const deletions: string[] = [];

  const vanishedByMsgId = new Map<string, typeof vanished>();
  for (const v of vanished) {
    const list = vanishedByMsgId.get(v.messageIdHeader) ?? [];
    list.push(v);
    vanishedByMsgId.set(v.messageIdHeader, list);
  }

  const matchedVanished = new Set<string>();
  for (const msg of newMessages) {
    const candidates = (vanishedByMsgId.get(msg.messageIdHeader) ?? []).filter(
      (v) => !matchedVanished.has(v.docId),
    );
    const relocated = candidates[0];
    if (relocated) {
      matchedVanished.add(relocated.docId);
      relocatedDocIds.add(relocated.docId);
      relocations.push({
        docId: relocated.docId,
        folderId: msg.folderId,
        folderRole: msg.folderRole,
        uid: msg.uid,
      });
      continue;
    }
    // A doc with the same Message-ID already tracked elsewhere (e.g. a
    // server-side copy): it is a genuine duplicate location, keep it.
    const existing = existingByMsgId.get(msg.messageIdHeader) ?? [];
    const alreadyThere = existing.find(
      (e) => e.folderId === msg.folderId && e.uid === msg.uid,
    );
    if (!alreadyThere) inserts.push(msg);
  }

  for (const v of vanished) {
    if (!relocatedDocIds.has(v.docId)) deletions.push(v.docId);
  }

  return { relocations, inserts, deletions };
}
