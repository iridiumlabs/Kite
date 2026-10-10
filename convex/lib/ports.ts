import type { Address, FolderRole, InboxBucket } from "./types";
import type {
  JevCategoryInput,
  JevRequestInput,
  HeuristicInput,
} from "./classify";
import type { FolderStatus, SyncCapabilities } from "./syncPlan";

export interface ImapMailboxInfo {
  path: string;
  delimiter?: string;
  specialUse?: string;
  noSelect?: boolean;
}

export interface FlagBits {
  seen: boolean;
  flagged: boolean;
  answered: boolean;
}

export interface FetchedMeta {
  uid: number;
  flags: FlagBits;
  messageIdHeader: string;
  inReplyTo?: string;
  references: string[];
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date: number;
  size: number;
  bulk: boolean;
  headers: {
    listUnsubscribe: boolean;
    listId?: string;
    precedence?: string;
    autoSubmitted?: string;
  };
  postDraftId?: string;
  hasAttachments: boolean;
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    cid?: string;
    inline: boolean;
  }[];
  textPartId?: string;
  textPartEncoding?: string;
}

export interface ImapPort {
  capabilities(): Promise<SyncCapabilities>;
  listMailboxes(): Promise<ImapMailboxInfo[]>;
  status(path: string): Promise<FolderStatus | null>;
  searchUids(path: string, opts?: { minUid?: number; maxUid?: number }): Promise<number[]>;
  searchText(path: string, query: string): Promise<number[]>;
  fetchMeta(path: string, uids: number[]): AsyncIterable<FetchedMeta>;
  fetchFlags(
    path: string,
    opts: { changedSince?: string },
  ): AsyncIterable<{ uid: number; flags: FlagBits }>;
  fetchSource(path: string, uid: number): Promise<Uint8Array>;
  fetchPart(path: string, uid: number, partId: string): Promise<Uint8Array>;
  storeFlags(
    path: string,
    uids: number[],
    add: string[],
    remove: string[],
  ): Promise<void>;
  moveOrCopy(
    path: string,
    uids: number[],
    targetPath: string,
    canMove: boolean,
  ): Promise<Map<number, number>>;
  expunge(path: string, uids: number[], useUidPlus: boolean): Promise<void>;
  append(
    path: string,
    source: Uint8Array | string,
    flags: string[],
    date?: Date,
  ): Promise<{ uid?: number }>;
  createMailbox(path: string): Promise<void>;
  close(): Promise<void>;
}

export interface ParsedMail {
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date?: number;
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string[];
  text?: string;
  html?: string;
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    cid?: string;
    inline: boolean;
    content?: Uint8Array;
  }[];
  headers: Record<string, string>;
}

export interface ParserPort {
  parse(source: Uint8Array | string): Promise<ParsedMail>;
  decodePart(
    data: Uint8Array,
    contentType?: string,
    encoding?: string,
  ): Promise<string>;
}

export interface ClassifyResult {
  inbox: InboxBucket;
  categoryIds: string[];
  classifiedBy: "jev" | "heuristic";
  needsRetry: boolean;
}

export interface ClassifyItem {
  request: JevRequestInput;
  heuristic: HeuristicInput;
}

export type Classifier = (item: ClassifyItem) => Promise<ClassifyResult>;

export interface StoredFolder {
  _id: string;
  path: string;
  role: FolderRole;
  delimiter?: string;
  uidValidity?: number;
  uidNext?: number;
  highestModseq?: string;
  unseen?: number;
  messages?: number;
  syncedUids: string;
  flags: string;
  oldestUid?: number;
  backfillDone: boolean;
  lastFlagsFullAt?: number;
}

export interface StoredAccount {
  _id: string;
  userId: string;
  email: string;
  displayName: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  signatureHtml?: string;
  status: string;
  initialSyncDone: boolean;
  syncFailCount?: number;
  foldersDiscoveredAt?: number;
  lastSyncedAt?: number;
  capabilities?: SyncCapabilities;
}

export interface StoredMsgRef {
  _id: string;
  uid?: number;
  messageIdHeader: string;
  folderId: string | null;
  folderRole: string;
  threadId: string;
  postDraftId?: string;
  attachments?: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    cid?: string;
    inline: boolean;
  }[];
}

export interface FolderPatch {
  uidValidity?: number;
  uidNext?: number;
  highestModseq?: string;
  unseen?: number;
  messages?: number;
  syncedUids?: string;
  flags?: string;
  oldestUid?: number;
  backfillDone?: boolean;
  lastFlagsFullAt?: number;
}

