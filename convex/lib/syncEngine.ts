import {
  parseUidSet,
  formatUidSet,
  addUids,
  removeUids,
  type UidRange,
} from "./uidset";
import {
  planFolderSync,
  initialWindowRange,
  roleForMailbox,
  reconcileMoves,
  FOLDER_DISCOVERY_INTERVAL_MS,
  type FolderStatus,
  type NewMsgRef,
  type ExistingMsg,
  type SyncCapabilities,
} from "./syncPlan";
import { makeSnippet } from "./snippet";
import { isOwner } from "./addresses";
import {
  heuristicClassify,
  type HeuristicInput,
  type JevRequestInput,
} from "./classify";
import type {
  Classifier,
  ClassifyItem,
  FetchedMeta,
  FlagBits,
  FolderPatch,
  ImapPort,
  IngestMessageArg,
  ParserPort,
  PendingOpPayload,
  StoredFolder,
  StorePort,
} from "./ports";
import type { FolderRole } from "./types";

const FULL_SOURCE_MAX = 1024 * 1024;
const INGEST_BATCH = 50;
const CLASSIFY_CONCURRENCY = 4;
const MAX_CLASSIFY_PER_RUN = 200;
const MAX_REMOTE_DRAFT_IMPORTS = 50;

export interface EngineDeps {
  accountId: string;
  imap: ImapPort;
  store: StorePort;
  parser: ParserPort;
  classify: Classifier | null;
  now(): number;
  log(msg: string): void;
  pushDraftRemote?: (draftId: string) => Promise<{ uid?: number }>;
}

export interface SyncOutcome {
  changed: boolean;
  newMessages: number;
  vanished: number;
  flagChanges: number;
  opsProcessed: number;
}

function flagMask(f: FlagBits): number {
  return (f.seen ? 1 : 0) | (f.flagged ? 2 : 0) | (f.answered ? 4 : 0);
}

// Mutable working copy of a folder's sync state; produces the absolute
// FolderPatch that ingestBatch writes in the same transaction as messages.
class FolderState {
  synced: UidRange[];
  masks = new Map<number, number>();
  doc: StoredFolder;
  status?: FolderStatus;
  oldestUid?: number;
  backfillDone: boolean;
  lastFlagsFullAt?: number;

  constructor(doc: StoredFolder) {
    this.doc = doc;
    this.synced = parseUidSet(doc.syncedUids);
    let i = 0;
    for (const uid of iter(this.synced)) {
      this.masks.set(uid, doc.flags.charCodeAt(i) - 48);
      i++;
    }
    this.oldestUid = doc.oldestUid;
    this.backfillDone = doc.backfillDone;
    this.lastFlagsFullAt = doc.lastFlagsFullAt;
  }

  addSynced(uid: number, mask: number) {
    this.synced = addUids(this.synced, [uid]);
    this.masks.set(uid, mask);
    this.trackOldest(uid);
  }

  removeSynced(uids: Iterable<number>) {
    for (const uid of uids) this.masks.delete(uid);
    this.synced = removeUids(this.synced, uids);
  }

  setMask(uid: number, mask: number) {
    this.masks.set(uid, mask);
  }

  getMask(uid: number): number {
    return this.masks.get(uid) ?? 0;
  }

  has(uid: number): boolean {
    return this.masks.has(uid);
  }

  trackOldest(uid: number) {
    if (this.oldestUid === undefined || uid < this.oldestUid) {
      this.oldestUid = uid;
    }
    if (uid === 1) this.backfillDone = true;
  }

  patch(): FolderPatch {
    const p: FolderPatch = {
      syncedUids: formatUidSet(this.synced),
      flags: [...iter(this.synced)]
        .map((u) => String(this.masks.get(u) ?? 0))
        .join(""),
      oldestUid: this.oldestUid,
      backfillDone: this.backfillDone,
      lastFlagsFullAt: this.lastFlagsFullAt,
    };
    if (this.status) {
      p.uidValidity = this.status.uidValidity;
      p.uidNext = this.status.uidNext;
      p.highestModseq = this.status.highestModseq;
      p.unseen = this.status.unseen;
      p.messages = this.status.messages;
    }
    return p;
  }
}

function* iter(ranges: UidRange[]) {
  for (const [a, b] of ranges) for (let u = a; u <= b; u++) yield u;
}

