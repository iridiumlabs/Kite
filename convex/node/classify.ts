"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  buildJevRequests,
  heuristicClassify,
  parseJevResponses,
  type JevRequestBody,
  type JevResponseBody,
} from "../lib/classify";
import { callJev } from "../lib/jev";
import type { Classifier, ClassifyItem } from "../lib/ports";
import { connectImap, FlowPort } from "./imap";
import { MailParserPort } from "./mailParser";
import { decryptCredentials } from "./crypto";

export const JEV_TIMEOUT_MS = 15_000;

function jevApiKey(): string | null {
  const key = process.env.EXPERIENTIAL_API_KEY;
  return key && key.length > 0 ? key : null;
}

// Runs the Jev pipeline for one classify item; heuristic fallback on any
// failure with needsRetry so the cron can try again later.
export function makeClassifier(): Classifier | null {
  const apiKey = jevApiKey();
  if (!apiKey) {
    return null;
  }
  const model = process.env.JEV_MODEL ?? "jev-latest";
  return async (item: ClassifyItem) => {
    try {
      const requests: JevRequestBody[] = buildJevRequests(item.request);
      const responses: JevResponseBody[] = [];
      for (const req of requests) {
        responses.push(
          await callJev<JevResponseBody>(
            req as unknown as Record<string, unknown>,
            { apiKey, model, timeoutMs: JEV_TIMEOUT_MS },
          ),
        );
      }
      const parsed = parseJevResponses(responses, item.request.categories, {
        folderRole: item.heuristic.folderRole,
      });
      return {
        inbox: parsed.inbox,
        categoryIds: parsed.categoryIds,
        classifiedBy: "jev" as const,
        needsRetry: false,
      };
    } catch {
      return {
        inbox: heuristicClassify(item.heuristic),
        categoryIds: [],
        classifiedBy: "heuristic" as const,
        needsRetry: true,
      };
    }
  };
}

let loggedMissingKey = false;

export function classifierOrNull(): Classifier | null {
  const c = makeClassifier();
  if (!c && !loggedMissingKey) {
    loggedMissingKey = true;
    console.log("EXPERIENTIAL_API_KEY not set; using heuristic classification");
  }
  return c;
}

// Retries Jev classification for messages that previously fell back to the
// heuristic. Called by the classification cron.
export const retryBatch = internalAction({
  args: {},
  handler: async (ctx) => {
    const classify = classifierOrNull();
    if (!classify) return { retried: 0 };
    const rows = await ctx.runQuery(internal.syncStore.needsClassification, {
      limit: 40,
    });
    if (rows.length === 0) return { retried: 0 };

    const byAccount = new Map<Id<"accounts">, typeof rows>();
    for (const r of rows) {
      const list = byAccount.get(r.accountId) ?? [];
      list.push(r);
      byAccount.set(r.accountId, list);
    }

    const parser = new MailParserPort();
    let retried = 0;
    for (const [accountId, items] of byAccount) {
      let imap: Awaited<ReturnType<typeof connectImap>> | undefined;
      try {
        const secret = await ctx.runQuery(internal.syncStore.getSecret, {
          accountId,
        });
        const state = await ctx.runQuery(internal.syncStore.getAccountSyncState, {
          accountId,
        });
        if (!secret || !state) throw new Error("Mailbox unavailable");
        const { username, password } = decryptCredentials(secret);
        imap = await connectImap({
          host: state.account.imapHost,
          port: state.account.imapPort,
          secure: state.account.imapSecure,
          username,
          password,
        });
        // Retry against the ingest-time category descriptions, not categories
        // added or edited since the message arrived.
        const port = new FlowPort(imap);
        const updates: {
          messageId: Id<"messages">;
          inbox: "primary" | "other";
          categoryIds: Id<"categories">[];
          classifiedBy: "jev" | "heuristic";
          needsClassification: boolean;
          classifyAttempts: number;
        }[] = [];

        for (const item of items.slice(0, 12)) {
          try {
            const src = await port.fetchSource(item.folderPath, item.uid);
            const parsed = await parser.parse(src);
            const ctxs = await ctx.runQuery(
              internal.syncStore.threadContexts,
              {
                accountId,
                items: [
                  {
                    messageIdHeader: parsed.messageIdHeader,
                    inReplyTo: parsed.inReplyTo,
                    references: parsed.references,
                  },
                ],
              },
            );
            const tc = ctxs[0];
            const folderRole = item.folderRole as "inbox" | "junk";
            const result = await classify({
              request: {
                owner: {
                  name: state.account.displayName,
                  addresses: [state.account.email],
                },
                email: {
                  from: parsed.from,
                  to: parsed.to,
                  cc: parsed.cc,
                  subject: parsed.subject,
                  date: parsed.date ?? Date.now(),
                  folder: folderRole,
                  bodyExcerpt: (parsed.text ?? "").slice(0, 2000),
                  attachments: parsed.attachments.map((a) => a.filename),
                  headers: {
                    listUnsubscribe: !!parsed.headers["list-unsubscribe"],
                    listId: parsed.headers["list-id"],
                    precedence: parsed.headers["precedence"],
                    autoSubmitted: parsed.headers["auto-submitted"],
                  },
                },
                thread: tc
                  ? {
                      ownerStarted: tc.ownerStarted,
                      ownerParticipated: tc.ownerParticipated,
                      directReplyToOwner: tc.directReplyToOwner,
                      messageCount: tc.messageCount,
                      previousMessages: tc.previousMessages,
                    }
                  : undefined,
                categories: item.classificationCategories,
              },
              heuristic: {
                folderRole,
                from: parsed.from,
                bulk:
                  !!parsed.headers["list-unsubscribe"] ||
                  !!parsed.headers["list-id"],
                headers: {
                  listUnsubscribe: !!parsed.headers["list-unsubscribe"],
                  listId: parsed.headers["list-id"] !== undefined,
                  precedence: parsed.headers["precedence"],
                  autoSubmitted: parsed.headers["auto-submitted"],
                },
                isReplyToOwnerThread: tc?.directReplyToOwner ?? false,
              },
            });
            updates.push({
              messageId: item._id,
              inbox: result.inbox,
              categoryIds: result.categoryIds as Id<"categories">[],
              classifiedBy: result.classifiedBy,
              needsClassification: result.needsRetry,
              classifyAttempts: item.classifyAttempts + 1,
            });
            retried++;
          } catch {
            updates.push({
              messageId: item._id,
              inbox: "primary",
              categoryIds: [],
              classifiedBy: "heuristic",
              needsClassification: true,
              classifyAttempts: item.classifyAttempts + 1,
            });
          }
        }
        if (updates.length > 0) {
          await ctx.runMutation(internal.syncStore.applyClassification, {
            updates,
          });
        }
      } catch {
        // Advance the entire failed account group so it cannot monopolize the
        // globally bounded retry queue. Preserve the existing classification.
        await ctx.runMutation(internal.syncStore.applyClassification, {
          updates: items.map(item => ({
            messageId: item._id, categoryIds: [], classifiedBy: "heuristic" as const,
            needsClassification: true, classifyAttempts: item.classifyAttempts + 1,
          })),
        });
      } finally {
        if (imap) await imap.logout().catch(() => imap!.close());
      }
    }
    return { retried };
  },
});
