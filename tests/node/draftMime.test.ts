// @vitest-environment node
import { expect, test } from "vitest";
import { buildDraftSource } from "../../convex/node/draftsOps";
import { MailParserPort } from "../../convex/node/mailParser";
import type { Doc } from "../../convex/_generated/dataModel";
import type { ActionCtx } from "../../convex/_generated/server";

test("private remote draft serialization preserves Bcc recipients for re-import", async () => {
  const draft = { to: [{ email: "to@x.com" }], cc: [{ email: "cc@x.com" }], bcc: [{ name: "Blind", email: "blind@x.com" }], subject: "Private draft", text: "Body", html: "", attachments: [], messageIdHeader: "draft@x" } as unknown as Doc<"drafts">;
  const account = { email: "me@x.com", displayName: "Me" } as Doc<"accounts">;
  const source = await buildDraftSource({} as ActionCtx, draft, account);
  expect(source.toString()).toMatch(/^Bcc: Blind <blind@x.com>/m);
  expect((await new MailParserPort().parse(source)).bcc).toEqual(draft.bcc);
});
