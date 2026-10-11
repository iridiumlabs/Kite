import { api } from "../convex/_generated/api";
import { diagnosticMailbox, sleep, errorText } from "./diagnosticMailbox";
const { client, accountId, cleanup } = await diagnosticMailbox(false);
try {
  for (let round = 0; round < 12; round++) {
    await client.mutation(api.accounts.syncNow, { accountId });
    const rows = await client.query(api.mail.listThreads, { view: "account", accountId, paginationOpts: { numItems: 50, cursor: null } });
    const account = (await client.query(api.accounts.list, {})).find(a => a._id === accountId);
    console.log("round", round, "threads", rows.page.length, "status", account?.status, "error", account?.lastError);
    if (rows.page.length >= 3) {
      await Promise.allSettled(rows.page.slice(0, 4).map(async row => {
        const thread = await client.query(api.mail.getThread, { threadId: row._id });
        for (const message of thread.messages) {
          try { await client.action(api.content.getMessageContent, { messageId: message._id }); console.log("content ok", message._id); }
          catch (error) { console.log("content error", errorText(error)); }
        }
      }));
    }
    await sleep(3000);
  }
} finally { await cleanup(); }
