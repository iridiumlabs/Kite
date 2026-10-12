import { api } from "../convex/_generated/api";
import { diagnosticMailbox, sleep, errorText } from "./diagnosticMailbox";
const { client, accountId, cleanup } = await diagnosticMailbox(true);
try {
  let thread;
  for (let i = 0; i < 80; i++) {
    await client.mutation(api.accounts.syncNow, { accountId });
    const rows = await client.query(api.mail.listThreads, { view: "account", accountId, paginationOpts: { numItems: 50, cursor: null } });
    if (rows.page[0]) thread = await client.query(api.mail.getThread, { threadId: rows.page[0]._id });
    if (thread?.messages.length === 3) break;
    await sleep(2000);
  }
  if (!thread || thread.messages.length !== 3) throw new Error("Diagnostic thread not synced");
  const probe = async (messageId: typeof thread.messages[number]["_id"]) => {
    const start = Date.now();
    try {
      const content = await client.action(api.content.getMessageContent, { messageId });
      console.log("content", messageId, Date.now() - start, "ms", { text: typeof content.text, html: typeof content.html });
    } catch (error) { console.log("content error", errorText(error)); }
  };
  for (const message of thread.messages) await probe(message._id);
  const start = Date.now();
  await Promise.all(thread.messages.map(message => probe(message._id)));
  console.log("concurrent total", Date.now() - start, "ms");
  const account = (await client.query(api.accounts.list, {})).find(a => a._id === accountId);
  console.log("account status", account?.status, account?.lastError);
} finally { await cleanup(); }
