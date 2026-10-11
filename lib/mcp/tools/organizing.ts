// Organizing tools: read/star/archive/trash/restore/snooze/move/delete.
// All are bulk (threadIds and/or messageIds, 100 ids total max) and enqueue
// the matching change on the mail server asynchronously.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { PostBackend, ThreadTargets } from "../backend";
import {
  addTool,
  resolveThreadIds,
  zIdList,
  zTargets,
  zUpdated,
  type BackendFor,
} from "./common";

function bulkTool(
  server: McpServer,
  getBackend: BackendFor,
  name: string,
  spec: {
    title: string;
    description: string;
    annotations?: { destructiveHint?: boolean; idempotentHint?: boolean };
  },
  run: (backend: PostBackend, targets: ThreadTargets) => Promise<void>,
) {
  addTool(
    server,
    getBackend,
    name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: zTargets,
      outputSchema: zUpdated,
      annotations: { idempotentHint: true, ...spec.annotations },
    },
    async (args, backend) => {
      const threadIds = await resolveThreadIds(
        backend,
        args.threadIds,
        args.messageIds,
      );
      await run(backend, { threadIds: args.threadIds, messageIds: args.messageIds });
      return { updated: threadIds.length, threadIds };
    },
  );
}

export function registerOrganizingTools(server: McpServer, getBackend: BackendFor) {
  bulkTool(
    server,
    getBackend,
    "mark_read",
    {
      title: "Mark read",
      description:
        "Marks threads and/or messages read, locally and on the mail server. Accepts up to 100 ids total.",
    },
    (b, t) => b.setRead(t, true),
  );

  bulkTool(
    server,
    getBackend,
    "mark_unread",
    {
      title: "Mark unread",
      description:
        "Marks threads and/or messages unread, locally and on the mail server. Accepts up to 100 ids total.",
    },
    (b, t) => b.setRead(t, false),
  );

  bulkTool(
    server,
    getBackend,
    "star",
    {
      title: "Star",
      description:
        "Stars threads and/or messages, locally and on the mail server. Accepts up to 100 ids total.",
    },
    (b, t) => b.setStarred(t, true),
  );

  bulkTool(
    server,
    getBackend,
    "unstar",
    {
      title: "Unstar",
      description:
        "Removes the star from threads and/or messages, locally and on the mail server. Accepts up to 100 ids total.",
    },
    (b, t) => b.setStarred(t, false),
  );

  bulkTool(
    server,
    getBackend,
    "archive",
    {
      title: "Archive",
      description:
        "Archives threads and/or messages: leaves both inboxes and all category views but keeps classification. Accepts up to 100 ids total.",
    },
    (b, t) => b.archive(t),
  );

  bulkTool(
    server,
    getBackend,
    "trash",
    {
      title: "Move to trash",
      description:
        "Moves inbox, junk, or archive threads and/or messages to trash on the server. Sent and drafts copies stay where they are. Accepts up to 100 ids total.",
    },
    (b, t) => b.trash(t),
  );

  bulkTool(
    server,
    getBackend,
    "restore",
    {
      title: "Restore from archive or trash",
      description:
        "Moves archived or trashed threads and/or messages back to the inbox, keeping their classification. Accepts up to 100 ids total.",
    },
    (b, t) => b.restore(t),
  );

  addTool(
    server,
    getBackend,
    "delete_permanently",
    {
      title: "Delete permanently",
      description:
        "Permanently deletes trashed threads: removes them locally and expunges them from the mail server. Only works on threads already in trash. This cannot be undone. Accepts up to 100 thread ids.",
      inputSchema: z.object({ threadIds: zIdList("Thread ids") }),
      outputSchema: zUpdated,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      await backend.deleteForever(args.threadIds);
      return { updated: args.threadIds.length, threadIds: args.threadIds };
    },
  );

  addTool(
    server,
    getBackend,
    "snooze",
    {
      title: "Snooze threads",
      description:
        "Hides inbox threads until the given ISO 8601 time, then they reappear. Pass until null to unsnooze. Accepts up to 100 thread ids.",
      inputSchema: z.object({
        threadIds: zIdList("Thread ids"),
        until: z
          .string()
          .nullable()
          .describe("ISO 8601 wake time, or null to unsnooze"),
      }),
      outputSchema: zUpdated,
      annotations: { idempotentHint: true },
    },
    async (args, backend) => {
      const at = args.until === null ? null : Date.parse(args.until);
      if (args.until !== null && Number.isNaN(at)) {
        throw new Error("until must be an ISO 8601 date or null");
      }
      await backend.snooze(args.threadIds, at);
      return { updated: args.threadIds.length, threadIds: args.threadIds };
    },
  );

  addTool(
    server,
    getBackend,
    "move_to_inbox",
    {
      title: "Move to inbox",
      description:
        "Files threads into the primary or other inbox, overriding classification (later mail in the thread stays manual). Junk copies move back to the inbox folder on the server. Accepts up to 100 thread ids.",
      inputSchema: z.object({
        threadIds: zIdList("Thread ids"),
        inbox: z.enum(["primary", "other"]),
      }),
      outputSchema: zUpdated,
      annotations: { idempotentHint: true },
    },
    async (args, backend) => {
      await backend.moveToInbox(args.threadIds, args.inbox);
      return { updated: args.threadIds.length, threadIds: args.threadIds };
    },
  );
}