export interface IngestMessageArg {
  uid?: number;
  messageIdHeader: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  isOutbound: boolean;
  hasAttachments: boolean;
  attachments?: FetchedMeta["attachments"];
  size?: number;
  inbox?: InboxBucket;
  categoryIds?: string[];
  classifiedBy?: "jev" | "heuristic" | "manual" | "inherited";
  needsClassification?: boolean;
  classifyAttempts?: number;
  bulk?: boolean;
  postDraftId?: string;
}

export interface FlagOpItem {
  folderPath: string;
  uid: number;
  add: string[];
  remove: string[];
  messageId?: string;
}

export interface MoveOpItem {
  folderPath: string;
  uid: number;
  targetRole: FolderRole;
  targetPath?: string;
  messageId?: string;
}

export interface ExpungeOpItem {
  folderPath: string;
  uid: number;
  messageId?: string;
}

export interface PendingOpPayload {
  updates?: FlagOpItem[];
  moves?: MoveOpItem[];
  expunges?: ExpungeOpItem[];
  draftId?: string;
  folderPath?: string;
  uid?: number;
}

export interface PendingOpDoc {
  _id: string;
  kind: "flags" | "move" | "expunge" | "appendDraft" | "deleteRemoteDraft";
  payload: PendingOpPayload;
  attempts: number;
}

export interface StorePort {
  getAccountState(): Promise<{
    account: StoredAccount;
    folders: StoredFolder[];
  } | null>;
  upsertFolder(f: {
    path: string;
    role: FolderRole;
    delimiter?: string;
    uidValidity?: number;
    uidNext?: number;
  }): Promise<string>;
  markDiscovery(at: number): Promise<void>;
  ingestBatch(
    folderId: string,
    folderRole: FolderRole,
    messages: IngestMessageArg[],
    folderPatch: FolderPatch,
  ): Promise<unknown>;
  patchFolderState(folderId: string, patch: FolderPatch): Promise<void>;
  messagesByUids(
    folderId: string,
    uids: number[],
  ): Promise<StoredMsgRef[]>;
  messagesByMsgIds(
    accountId: string,
    msgIds: string[],
  ): Promise<StoredMsgRef[]>;
  relocateMessages(
    moves: {
      messageId: string;
      folderId: string;
      folderRole: FolderRole;
      uid: number;
    }[],
  ): Promise<void>;
  deleteMessages(ids: string[]): Promise<void>;
  applyFlagChanges(
    updates: ({ folderId: string; uid: number } & FlagBits)[],
  ): Promise<void>;
  applyMoveResults(
    moves: {
      messageId: string;
      folderId: string;
      folderRole: FolderRole;
      uid: number;
    }[],
    folderPatches: { folderId: string; patch: FolderPatch }[],
  ): Promise<void>;
  updateAccount(patch: Record<string, unknown>): Promise<void>;
  dueOps(now: number): Promise<PendingOpDoc[]>;
  opMessageRefs(
    ids: string[],
  ): Promise<
    Record<
      string,
      {
        folderId: string | null;
        folderPath: string | null;
        uid?: number;
        folderRole: string;
      } | null
    >
  >;
  completeOp(opId: string): Promise<void>;
  failOp(opId: string, error: string, nextAttemptAt: number, drop: boolean): Promise<void>;
  threadContexts(
    items: {
      messageIdHeader?: string;
      inReplyTo?: string;
      references?: string[];
    }[],
  ): Promise<
    ({
      threadId: string;
      ownerStarted: boolean;
      ownerParticipated: boolean;
      directReplyToOwner: boolean;
      messageCount: number;
      previousMessages: { from: string; snippet: string }[];
      inboxManual: boolean;
      inbox: InboxBucket;
    } | null)[]
  >;
  categories(): Promise<JevCategoryInput[]>;
  draftsForAccount(): Promise<
    {
      _id: string;
      userId: string;
      messageIdHeader: string;
      remoteFolderId?: string;
      remoteUid?: number;
      remoteDirty: boolean;
      subject: string;
      to: Address[];
      cc: Address[];
      bcc: Address[];
      html: string;
      text: string;
    }[]
  >;
  linkRemoteDraft(
    draftId: string,
    folderId: string,
    uid: number,
  ): Promise<void>;
  importRemoteDraft(fields: {
    messageIdHeader: string;
    subject: string;
    to: Address[];
    cc: Address[];
    bcc: Address[];
    html: string;
    text: string;
    remoteFolderId: string;
    remoteUid: number;
    attachments: {
      kind: "forward";
      messageId: string;
      attachmentId: string;
      filename: string;
      contentType: string;
      size: number;
    }[];
  }): Promise<string>;
  deleteDraft(draftId: string): Promise<void>;
}