export async function runAccountSync(deps: EngineDeps): Promise<SyncOutcome> {
  const { imap, store } = deps;
  const state = await store.getAccountState();
  if (!state) throw new Error("Account not found");
  const { account } = state;
  let folders = state.folders;
  const ownerAddresses = [account.email];

  const outcome: SyncOutcome = {
    changed: false,
    newMessages: 0,
    vanished: 0,
    flagChanges: 0,
    opsProcessed: 0,
  };

  const caps = await imap.capabilities();
  outcome.opsProcessed = await runPendingOps(deps, caps);

  const capsChanged =
    !account.capabilities ||
    account.capabilities.condstore !== caps.condstore ||
    account.capabilities.qresync !== caps.qresync ||
    account.capabilities.move !== caps.move ||
    account.capabilities.uidplus !== caps.uidplus ||
    account.capabilities.specialUse !== caps.specialUse;
  if (capsChanged) await store.updateAccount({ capabilities: caps });

  const now = deps.now();
  if (
    folders.length === 0 ||
    !account.foldersDiscoveredAt ||
    now - account.foldersDiscoveredAt > FOLDER_DISCOVERY_INTERVAL_MS
  ) {
    const listed = await imap.listMailboxes();
    for (const m of listed) {
      if (m.noSelect) continue;
      const role = roleForMailbox(m);
      if (!role) continue;
      await store.upsertFolder({
        path: m.path,
        role,
        delimiter: m.delimiter,
      });
    }
    await store.markDiscovery(now);
    const reloaded = await store.getAccountState();
    folders = reloaded ? reloaded.folders : folders;
    outcome.changed = true;
  }

  if (!folders.some((f) => f.role === "inbox")) {
    await store.upsertFolder({ path: "INBOX", role: "inbox" });
    const reloaded = await store.getAccountState();
    folders = reloaded ? reloaded.folders : folders;
  }

  const ordered = [...folders].sort((a, b) =>
    a.role === "inbox" ? -1 : b.role === "inbox" ? 1 : a.path.localeCompare(b.path),
  );

  // First pass: per-folder plan, collect new metas and vanished docs so
  // moves can be reconciled account-wide before any ingest.
  const vanished: {
    docId: string;
    folderId: string;
    uid: number;
    messageIdHeader: string;
  }[] = [];
  const newRefs: { folder: StoredFolder; meta: FetchedMeta }[] = [];
  const flagUpdates: ({ folderId: string; uid: number } & FlagBits)[] = [];
  const folderStates = new Map<string, FolderState>();
  const folderPatches = new Map<string, FolderPatch>();
  const resetFolders: { folder: StoredFolder; metas: FetchedMeta[] }[] = [];

  for (const folder of ordered) {
    const status = await imap.status(folder.path);
    if (!status) {
      deps.log(`status failed for ${folder.path}`);
      continue;
    }
    const fs = new FolderState(folder);
    fs.status = status;
    folderStates.set(folder._id, fs);
    const plan = planFolderSync(folder, status, caps, deps.now());

    if (plan.kind === "skip") continue;

    if (plan.kind === "uidvalidityReset") {
      const uids = await imap.searchUids(folder.path);
      const metas = await collectMeta(imap, folder.path, uids);
      resetFolders.push({ folder, metas });
      continue;
    }

    if (plan.kind === "initial") {
      const range = initialWindowRange(status.uidNext, plan.window);
      const uids = range ? seqRange(range[0], range[1]) : [];
      const metas = await collectMeta(imap, folder.path, uids);
      for (const meta of metas) newRefs.push({ folder, meta });
      fs.backfillDone = range ? range[0] === 1 : true;
      // The initial window fetches flags for every synced UID, which is a
      // full flag pass: stamp it so the next incremental sync does not
      // immediately redo one.
      fs.lastFlagsFullAt = deps.now();
      folderPatches.set(folder._id, fs.patch());
      outcome.changed = true;
      continue;
    }

    // incremental
    if (plan.fetchFromUid !== null) {
      const uids = await imap.searchUids(folder.path, {
        minUid: plan.fetchFromUid,
      });
      const metas = await collectMeta(imap, folder.path, uids);
      for (const meta of metas) newRefs.push({ folder, meta });
    }
    if (plan.detectVanished) {
      const serverUids = new Set(await imap.searchUids(folder.path));
      const storedUids = [...iter(fs.synced)];
      const vanishedUids = storedUids.filter((u) => !serverUids.has(u));
      if (vanishedUids.length > 0) {
        fs.removeSynced(vanishedUids);
        const docs = await store.messagesByUids(folder._id, vanishedUids);
        for (const d of docs) {
          vanished.push({
            docId: d._id,
            folderId: folder._id,
            uid: d.uid ?? 0,
            messageIdHeader: d.messageIdHeader,
          });
        }
        outcome.vanished += vanishedUids.length;
        outcome.changed = true;
      }
    }
    if (plan.flagMode !== "none") {
      const updates = await diffFolderFlags(
        imap,
        folder,
        fs,
        plan.flagMode === "condstore" ? plan.flagsSinceModseq : undefined,
      );
      flagUpdates.push(...updates.map((u) => ({ folderId: folder._id, ...u })));
      // Advance the stored STATUS fields (highestModseq in particular) so a
      // flag pass with no local diffs is not repeated on every later run.
      if (plan.flagMode === "full") fs.lastFlagsFullAt = deps.now();
      folderPatches.set(folder._id, fs.patch());
      if (updates.length > 0) {
        outcome.flagChanges += updates.length;
        outcome.changed = true;
      }
    }
    if (
      outcome.changed ||
      plan.fetchFromUid !== null ||
      (plan.detectVanished && !folderPatches.has(folder._id))
    ) {
      folderPatches.set(folder._id, fs.patch());
    }
  }

  // An external client may create folders between discovery runs (for
  // example moving mail to a new "Archive"). When messages vanished,
  // re-list the server so relocated mail is reconciled instead of deleted.
  if (vanished.length > 0) {
    const knownPaths = new Set(folders.map((f) => f.path));
    const takenRoles = new Set(folders.map((f) => f.role));
    const listed = await imap.listMailboxes();
    const extra = listed.filter((m) => {
      if (m.noSelect || knownPaths.has(m.path)) return false;
      const role = roleForMailbox(m);
      // Folders are keyed by role; a second mailbox for a taken role cannot
      // be represented without clobbering the existing row.
      return role !== null && !takenRoles.has(role);
    });
    for (const m of extra) {
      await store.upsertFolder({
        path: m.path,
        role: roleForMailbox(m)!,
        delimiter: m.delimiter,
      });
    }
    if (extra.length > 0) {
      const reloaded = await store.getAccountState();
      folders = reloaded ? reloaded.folders : folders;
      for (const folder of folders) {
        if (!extra.some((m) => m.path === folder.path)) continue;
        const status = await imap.status(folder.path);
        if (!status) continue;
        const fs = new FolderState(folder);
        fs.status = status;
        const plan = planFolderSync(folder, status, caps, deps.now());
        const range =
          plan.kind === "initial"
            ? initialWindowRange(status.uidNext, plan.window)
            : null;
        const uids = range ? seqRange(range[0], range[1]) : [];
        const metas = await collectMeta(imap, folder.path, uids);
        for (const meta of metas) newRefs.push({ folder, meta });
        fs.backfillDone = range ? range[0] === 1 : true;
        fs.lastFlagsFullAt = deps.now();
        folderStates.set(folder._id, fs);
        folderPatches.set(folder._id, fs.patch());
        outcome.changed = true;
      }
    }
  }

  // Reconcile moves: a vanished Message-ID reappearing elsewhere is a move.
  const msgIds = new Set<string>();
  for (const v of vanished) msgIds.add(v.messageIdHeader);
  for (const n of newRefs) msgIds.add(n.meta.messageIdHeader);
  const existingDocs = await store.messagesByMsgIds(
    deps.accountId,
    [...msgIds],
  );
  const existingByMsgId = new Map<string, ExistingMsg[]>();
  for (const d of existingDocs) {
    const list = existingByMsgId.get(d.messageIdHeader) ?? [];
    list.push({
      docId: d._id,
      folderId: d.folderId ?? "",
      folderRole: d.folderRole,
      uid: d.uid,
    });
    existingByMsgId.set(d.messageIdHeader, list);
  }

  const newMsgRefs: NewMsgRef[] = newRefs.map((n) => ({
    folderId: n.folder._id,
    folderRole: n.folder.role,
    uid: n.meta.uid,
    messageIdHeader: n.meta.messageIdHeader,
  }));
  const reconciled = reconcileMoves(vanished, newMsgRefs, existingByMsgId);

  if (reconciled.relocations.length > 0) {
    await store.relocateMessages(
      reconciled.relocations.map((r) => ({
        messageId: r.docId,
        folderId: r.folderId,
        folderRole: r.folderRole as FolderRole,
        uid: r.uid,
      })),
    );
    // Register the relocated UID in the target folder's syncedUids with the
    // flags captured from its fetched meta. Relocated metas never reach the
    // ingest loop, so without this the UID stays unsynced and ops cannot
    // resolve the message's remote location.
    const metaByKey = new Map<string, FetchedMeta>();
    for (const n of newRefs) metaByKey.set(`${n.folder._id}:${n.meta.uid}`, n.meta);
    for (const r of reconciled.relocations) {
      const meta = metaByKey.get(`${r.folderId}:${r.uid}`);
      const fs =
        folderStates.get(r.folderId) ??
        new FolderState(
          folders.find((f) => f._id === r.folderId)!,
        );
      if (meta) fs.addSynced(meta.uid, flagMask(meta.flags));
      folderStates.set(r.folderId, fs);
      folderPatches.set(r.folderId, fs.patch());
    }
    outcome.changed = true;
  }
  if (reconciled.deletions.length > 0) {
    await store.deleteMessages(reconciled.deletions);
    outcome.changed = true;
  }

  const relocatedKeys = new Set(
    reconciled.relocations.map((r) => `${r.folderId}:${r.uid}`),
  );
  const insertsByFolder = new Map<string, { folder: StoredFolder; meta: FetchedMeta }[]>();
  for (const n of newRefs) {
    if (relocatedKeys.has(`${n.folder._id}:${n.meta.uid}`)) continue;
    const list = insertsByFolder.get(n.folder._id) ?? [];
    list.push(n);
    insertsByFolder.set(n.folder._id, list);
  }

  const categories = await store.categories();
  const owner = { name: account.displayName, addresses: ownerAddresses };

  for (const [folderId, items] of insertsByFolder) {
    const folder = items[0].folder;
    const fs = folderStates.get(folderId);
    const args = await buildIngestArgs(
      deps,
      folder,
      items.map((i) => i.meta),
      owner,
      ownerAddresses,
      categories,
    );
    for (let i = 0; i < args.length; i += INGEST_BATCH) {
      const batch = args.slice(i, i + INGEST_BATCH);
      if (fs) {
        for (const m of batch) {
          if (m.uid !== undefined) {
            fs.addSynced(m.uid, flagMaskFromArgs(m));
          }
        }
      }
      await store.ingestBatch(
        folderId,
        folder.role,
        batch,
        fs ? fs.patch() : {},
      );
      outcome.newMessages += batch.length;
      outcome.changed = true;
    }
    if (fs) folderPatches.set(folderId, fs.patch());
  }

  for (const { folder, metas } of resetFolders) {
    const fs = folderStates.get(folder._id) ?? new FolderState(folder);
    await handleUidValidityReset(
      deps,
      folder,
      fs,
      metas,
      ownerAddresses,
      categories,
      outcome,
    );
    folderStates.set(folder._id, fs);
    folderPatches.set(folder._id, fs.patch());
    outcome.changed = true;
  }

  if (flagUpdates.length > 0) {
    await store.applyFlagChanges(flagUpdates);
  }
  for (const [folderId, patch] of folderPatches) {
    await store.patchFolderState(folderId, patch);
  }

  await syncRemoteDrafts(deps, ordered, ownerAddresses, outcome);

  const lastSync = account.lastSyncedAt ?? 0;
  if (outcome.changed || deps.now() - lastSync > 10 * 60 * 1000) {
    await store.updateAccount({
      lastSyncedAt: deps.now(),
      initialSyncDone: true,
    });
  }
  return outcome;
}

