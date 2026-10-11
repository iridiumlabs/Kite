// The seam between MCP tools and Convex. Every method forwards the caller's
// API key to the same public functions the UI uses; nothing here adds
// business logic beyond argument mapping.
import { ConvexHttpClient } from "convex/browser";
import type {
  AccountDoc,
  AddressIn,
  CategoryDoc,
  DraftDoc,
  MessageContent,
  MessageDoc,
  ThreadDoc,
} from "./format";

export interface ListThreadsArgs {
  view:
    | "primary"
    | "other"
    | "archive"
    | "trash"
    | "snoozed"
    | "starred"
    | "account"
    | "category";
  accountId?: string;
  categoryId?: string;
  filter?: { unread?: boolean; starred?: boolean; hasAttachments?: boolean };
  numItems: number;
  cursor: string | null;
}

export interface FindMessagesArgs {
  accountId?: string;
  view?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  subject?: string;
  unread?: boolean;
  starred?: boolean;
  hasAttachments?: boolean;
  after?: number;
  before?: number;
  cursor?: string;
  limit?: number;
}

export interface SendArgs {
  accountId: string;
  to: AddressIn[];
  cc?: AddressIn[];
  bcc?: AddressIn[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: (
    | { filename: string; contentType: string; contentBase64: string }
    | { messageId: string; attachmentId: string }
  )[];
  replyToMessageId?: string;
  mode?: string;
  idempotencyKey?: string;
  allowDuplicate?: boolean;
}

export interface ReplyArgs {
  messageId: string;
  replyAll?: boolean;
  text?: string;
  html?: string;
  includeQuote?: boolean;
  attachments?: SendArgs["attachments"];
  idempotencyKey?: string;
  allowDuplicate?: boolean;
  accountId?: string;
}

export interface ForwardArgs {
  messageId: string;
  to: AddressIn[];
  cc?: AddressIn[];
  bcc?: AddressIn[];
  text?: string;
  html?: string;
  includeAttachments?: boolean;
  attachments?: SendArgs["attachments"];
  idempotencyKey?: string;
  allowDuplicate?: boolean;
  accountId?: string;
}

export interface SendResult {
  messageId?: string;
  deduped: boolean;
  rejectedRecipients?: string[];
}

export interface ThreadTargets {
  threadIds?: string[];
  messageIds?: string[];
}

export interface PostBackend {
  listAccounts(): Promise<AccountDoc[]>;
  syncNow(accountId?: string): Promise<{ scheduled: number }>;
  loadOlder(
    accountId?: string,
    role?: string,
  ): Promise<{ scheduled: number }>;

  listThreads(
    args: ListThreadsArgs,
  ): Promise<{ items: ThreadDoc[]; nextCursor: string | null }>;
  searchIndex(args: {
    query: string;
    accountId?: string;
    role?: string;
    limit?: number;
  }): Promise<MessageDoc[]>;
  findMessages(
    args: FindMessagesArgs,
  ): Promise<{ items: MessageDoc[]; nextCursor: string | null }>;
  deepSearch(args: {
    query: string;
    accountId?: string;
    limit?: number;
  }): Promise<MessageDoc[]>;
  getThread(
    threadId: string,
  ): Promise<{ thread: ThreadDoc; messages: MessageDoc[] }>;
  getMessage(messageId: string): Promise<MessageDoc>;
  getMessageContent(messageId: string): Promise<MessageContent>;
  downloadAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{
    filename: string;
    contentType: string;
    size: number;
    data: ArrayBuffer;
  }>;
  counts(): Promise<Record<string, number>>;

  sendMessage(args: SendArgs): Promise<SendResult>;
  reply(args: ReplyArgs): Promise<SendResult>;
  forward(args: ForwardArgs): Promise<SendResult>;
  sendDraft(args: {
    draftId: string;
    idempotencyKey?: string;
    allowDuplicate?: boolean;
  }): Promise<SendResult>;

  listDrafts(args: {
    accountId?: string;
    numItems: number;
    cursor: string | null;
  }): Promise<{ items: DraftDoc[]; nextCursor: string | null }>;
  getDraft(draftId: string): Promise<DraftDoc | null>;
  createDraft(args: {
    accountId: string;
    to?: AddressIn[];
    cc?: AddressIn[];
    bcc?: AddressIn[];
    subject?: string;
    text?: string;
    html?: string;
    replyToMessageId?: string;
    mode?: string;
  }): Promise<string>;
  updateDraft(args: {
    draftId: string;
    accountId?: string;
    to?: AddressIn[];
    cc?: AddressIn[];
    bcc?: AddressIn[];
    subject?: string;
    text?: string;
    html?: string;
  }): Promise<void>;
  discardDraft(draftId: string): Promise<void>;
  scheduleDraft(draftId: string, at: number): Promise<void>;
  cancelScheduledDraft(draftId: string): Promise<void>;

  setRead(targets: ThreadTargets, read: boolean): Promise<void>;
  setStarred(targets: ThreadTargets, starred: boolean): Promise<void>;
  archive(targets: ThreadTargets): Promise<void>;
  trash(targets: ThreadTargets): Promise<void>;
  restore(targets: ThreadTargets): Promise<void>;
  moveToInbox(threadIds: string[], inbox: "primary" | "other"): Promise<void>;
  assignCategories(args: {
    threadIds: string[];
    add?: string[];
    remove?: string[];
  }): Promise<void>;
  snooze(threadIds: string[], until: number | null): Promise<void>;
  deleteForever(threadIds: string[]): Promise<void>;

