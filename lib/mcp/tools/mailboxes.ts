// Mailbox-level tools: accounts, sync, backfill, unread counters.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { formatAccount } from "../format";
import { addTool, type BackendFor } from "./common";

const zAccountOut = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  status: z.string(),
  lastError: z.string().optional(),
  lastSyncedAt: z.string().optional(),
  initialSyncDone: z.boolean(),
});

export function registerMailboxTools(server: McpServer, getBackend: BackendFor) {
  addTool(
    server,
    getBackend,
    "list_accounts",
    {
      title: "List mailboxes",
      description:
        "Lists every connected mailbox with its email, display name, sync status, and last error. Read only.",
      outputSchema: z.object({ items: z.array(zAccountOut) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (_args, backend) => ({
      items: (await backend.listAccounts()).map(formatAccount),
    }),
  );

  addTool(
    server,
    getBackend,
    "sync_mailboxes",
    {
      title: "Sync mailboxes",
      description:
        "Requests an immediate IMAP sync for one account or all accounts. Returns right away; new mail shows up in list_threads and search_emails within about a minute.",
      inputSchema: z.object({
        accountId: z
          .string()
          .optional()
          .describe("Account id from list_accounts; omit to sync all"),
      }),
      outputSchema: z.object({ scheduled: z.number() }),
      annotations: { idempotentHint: true },
    },
    async (args, backend) => backend.syncNow(args.accountId),
  );

  addTool(
    server,
    getBackend,
    "load_older_emails",
    {
      title: "Load older emails",
      description:
        "Backfills the next batch of older mail from the server for one account or all accounts. Only the most recent window is synced by default; call again to page further back. Returns right away.",
      inputSchema: z.object({
        accountId: z.string().optional(),
        folder: z
          .enum(["inbox", "sent", "drafts", "archive", "trash", "junk"])
          .optional()
          .describe("Folder to backfill; omit for every folder"),
      }),
      outputSchema: z.object({ scheduled: z.number() }),
      annotations: { idempotentHint: true },
    },
    async (args, backend) => backend.loadOlder(args.accountId, args.folder),
  );

  addTool(
    server,
    getBackend,
    "get_unread_counts",
    {
      title: "Unread counts",
      description:
        "Unread thread counts for the primary and other inboxes, per account, per category, plus the open drafts count. Read only.",
      outputSchema: z.object({
        primary: z.number(),
        other: z.number(),
        byAccount: z.array(
          z.object({
            accountId: z.string(),
            email: z.string(),
            unread: z.number(),
          }),
        ),
        byCategory: z.array(
          z.object({
            categoryId: z.string(),
            name: z.string(),
            unread: z.number(),
          }),
        ),
        drafts: z.number(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (_args, backend) => {
      const [counts, accounts, categories] = await Promise.all([
        backend.counts(),
        backend.listAccounts(),
        backend.listCategories(),
      ]);
      const acctEmail = new Map(accounts.map((a) => [a._id, a.email]));
      const catName = new Map(categories.map((c) => [c._id, c.name]));
      const byAccount: { accountId: string; email: string; unread: number }[] = [];
      const byCategory: { categoryId: string; name: string; unread: number }[] = [];
      for (const [key, count] of Object.entries(counts)) {
        if (key.startsWith("unread:acct:")) {
          const accountId = key.slice("unread:acct:".length);
          byAccount.push({
            accountId,
            email: acctEmail.get(accountId) ?? "",
            unread: count,
          });
        } else if (key.startsWith("unread:cat:")) {
          const categoryId = key.slice("unread:cat:".length);
          const name = catName.get(categoryId);
          if (name) byCategory.push({ categoryId, name, unread: count });
        }
      }
      return {
        primary: counts["unread:primary"] ?? 0,
        other: counts["unread:other"] ?? 0,
        byAccount,
        byCategory,
        drafts: counts["drafts"] ?? 0,
      };
    },
  );
}