function seqRange(a: number, b: number): number[] {
  const out: number[] = [];
  for (let u = a; u <= b; u++) out.push(u);
  return out;
}

async function collectMeta(
  imap: ImapPort,
  path: string,
  uids: number[],
): Promise<FetchedMeta[]> {
  const out: FetchedMeta[] = [];
  if (uids.length === 0) return out;
  for await (const m of imap.fetchMeta(path, uids)) out.push(m);
  return out;
}

async function diffFolderFlags(
  imap: ImapPort,
  folder: StoredFolder,
  fs: FolderState,
  changedSince?: string,
): Promise<({ uid: number } & FlagBits)[]> {
  const updates: ({ uid: number } & FlagBits)[] = [];
  for await (const row of imap.fetchFlags(folder.path, { changedSince })) {
    const mask = flagMask(row.flags);
    if (fs.has(row.uid)) {
      if (fs.getMask(row.uid) === mask) continue;
      fs.setMask(row.uid, mask);
    } else {
      fs.addSynced(row.uid, mask);
    }
    updates.push({ uid: row.uid, ...row.flags });
  }
  return updates;
}

function flagMaskFromArgs(m: IngestMessageArg): number {
  return (m.seen ? 1 : 0) | (m.flagged ? 2 : 0) | (m.answered ? 4 : 0);
}

