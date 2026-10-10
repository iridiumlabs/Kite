import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const address = v.object({
  name: v.optional(v.string()),
  email: v.string(),
});

const accountStatus = v.union(
  v.literal("connecting"),
  v.literal("syncing"),
  v.literal("ready"),
  v.literal("error"),
  v.literal("auth_error"),
);

const folderRole = v.union(
  v.literal("inbox"),
  v.literal("sent"),
  v.literal("drafts"),
  v.literal("archive"),
  v.literal("trash"),
  v.literal("junk"),
);

const messageFolderRole = v.union(
  v.literal("inbox"),
  v.literal("sent"),
  v.literal("drafts"),
  v.literal("archive"),
  v.literal("trash"),
  v.literal("junk"),
  v.literal("local"),
);

const inboxBucket = v.union(v.literal("primary"), v.literal("other"));

const threadLocation = v.union(
  v.literal("inbox"),
  v.literal("archive"),
  v.literal("trash"),
  v.literal("none"),
);

const listKey = v.union(
  v.literal("primary"),
  v.literal("other"),
  v.literal("archive"),
  v.literal("trash"),
  v.literal("snoozed"),
  v.literal("none"),
);

export default defineSchema({
  accounts: defineTable({
    userId: v.string(),
    email: v.string(),
    displayName: v.string(),
    imapHost: v.string(),
    imapPort: v.number(),
    imapSecure: v.boolean(),
    smtpHost: v.string(),
    smtpPort: v.number(),
    smtpSecure: v.boolean(),
    username: v.string(),
    status: accountStatus,
    lastError: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    nextSyncAfter: v.optional(v.number()),
    initialSyncDone: v.boolean(),
    signatureHtml: v.optional(v.string()),
    capabilities: v.optional(
      v.object({
        condstore: v.boolean(),
        qresync: v.boolean(),
        move: v.boolean(),
        uidplus: v.boolean(),
        specialUse: v.boolean(),
      }),
    ),
    sortOrder: v.number(),
    createdAt: v.number(),
  }).index("by_user", ["userId", "sortOrder"]),

  accountSecrets: defineTable({
    accountId: v.id("accounts"),
    userId: v.string(),
    payload: v.string(),
  }).index("by_account", ["accountId"]),

  folders: defineTable({
    userId: v.string(),
    accountId: v.id("accounts"),
    path: v.string(),
    role: folderRole,
    delimiter: v.optional(v.string()),
    uidValidity: v.optional(v.number()),
    uidNext: v.optional(v.number()),
    highestModseq: v.optional(v.string()),
    unseen: v.optional(v.number()),
    messages: v.optional(v.number()),
    syncedUids: v.string(),
    flags: v.string(),
    oldestUid: v.optional(v.number()),
    backfillDone: v.boolean(),
    lastFlagsFullAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_role", ["accountId", "role"]),

  threads: defineTable({
    userId: v.string(),
    accountId: v.id("accounts"),
    subject: v.string(),
    participants: v.array(address),
    messageCount: v.number(),
    unreadCount: v.number(),
    unread: v.boolean(),
    starred: v.boolean(),
    hasAttachments: v.boolean(),
    hasDraft: v.boolean(),
    hasSent: v.boolean(),
    snippet: v.string(),
    lastMessageAt: v.number(),
    location: threadLocation,
    inbox: inboxBucket,
    inboxManual: v.boolean(),
    categoryIds: v.array(v.id("categories")),
    snoozedUntil: v.optional(v.number()),
    listKey,
  })
    .index("by_user_list", ["userId", "listKey", "lastMessageAt"])
    .index("by_user_list_unread", [
      "userId",
      "listKey",
      "unread",
      "lastMessageAt",
    ])
    .index("by_account_list", ["accountId", "listKey", "lastMessageAt"])
    .index("by_account_location", ["accountId", "location", "lastMessageAt"])
    .index("by_user_starred", ["userId", "starred", "lastMessageAt"])
    .index("by_account", ["accountId"])
    .index("by_snoozed", ["snoozedUntil"]),

  messages: defineTable({
    userId: v.string(),
    accountId: v.id("accounts"),
    threadId: v.id("threads"),
    folderId: v.union(v.id("folders"), v.null()),
    folderRole: messageFolderRole,
    uid: v.optional(v.number()),
    messageIdHeader: v.string(),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
    subject: v.string(),
    from: address,
    to: v.array(address),
    cc: v.array(address),
    bcc: v.array(address),
    replyTo: v.array(address),
    date: v.number(),
    snippet: v.string(),
    seen: v.boolean(),
    flagged: v.boolean(),
    answered: v.boolean(),
    isOutbound: v.boolean(),
    hasAttachments: v.boolean(),
    attachments: v.array(
      v.object({
        id: v.string(),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
        cid: v.optional(v.string()),
        inline: v.boolean(),
      }),
    ),
    size: v.optional(v.number()),
    inbox: v.optional(inboxBucket),
    categoryIds: v.array(v.id("categories")),
    classifiedBy: v.optional(
      v.union(
        v.literal("jev"),
        v.literal("heuristic"),
        v.literal("manual"),
        v.literal("inherited"),
      ),
    ),
    needsClassification: v.boolean(),
    classifyAttempts: v.number(),
    bulk: v.boolean(),
    postDraftId: v.optional(v.string()),
    searchText: v.string(),
  })
    .index("by_thread", ["threadId", "date"])
    .index("by_folder_uid", ["folderId", "uid"])
    .index("by_account_msgid", ["accountId", "messageIdHeader"])
    .index("by_user_role_date", ["userId", "folderRole", "date"])
    .index("by_account_role_date", ["accountId", "folderRole", "date"])
    .index("by_needs_classification", ["needsClassification", "classifyAttempts"])
    .searchIndex("search", {
      searchField: "searchText",
      filterFields: ["userId", "accountId", "folderRole"],
    }),

  threadRefs: defineTable({
    accountId: v.id("accounts"),
    ref: v.string(),
    threadId: v.id("threads"),
  })
    .index("by_account_ref", ["accountId", "ref"])
    .index("by_thread", ["threadId"]),

  categories: defineTable({
    userId: v.string(),
    name: v.string(),
    description: v.string(),
    color: v.string(),
    sortOrder: v.number(),
    createdAt: v.number(),
  }).index("by_user", ["userId", "sortOrder"]),

  threadCategories: defineTable({
    userId: v.string(),
    categoryId: v.id("categories"),
    threadId: v.id("threads"),
    lastMessageAt: v.number(),
    inInbox: v.boolean(),
    unread: v.boolean(),
  })
    .index("by_category_inbox", ["categoryId", "inInbox", "lastMessageAt"])
    .index("by_thread", ["threadId"])
    .index("by_category", ["categoryId"]),

  counters: defineTable({
    userId: v.string(),
    key: v.string(),
    count: v.number(),
  }).index("by_user_key", ["userId", "key"]),

  drafts: defineTable({
    userId: v.string(),
    accountId: v.id("accounts"),
    threadId: v.optional(v.id("threads")),
    replyToMessageId: v.optional(v.id("messages")),
    mode: v.union(
      v.literal("new"),
      v.literal("reply"),
      v.literal("replyAll"),
      v.literal("forward"),
    ),
    to: v.array(address),
    cc: v.array(address),
    bcc: v.array(address),
    subject: v.string(),
    html: v.string(),
    text: v.string(),
    attachments: v.array(
      v.union(
        v.object({
          kind: v.literal("upload"),
          storageId: v.id("_storage"),
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
        }),
        v.object({
          kind: v.literal("forward"),
          messageId: v.id("messages"),
          attachmentId: v.string(),
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
        }),
      ),
    ),
    messageIdHeader: v.string(),
    scheduledAt: v.optional(v.number()),
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
    status: v.union(
      v.literal("editing"),
      v.literal("scheduled"),
      v.literal("sending"),
      v.literal("failed"),
    ),
    sendError: v.optional(v.string()),
    remoteFolderId: v.optional(v.id("folders")),
    remoteUid: v.optional(v.number()),
    remoteDirty: v.boolean(),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_account", ["accountId"]),

  pendingOps: defineTable({
    userId: v.string(),
    accountId: v.id("accounts"),
    kind: v.union(
      v.literal("flags"),
      v.literal("move"),
      v.literal("expunge"),
      v.literal("appendDraft"),
      v.literal("deleteRemoteDraft"),
    ),
    payload: v.any(),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_account_next", ["accountId", "nextAttemptAt"]),

  sendLog: defineTable({
    userId: v.string(),
    accountId: v.id("accounts"),
    idempotencyKey: v.optional(v.string()),
    contentHash: v.string(),
    status: v.union(
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    messageIdHeader: v.string(),
    messageId: v.optional(v.id("messages")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user_key", ["userId", "idempotencyKey"])
    .index("by_user_hash", ["userId", "contentHash", "createdAt"]),

  apiKeys: defineTable({
    userId: v.string(),
    name: v.string(),
    prefix: v.string(),
    hash: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_hash", ["hash"])
    .index("by_user", ["userId"]),

  userSettings: defineTable({
    userId: v.string(),
    theme: v.union(
      v.literal("system"),
      v.literal("light"),
      v.literal("dark"),
    ),
    loadRemoteImages: v.boolean(),
    undoSendSeconds: v.number(),
    defaultAccountId: v.optional(v.id("accounts")),
  }).index("by_user", ["userId"]),

  syncLocks: defineTable({
    accountId: v.id("accounts"),
    leaseUntil: v.number(),
    owner: v.string(),
  }).index("by_account", ["accountId"]),
});
