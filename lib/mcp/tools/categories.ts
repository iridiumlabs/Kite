// Category tools: list/create/update/delete plus assigning categories to
// threads. Categories are user-defined labels that overlap with the two
// inboxes.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { formatCategory } from "../format";
import { addTool, zIdList, zUpdated, type BackendFor } from "./common";

const zCategoryFull = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
});

export function registerCategoryTools(server: McpServer, getBackend: BackendFor) {
  addTool(
    server,
    getBackend,
    "list_categories",
    {
      title: "List categories",
      description:
        "Lists the user's custom categories with name, description, and color. Read only.",
      outputSchema: z.object({ items: z.array(zCategoryFull) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (_args, backend) => ({
      items: (await backend.listCategories()).map(formatCategory),
    }),
  );

  addTool(
    server,
    getBackend,
    "create_category",
    {
      title: "Create category",
      description:
        "Creates a custom category label. The description guides future classification of new mail; existing mail is not reclassified.",
      inputSchema: z.object({
        name: z.string().min(1),
        description: z
          .string()
          .describe("What belongs in this category; used to classify new mail"),
        color: z
          .string()
          .optional()
          .describe("Hex color like #0a84ff; defaults to a neutral gray"),
      }),
      outputSchema: z.object({ categoryId: z.string() }),
      annotations: {},
    },
    async (args, backend) => ({
      categoryId: await backend.createCategory({
        name: args.name,
        description: args.description,
        color: args.color ?? "#8e8e93",
      }),
    }),
  );

  addTool(
    server,
    getBackend,
    "update_category",
    {
      title: "Update category",
      description:
        "Renames a category or changes its description or color. Existing mail is never reclassified; the new description only affects new mail.",
      inputSchema: z.object({
        categoryId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        color: z.string().optional(),
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      annotations: { idempotentHint: true },
    },
    async (args, backend) => {
      await backend.updateCategory(args);
      return { ok: true };
    },
  );

  addTool(
    server,
    getBackend,
    "delete_category",
    {
      title: "Delete category",
      description:
        "Deletes a category label and removes it from every thread. Threads themselves are not touched. This cannot be undone.",
      inputSchema: z.object({ categoryId: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      await backend.removeCategory(args.categoryId);
      return { ok: true };
    },
  );

  addTool(
    server,
    getBackend,
    "assign_categories",
    {
      title: "Assign categories",
      description:
        "Adds and/or removes categories on threads; accepts up to 100 thread ids per call. Marking a thread manually keeps it out of automatic classification.",
      inputSchema: z.object({
        threadIds: zIdList("Thread ids"),
        add: zIdList("Category ids to add").optional(),
        remove: zIdList("Category ids to remove").optional(),
      }),
      outputSchema: zUpdated,
      annotations: { idempotentHint: true },
    },
    async (args, backend) => {
      if (!args.add?.length && !args.remove?.length) {
        throw new Error("Pass add and/or remove category ids");
      }
      await backend.assignCategories({
        threadIds: args.threadIds,
        add: args.add,
        remove: args.remove,
      });
      return { updated: args.threadIds.length, threadIds: args.threadIds };
    },
  );
}