// Turns fetched metadata into ingest arguments: body text for the snippet,
// Jev/heuristic classification for inbound mail, and all message fields.
export async function buildIngestArgs(
  deps: EngineDeps,
  folder: { _id: string; path: string; role: FolderRole },
  metas: FetchedMeta[],
  owner: { name?: string; addresses: string[] },
  ownerAddresses: string[],
  categories: { id: string; name: string; description: string }[],
): Promise<IngestMessageArg[]> {
  const bodies = new Array<string>(metas.length).fill("");
  const queue = metas.map((m, i) => ({ m, i }));
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        bodies[item.i] = await fetchBodyText(deps, folder.path, item.m);
      }
    }),
  );

  const inboundIdx: number[] = [];
  metas.forEach((m, i) => {
    if (
      (folder.role === "inbox" || folder.role === "junk") &&
      !isOwner(m.from.email, ownerAddresses)
    ) {
      inboundIdx.push(i);
    }
  });

  const classifyResults = new Map<
    number,
    {
      inbox: "primary" | "other";
      categoryIds: string[];
      classifiedBy: "jev" | "heuristic";
      needsRetry: boolean;
    }
  >();
  if (inboundIdx.length > 0) {
    const toClassify = inboundIdx.slice(0, MAX_CLASSIFY_PER_RUN);
    const contexts = await deps.store.threadContexts(
      toClassify.map((i) => ({
        messageIdHeader: metas[i].messageIdHeader,
        inReplyTo: metas[i].inReplyTo,
        references: metas[i].references,
      })),
    );
    const work = toClassify.map((i, k) => ({ i, ctx: contexts[k] }));
    await Promise.all(
      Array.from(
        { length: Math.min(CLASSIFY_CONCURRENCY, work.length) },
        async () => {
          for (;;) {
            const item = work.shift();
            if (!item) return;
            classifyResults.set(
              item.i,
              await classifyOne(
                deps,
                metas[item.i],
                item.ctx,
                owner,
                categories,
                folder.role,
                bodies[item.i],
              ),
            );
          }
        },
      ),
    );
  }

  const out: IngestMessageArg[] = [];
  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    const outbound = isOwner(meta.from.email, ownerAddresses);
    const snippet = makeSnippet(bodies[i]);
    const classified = classifyResults.get(i);
    out.push({
      uid: meta.uid,
      messageIdHeader: meta.messageIdHeader,
      inReplyTo: meta.inReplyTo,
      references: meta.references,
      subject: meta.subject,
      from: meta.from,
      to: meta.to,
      cc: meta.cc,
      bcc: meta.bcc,
      replyTo: meta.replyTo,
      date: meta.date,
      snippet,
      seen: meta.flags.seen,
      flagged: meta.flags.flagged,
      answered: meta.flags.answered,
      isOutbound: outbound,
      hasAttachments: meta.hasAttachments,
      attachments: meta.attachments,
      size: meta.size,
      inbox: outbound ? undefined : (classified?.inbox ?? "primary"),
      categoryIds: classified?.categoryIds ?? [],
      classifiedBy: outbound
        ? undefined
        : (classified?.classifiedBy ?? "heuristic"),
      needsClassification: classified?.needsRetry ?? false,
      classificationCategories: classified?.needsRetry ? categories : undefined,
      classifyAttempts: classified?.needsRetry ? 1 : 0,
      bulk: meta.bulk,
      postDraftId: meta.postDraftId,
    });
  }
  return out;
}

