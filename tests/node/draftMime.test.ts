// @vitest-environment node
import { expect, test } from "vitest";
import { buildDraftSource } from "../../convex/node/draftsOps";
import { MailParserPort } from "../../convex/node/mailParser";
import { structureToMeta } from "../../convex/node/imap";
import type { FetchMessageObject } from "imapflow";
import type { Doc } from "../../convex/_generated/dataModel";
import type { ActionCtx } from "../../convex/_generated/server";

test("reply draft serialization preserves imported threading headers", async () => {
  const draft = {
    to: [{ email: "to@x.com" }], cc: [], bcc: [], subject: "Re: Original", text: "My reply", html: "", attachments: [],
    messageIdHeader: "draft@x", inReplyTo: "parent@x", references: ["root@x", "parent@x"], mode: "reply",
  } as unknown as Doc<"drafts">;
  const source = await buildDraftSource({} as ActionCtx, draft, { email: "me@x.com", displayName: "Me" } as Doc<"accounts">);
  const parsed = await new MailParserPort().parse(source);
  expect(source.toString()).toMatch(/^X-Kite-Draft-Id: draft@x\r?$/im);
  expect(parsed.headers["x-kite-draft-id"]).toBe("draft@x");
  const meta = structureToMeta({
    uid: 1, envelope: { messageId: "<draft@x>" }, headers: Buffer.from(source),
  } as FetchMessageObject);
  expect(meta?.kiteDraftId).toBe("draft@x");
  expect(parsed).toMatchObject({ inReplyTo: "parent@x", references: ["root@x", "parent@x"] });
});

test("private remote draft serialization preserves Bcc recipients for re-import", async () => {
  const draft = { to: [{ email: "to@x.com" }], cc: [{ email: "cc@x.com" }], bcc: [{ name: "Blind", email: "blind@x.com" }], subject: "Private draft", text: "Body", html: "", attachments: [], messageIdHeader: "draft@x" } as unknown as Doc<"drafts">;
  const account = { email: "me@x.com", displayName: "Me" } as Doc<"accounts">;
  const source = await buildDraftSource({} as ActionCtx, draft, account);
  expect(source.toString()).toMatch(/^Bcc: Blind <blind@x.com>/m);
  expect((await new MailParserPort().parse(source)).bcc).toEqual(draft.bcc);
});