  listCategories(): Promise<CategoryDoc[]>;
  createCategory(args: {
    name: string;
    description: string;
    color: string;
  }): Promise<string>;
  updateCategory(args: {
    categoryId: string;
    name?: string;
    description?: string;
    color?: string;
  }): Promise<void>;
  removeCategory(categoryId: string): Promise<void>;
}

// Convex's HTTP client takes a function path like "mail:listThreads"; the
// generated api object is not imported here so this module stays decoupled
// from convex/_generated.
type ConvexFn = (path: string, args: object) => Promise<unknown>;

export function convexBackend(apiKey: string, convexUrl: string): PostBackend {
  const client = new ConvexHttpClient(convexUrl);
  const query: ConvexFn = (p, a) =>
    client.query(p as never, { ...a, apiKey } as never);
  const mutation: ConvexFn = (p, a) =>
    client.mutation(p as never, { ...a, apiKey } as never);
  const action: ConvexFn = (p, a) =>
    client.action(p as never, { ...a, apiKey } as never);

  return {
    listAccounts: () => query("accounts:list", {}) as Promise<AccountDoc[]>,
    syncNow: (accountId) =>
      mutation("accounts:syncNow", { accountId }) as Promise<{
        scheduled: number;
      }>,
    loadOlder: (accountId, role) =>
      action("mail:loadOlder", { accountId, role }) as Promise<{
        scheduled: number;
      }>,

    listThreads: async (a) => {
      const res = (await query("mail:listThreads", {
        view: a.view,
        accountId: a.accountId,
        categoryId: a.categoryId,
        filter: a.filter,
        paginationOpts: { numItems: a.numItems, cursor: a.cursor },
      })) as { page: ThreadDoc[]; continueCursor: string; isDone: boolean };
      return {
        items: res.page,
        nextCursor: res.isDone ? null : res.continueCursor,
      };
    },
    searchIndex: (a) =>
      query("mail:search", a) as unknown as Promise<MessageDoc[]>,
    findMessages: async (a) => {
      const res = (await query("mail:findMessages", a)) as {
        items: MessageDoc[];
        continueCursor: string | null;
      };
      return { items: res.items, nextCursor: res.continueCursor };
    },
    deepSearch: (a) =>
      action("mail:deepSearch", a) as unknown as Promise<MessageDoc[]>,
    getThread: (threadId) =>
      query("mail:getThread", { threadId }) as Promise<{
        thread: ThreadDoc;
        messages: MessageDoc[];
      }>,
    getMessage: (messageId) =>
      query("mail:getMessage", { messageId }) as Promise<MessageDoc>,
    getMessageContent: (messageId) =>
      action("content:getMessageContent", { messageId }) as Promise<MessageContent>,
    downloadAttachment: (messageId, attachmentId) =>
      action("content:downloadAttachment", {
        messageId,
        attachmentId,
      }) as Promise<{
        filename: string;
        contentType: string;
        size: number;
        data: ArrayBuffer;
      }>,
    counts: () => query("mail:counts", {}) as Promise<Record<string, number>>,

    sendMessage: (a) =>
      action("send:sendMessage", a as never) as Promise<SendResult>,
    reply: (a) => action("send:reply", a as never) as Promise<SendResult>,
    forward: (a) => action("send:forward", a as never) as Promise<SendResult>,
    sendDraft: (a) => action("send:sendDraft", a as never) as Promise<SendResult>,

    listDrafts: async (a) => {
      const res = (await query("drafts:list", {
        accountId: a.accountId,
        paginationOpts: { numItems: a.numItems, cursor: a.cursor },
      })) as { page: DraftDoc[]; continueCursor: string; isDone: boolean };
      return {
        items: res.page,
        nextCursor: res.isDone ? null : res.continueCursor,
      };
    },
    getDraft: (draftId) =>
      query("drafts:get", { draftId }) as Promise<DraftDoc | null>,
    createDraft: (a) =>
      mutation("drafts:create", a as never) as Promise<string>,
    updateDraft: (a) => mutation("drafts:update", a as never) as Promise<void>,
    discardDraft: (draftId) =>
      mutation("drafts:discard", { draftId }) as Promise<void>,
    scheduleDraft: (draftId, at) =>
      mutation("drafts:scheduleSend", { draftId, at }) as Promise<void>,
    cancelScheduledDraft: draftId => mutation("drafts:cancelScheduledSend", { draftId }) as Promise<void>,

    setRead: (t, read) => mutation("mail:setRead", { ...t, read }) as Promise<void>,
    setStarred: (t, starred) =>
      mutation("mail:setStarred", { ...t, starred }) as Promise<void>,
    archive: (t) => mutation("mail:archive", t) as Promise<void>,
    trash: (t) => mutation("mail:trash", t) as Promise<void>,
    restore: (t) => mutation("mail:restore", t) as Promise<void>,
    moveToInbox: (threadIds, inbox) =>
      mutation("mail:moveToInbox", { threadIds, inbox }) as Promise<void>,
    assignCategories: (a) =>
      mutation("mail:assignCategories", a as never) as Promise<void>,
    snooze: (threadIds, until) =>
      mutation("mail:snooze", { threadIds, until }) as Promise<void>,
    deleteForever: (threadIds) =>
      mutation("mail:deleteForever", { threadIds }) as Promise<void>,

    listCategories: () =>
      query("categories:list", {}) as Promise<CategoryDoc[]>,
    createCategory: (a) =>
      mutation("categories:create", a) as Promise<string>,
    updateCategory: (a) =>
      mutation("categories:update", a as never) as Promise<void>,
    removeCategory: (categoryId) =>
      mutation("categories:remove", { categoryId }) as Promise<void>,
  };
}