async function fetchBodyText(
  deps: EngineDeps,
  path: string,
  meta: FetchedMeta,
): Promise<string> {
  try {
    if (meta.size <= FULL_SOURCE_MAX) {
      const src = await deps.imap.fetchSource(path, meta.uid);
      const parsed = await deps.parser.parse(src);
      return parsed.text ?? stripHtmlText(parsed.html ?? "");
    }
    if (meta.textPartId) {
      const part = await deps.imap.fetchPart(path, meta.uid, meta.textPartId);
      return await deps.parser.decodePart(
        part,
        "text/plain",
        meta.textPartEncoding,
      );
    }
  } catch {
    // Bodies are best-effort during sync; content is fetched lazily later.
  }
  return "";
}

function stripHtmlText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function classifyOne(
  deps: EngineDeps,
  meta: FetchedMeta,
  ctx: Awaited<ReturnType<StorePort["threadContexts"]>>[number],
  owner: { name?: string; addresses: string[] },
  categories: { id: string; name: string; description: string }[],
  folderRole: FolderRole,
  bodyText: string,
): Promise<{
  inbox: "primary" | "other";
  categoryIds: string[];
  classifiedBy: "jev" | "heuristic";
  needsRetry: boolean;
}> {
  const heuristic: HeuristicInput = {
    folderRole,
    from: meta.from,
    bulk: meta.bulk,
    headers: {
      listUnsubscribe: meta.headers.listUnsubscribe,
      listId: meta.headers.listId !== undefined,
      precedence: meta.headers.precedence,
      autoSubmitted: meta.headers.autoSubmitted,
    },
    isReplyToOwnerThread:
      ctx?.directReplyToOwner ?? ctx?.ownerParticipated ?? false,
  };
  if (!deps.classify) {
    return {
      inbox: heuristicClassify(heuristic),
      categoryIds: [],
      classifiedBy: "heuristic",
      needsRetry: true,
    };
  }
  const request: JevRequestInput = {
    owner,
    email: {
      from: meta.from,
      to: meta.to,
      cc: meta.cc,
      subject: meta.subject,
      date: meta.date,
      folder: folderRole,
      bodyExcerpt: bodyText.slice(0, 2000),
      attachments: meta.attachments.map((a) => a.filename),
      headers: {
        listUnsubscribe: meta.headers.listUnsubscribe,
        listId: meta.headers.listId,
        precedence: meta.headers.precedence,
        autoSubmitted: meta.headers.autoSubmitted,
      },
    },
    thread: ctx
      ? {
          ownerStarted: ctx.ownerStarted,
          ownerParticipated: ctx.ownerParticipated,
          directReplyToOwner: ctx.directReplyToOwner,
          messageCount: ctx.messageCount,
          previousMessages: ctx.previousMessages,
        }
      : undefined,
    categories,
  };
  const item: ClassifyItem = { request, heuristic };
  return await deps.classify(item);
}

async function handleUidValidityReset(
  deps: EngineDeps,
  folder: StoredFolder,
  fs: FolderState,
  metas: FetchedMeta[],
  ownerAddresses: string[],
  categories: { id: string; name: string; description: string }[],
  outcome: SyncOutcome,
) {
  const byMsgId = new Map<string, FetchedMeta>();
  for (const m of metas) byMsgId.set(m.messageIdHeader, m);

  const docs = await docsInFolder(deps, folder);
  const keep = new Set<string>();
  for (const d of docs) {
    if (!byMsgId.has(d.messageIdHeader)) {
      await deps.store.deleteMessages([d._id]);
      outcome.vanished++;
      continue;
    }
    keep.add(d.messageIdHeader);
    const meta = byMsgId.get(d.messageIdHeader)!;
    if (d.uid !== meta.uid) {
      await deps.store.relocateMessages([
        {
          messageId: d._id,
          folderId: folder._id,
          folderRole: folder.role,
          uid: meta.uid,
        },
      ]);
    }
  }

  fs.synced = [];
  fs.masks = new Map();

  const newMetas = metas.filter((m) => !keep.has(m.messageIdHeader));
  const owner = { addresses: ownerAddresses };
  const args = await buildIngestArgs(
    deps,
    folder,
    newMetas,
    owner,
    ownerAddresses,
    categories,
  );
  for (let i = 0; i < args.length; i += INGEST_BATCH) {
    const batch = args.slice(i, i + INGEST_BATCH);
    await deps.store.ingestBatch(folder._id, folder.role, batch, fs.patch());
    outcome.newMessages += batch.length;
  }
  for (const m of metas) {
    fs.addSynced(m.uid, flagMask(m.flags));
  }
}

async function docsInFolder(
  deps: EngineDeps,
  folder: StoredFolder,
): Promise<{ _id: string; uid?: number; messageIdHeader: string }[]> {
  const synced = parseUidSet(folder.syncedUids);
  const uids = [...iter(synced)];
  if (uids.length === 0) return [];
  return await deps.store.messagesByUids(folder._id, uids);
}

// Links server-side drafts to Convex drafts (matched on X-Post-Draft-Id),
// imports foreign server drafts, and drops drafts whose remote copy is gone.
async function syncRemoteDrafts(
  deps: EngineDeps,
  folders: StoredFolder[],
  _ownerAddresses: string[],
  outcome: SyncOutcome,
) {
  const draftsFolder = folders.find((f) => f.role === "drafts");
  if (!draftsFolder) return;
  const drafts = await deps.store.draftsForAccount();
  const syncedUids = parseUidSet(draftsFolder.syncedUids);
  const serverUidList = [...iter(syncedUids)];
  const docs = await deps.store.messagesByUids(draftsFolder._id, serverUidList);
  const serverByUid = new Map(docs.map((d) => [d.uid, d]));

  const byPostId = new Map(drafts.map((d) => [d.messageIdHeader, d]));
  let imported = 0;
  for (const d of docs) {
    if (d.uid === undefined) continue;
    if (d.postDraftId && byPostId.has(d.postDraftId)) {
      const draft = byPostId.get(d.postDraftId)!;
      if (
        !draft.remoteDirty &&
        (draft.remoteUid !== d.uid || draft.remoteFolderId !== draftsFolder._id)
      ) {
        await deps.store.linkRemoteDraft(draft._id, draftsFolder._id, d.uid);
      }
      continue;
    }
    if (d.postDraftId) continue; // foreign Post draft owned by another client
    if (imported >= MAX_REMOTE_DRAFT_IMPORTS) continue;
    imported++;
    outcome.changed = true;
    try {
      const src = await deps.imap.fetchSource(draftsFolder.path, d.uid);
      const parsed = await deps.parser.parse(src);
      await deps.store.importRemoteDraft({
        messageIdHeader: `import-${crypto.randomUUID()}`,
        subject: parsed.subject,
        to: parsed.to,
        cc: parsed.cc,
        bcc: parsed.bcc,
        html: parsed.html ?? "",
        text: parsed.text ?? "",
        remoteFolderId: draftsFolder._id,
        remoteUid: d.uid,
        attachments: (d.attachments ?? []).map((a) => ({
          kind: "forward" as const,
          messageId: d._id,
          attachmentId: a.id,
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
      });
    } catch {
      // A draft that fails to import is retried on the next sync.
    }
  }

  for (const draft of drafts) {
    if (
      draft.remoteFolderId !== draftsFolder._id ||
      draft.remoteUid === undefined
    ) {
      continue;
    }
    // A draft APPENDed concurrently (pushDraftNow does not take the sync
    // lease) can have remoteUid set before this folder's scan has seen it;
    // only treat it as gone once the uid is inside the synced window.
    if (
      !serverByUid.has(draft.remoteUid) &&
      !draft.remoteDirty &&
      draft.remoteUid < (draftsFolder.uidNext ?? 0)
    ) {
      await deps.store.deleteDraft(draft._id);
      outcome.changed = true;
    }
  }
}

// Executes due pendingOps over IMAP. Called by sync (under the same lease)
// and by the standalone ops sweeper action.
export async function runPendingOps(
  deps: EngineDeps,
  caps?: SyncCapabilities,
): Promise<number> {
  const caps_ = caps ?? (await deps.imap.capabilities());
  const ops = await deps.store.dueOps(deps.now());
  let done = 0;
  for (const op of ops) {
    try {
      await executeOp(deps, op, caps_);
      await deps.store.completeOp(op._id);
      done++;
    } catch (err) {
      const drop = op.attempts + 1 >= 8;
      const delay = Math.min(5000 * Math.pow(2, op.attempts), 30 * 60 * 1000);
      await deps.store.failOp(
        op._id,
        err instanceof Error ? err.message.slice(0, 200) : "operation failed",
        deps.now() + delay,
        drop,
      );
    }
  }
  return done;
}

async function executeOp(
  deps: EngineDeps,
  op: {
    _id: string;
    kind: "flags" | "move" | "expunge" | "appendDraft" | "deleteRemoteDraft";
    payload: PendingOpPayload;
  },
  caps: SyncCapabilities,
) {
  const { imap, store } = deps;

  const state = await store.getAccountState();
  // The doc's folder reflects the desired state the moment a move op is
  // enqueued (mutations patch it optimistically), so the true remote
  // location is resolved from the folders' syncedUids instead.
  const syncedByPath = new Map<string, Set<number>>();
  for (const f of state?.folders ?? []) {
    syncedByPath.set(f.path, new Set([...iter(parseUidSet(f.syncedUids))]));
  }
  const remotePathFor = (uid: number): string | undefined => {
    for (const [path, uids] of syncedByPath) {
      if (uids.has(uid)) return path;
    }
    return undefined;
  };
  // UIDs are per-mailbox: the same number can live in several syncedUids
  // sets. Prefer the folder the op was enqueued against while the uid is
  // still tracked there; only scan all folders (e.g. after an external
  // move) when the declared folder no longer holds it.
  const sourcePathFor = (declared: string | undefined, uid: number): string | undefined => {
    if (declared && syncedByPath.get(declared)?.has(uid)) return declared;
    return remotePathFor(uid) ?? declared;
  };

  if (op.kind === "flags") {
    const updates: {
      folderPath: string;
      uid: number;
      add: string[];
      remove: string[];
      messageId?: string;
    }[] = op.payload.updates ?? [];
    const resolved = await resolveOpTargets(store, updates);
    const groups = new Map<
      string,
      { path: string; uids: number[]; add: string[]; remove: string[] }
    >();
    for (let i = 0; i < updates.length; i++) {
      const r = resolved[i];
      const u = updates[i];
      if (!r) continue;
      const path = sourcePathFor(u.folderPath, r.uid);
      if (!path) continue;
      const key =
        path + "|" + JSON.stringify(u.add) + "|" + JSON.stringify(u.remove);
      const g = groups.get(key) ?? {
        path,
        uids: [] as number[],
        add: u.add,
        remove: u.remove,
      };
      g.uids.push(r.uid);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      await imap.storeFlags(g.path, g.uids, g.add, g.remove);
    }
    return;
  }

  if (op.kind === "move") {
    const moves: {
      folderPath: string;
      uid: number;
      targetRole: FolderRole;
      targetPath?: string;
      messageId?: string;
    }[] = op.payload.moves ?? [];
    const resolved = await resolveOpTargets(store, moves);
    for (let i = 0; i < moves.length; i++) {
      const mv = moves[i];
      const r = resolved[i];
      if (!r) continue;
      let targetPath = mv.targetPath;
      if (!targetPath) {
        const targetFolder = state?.folders.find((f) => f.role === mv.targetRole);
        targetPath = targetFolder?.path;
      }
      if (!targetPath) {
        targetPath = defaultPathForRole(mv.targetRole);
        await imap.createMailbox(targetPath);
        await store.upsertFolder({ path: targetPath, role: mv.targetRole });
      }
      const sourcePath = sourcePathFor(mv.folderPath, r.uid);
      if (
        sourcePath === undefined ||
        sourcePath === targetPath ||
        (syncedByPath.get(targetPath)?.has(r.uid) &&
          !syncedByPath.get(sourcePath)?.has(r.uid))
      ) {
        // The remote move already happened (or a retry); keep local state
        // consistent without issuing another MOVE.
        if (mv.messageId) {
          await applyMoveResult(
            store,
            state,
            mv,
            undefined,
            r,
            targetPath,
            undefined,
          );
        }
        continue;
      }
      const uidMap = await imap.moveOrCopy(
        sourcePath,
        [r.uid],
        targetPath,
        caps.move,
      );
      const newUid = uidMap.get(r.uid);
      if (mv.messageId) {
        await applyMoveResult(
          store,
          state,
          mv,
          sourcePath,
          r,
          targetPath,
          newUid,
        );
      }
    }
    return;
  }

  if (op.kind === "expunge") {
    const expunges: { folderPath: string; uid: number; messageId?: string }[] =
      op.payload.expunges ?? [];
    const resolved = await resolveOpTargets(store, expunges);
    const byPath = new Map<string, number[]>();
    for (let i = 0; i < expunges.length; i++) {
      const r = resolved[i];
      if (!r) continue;
      const path = sourcePathFor(expunges[i].folderPath, r.uid);
      if (!path) continue;
      const list = byPath.get(path) ?? [];
      list.push(r.uid);
      byPath.set(path, list);
    }
    for (const [path, uids] of byPath) {
      await imap.expunge(path, uids, caps.uidplus);
    }
    return;
  }

  if (op.kind === "appendDraft") {
    const draftId = op.payload.draftId;
    if (draftId && deps.pushDraftRemote) {
      await deps.pushDraftRemote(draftId);
    }
    return;
  }

  if (op.kind === "deleteRemoteDraft") {
    const { folderPath, uid } = op.payload;
    if (folderPath === undefined || uid === undefined) return;
    await imap.expunge(folderPath, [uid], caps.uidplus);
    return;
  }
}

function defaultPathForRole(role: FolderRole): string {
  switch (role) {
    case "inbox":
      return "INBOX";
    case "sent":
      return "Sent";
    case "drafts":
      return "Drafts";
    case "archive":
      return "Archive";
    case "trash":
      return "Trash";
    case "junk":
      return "Junk";
  }
}

interface OpItem {
  folderPath: string;
  uid: number;
  messageId?: string;
}

interface ResolvedTarget {
  path: string;
  uid: number;
  folderRole: string;
}

// Ops store the message doc id when available so a message that moved since
// the op was queued is applied at its current location.
async function resolveOpTargets(
  store: StorePort,
  items: OpItem[],
): Promise<(ResolvedTarget | null)[]> {
  const ids = items
    .map((i) => i.messageId)
    .filter((x): x is string => !!x);
  const refs = ids.length > 0 ? await store.opMessageRefs(ids) : {};
  return items.map((item) => {
    if (item.messageId) {
      const r = refs[item.messageId];
      if (!r || r.uid === undefined || !r.folderPath) return null;
      return { path: r.folderPath, uid: r.uid, folderRole: r.folderRole };
    }
    return { path: item.folderPath, uid: item.uid, folderRole: "" };
  });
}

// Applies a COPYUID/MOVE result in one mutation: the message doc moves to
// the target folder, and both folders' syncedUids/flags strings are updated
// so the next sync does not rediscover the change.
async function applyMoveResult(
  store: StorePort,
  state: { folders: StoredFolder[] } | null,
  mv: { targetRole: FolderRole; messageId?: string },
  sourcePath: string | undefined,
  r: ResolvedTarget,
  targetPath: string,
  newUid: number | undefined,
) {
  if (!mv.messageId) return;
  const target = state?.folders.find((f) => f.path === targetPath);
  if (!target) return;
  const source = sourcePath
    ? state?.folders.find((f) => f.path === sourcePath)
    : undefined;
  const folderPatches: { folderId: string; patch: FolderPatch }[] = [];

  let mask = 0;
  if (source) {
    const fs = new FolderState(source);
    mask = fs.getMask(r.uid);
    fs.removeSynced([r.uid]);
    folderPatches.push({ folderId: source._id, patch: fs.patch() });
  }
  if (newUid !== undefined) {
    const fs = new FolderState(target);
    fs.addSynced(newUid, mask);
    folderPatches.push({ folderId: target._id, patch: fs.patch() });
  }

  await store.applyMoveResults(
    [
      {
        messageId: mv.messageId,
        folderId: target._id,
        folderRole: mv.targetRole,
        uid: newUid ?? r.uid,
      },
    ],
    folderPatches,
  );
}
