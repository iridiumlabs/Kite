"use node";

import { ImapFlow } from "imapflow";
import type {
  FetchMessageObject,
  ListResponse,
  MessageStructureObject,
} from "imapflow";
import type { Doc } from "../_generated/dataModel";
import type {
  FetchedMeta,
  FlagBits,
  ImapMailboxInfo,
  ImapPort,
} from "../lib/ports";
import type { FolderStatus, SyncCapabilities } from "../lib/syncPlan";
import type { Address } from "../lib/types";
import { normalizeMessageId, normalizeEmail } from "../lib/addresses";

export interface ImapAccountConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export async function connectImap(
  cfg: ImapAccountConfig,
): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    socketTimeout: 60_000,
    greetingTimeout: 15_000,
    disableAutoIdle: true,
  });
  // ImapFlow closes the connection and rejects pending commands on socket
  // failure. Consume its error event so it cannot crash the Node action.
  client.on("error", () => {});
  try {
    await client.connect();
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export function capabilitiesOf(client: ImapFlow): SyncCapabilities {
  const has = (name: string) => client.capabilities.has(name);
  return {
    condstore: has("CONDSTORE"),
    qresync: has("QRESYNC"),
    move: has("MOVE"),
    uidplus: has("UIDPLUS"),
    specialUse: has("SPECIAL-USE") || has("XLIST"),
  };
}

function hasFlag(flags: Set<string> | undefined, name: string): boolean {
  if (!flags) return false;
  const bare = name.replace(/^\\/, "").toLowerCase();
  for (const f of flags) {
    if (f.replace(/^\\/, "").toLowerCase() === bare) return true;
  }
  return false;
}

const META_HEADERS = [
  "references",
  "in-reply-to",
  "list-unsubscribe",
  "list-id",
  "precedence",
  "auto-submitted",
  "x-post-draft-id",
];

function parseHeaderBlock(raw: Buffer | string | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!raw) return out;
  const text = raw.toString();
  let key = "";
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && key) {
      const list = out.get(key)!;
      list[list.length - 1] += " " + line.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    key = line.slice(0, idx).trim().toLowerCase();
    const list = out.get(key) ?? [];
    list.push(line.slice(idx + 1).trim());
    out.set(key, list);
  }
  return out;
}

function addrs(list?: { name?: string; address?: string }[]): Address[] {
  return (list ?? [])
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || undefined, email: a.address! }));
}

function walkParts(
  node: MessageStructureObject | undefined,
  out: MessageStructureObject[] = [],
): MessageStructureObject[] {
  if (!node) return out;
  if (node.childNodes?.length) {
    for (const c of node.childNodes) walkParts(c, out);
  } else {
    out.push(node);
  }
  return out;
}

export function structureToMeta(m: FetchMessageObject): FetchedMeta | null {
  const env = m.envelope;
  const uid = m.uid;
  if (!uid || !env) return null;

  const headers = parseHeaderBlock(m.headers as Buffer | string | undefined);
  const get = (k: string) => headers.get(k)?.[0];

  const refsRaw = get("references") ?? "";
  const references = (refsRaw.match(/<[^>]+>/g) ?? [])
    .map((r) => normalizeMessageId(r))
    .filter(Boolean)
    .slice(-30);
  const inReplyToRaw = get("in-reply-to");
  const inReplyToMatch = inReplyToRaw?.match(/<[^>]+>/);

  const parts = walkParts(m.bodyStructure);
  const attachments = parts
    .filter((p) => {
      const filename =
        p.dispositionParameters?.filename ?? p.parameters?.name;
      if (p.disposition === "attachment") return true;
      return (
        !!filename &&
        p.type !== "text/plain" &&
        p.type !== "text/html" &&
        p.type !== "multipart"
      );
    })
    .map((p) => ({
      id: p.part ?? "1",
      filename:
        p.dispositionParameters?.filename ??
        p.parameters?.name ??
        "attachment",
      contentType: p.type || "application/octet-stream",
      size: p.size ?? 0,
      cid: p.id ? p.id.replace(/[<>]/g, "") : undefined,
      inline: p.disposition === "inline",
    }))
    .slice(0, 25);

  const textPart = parts.find(
    (p) =>
      p.type === "text/plain" &&
      p.disposition !== "attachment" &&
      !p.dispositionParameters?.filename,
  );

  const listUnsub = !!get("list-unsubscribe");
  const listId = get("list-id");
  const precedence = get("precedence");
  const autoSubmitted = get("auto-submitted");
  const postDraftId = get("x-post-draft-id");

  const messageId = env.messageId
    ? normalizeMessageId(env.messageId)
    : "";
  const date =
    env.date instanceof Date
      ? env.date.getTime()
      : m.internalDate instanceof Date
        ? m.internalDate.getTime()
        : Date.parse(String(env.date ?? "")) || Date.now();

  return {
    uid,
    flags: {
      seen: hasFlag(m.flags, "\\Seen"),
      flagged: hasFlag(m.flags, "\\Flagged"),
      answered: hasFlag(m.flags, "\\Answered"),
    },
    messageIdHeader: messageId || `uid-${uid}-${date}`,
    inReplyTo: inReplyToMatch
      ? normalizeMessageId(inReplyToMatch[0])
      : undefined,
    references,
    subject: env.subject ?? "",
    from: addrs(env.from)[0] ?? { email: "" },
    to: addrs(env.to),
    cc: addrs(env.cc),
    bcc: addrs(env.bcc),
    replyTo: addrs(env.replyTo),
    date,
    size: m.size ?? 0,
    bulk:
      listUnsub ||
      !!listId ||
      /bulk|list|junk/i.test(precedence ?? "") ||
      (!!autoSubmitted && !/no/i.test(autoSubmitted)),
    headers: {
      listUnsubscribe: listUnsub,
      listId,
      precedence,
      autoSubmitted,
    },
    postDraftId: postDraftId?.trim() || undefined,
    hasAttachments: attachments.length > 0,
    attachments,
    textPartId: textPart?.part,
    textPartEncoding: textPart?.encoding,
  };
}

async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class FlowPort implements ImapPort {
  private caps?: SyncCapabilities;

  constructor(public client: ImapFlow) {}

  async capabilities(): Promise<SyncCapabilities> {
    this.caps ??= capabilitiesOf(this.client);
    return this.caps;
  }

  async listMailboxes(): Promise<ImapMailboxInfo[]> {
    const boxes: ListResponse[] = await this.client.list();
    return boxes.map((b) => ({
      path: b.path,
      delimiter: b.delimiter || undefined,
      specialUse: b.specialUse || undefined,
      noSelect: hasFlag(b.flags, "\\Noselect"),
    }));
  }

  async status(path: string): Promise<FolderStatus | null> {
    const st = await this.client.status(path, {
      uidValidity: true,
      uidNext: true,
      messages: true,
      unseen: true,
      highestModseq: true,
    });
    if (!st || st.uidValidity === undefined) return null;
    return {
      uidValidity: Number(st.uidValidity),
      uidNext: st.uidNext ?? 1,
      messages: st.messages ?? 0,
      unseen: st.unseen ?? 0,
      highestModseq:
        st.highestModseq !== undefined ? String(st.highestModseq) : undefined,
    };
  }

  private uidSetString(uids: number[]): string {
    const sorted = [...uids].sort((a, b) => a - b);
    const parts: string[] = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}:${sorted[j]}`);
      i = j + 1;
    }
    return parts.join(",");
  }

  async searchUids(
    path: string,
    opts?: { minUid?: number; maxUid?: number },
  ): Promise<number[]> {
    const lock = await this.client.getMailboxLock(path);
    try {
      const res = await this.client.search({ all: true }, { uid: true });
      const uids = (res || []) as number[];
      return uids.filter(
        (u) =>
          (opts?.minUid === undefined || u >= opts.minUid) &&
          (opts?.maxUid === undefined || u <= opts.maxUid),
      );
    } finally {
      lock.release();
    }
  }

  async searchText(path: string, query: string): Promise<number[]> {
    const lock = await this.client.getMailboxLock(path);
    try {
      const res = await this.client.search(
        {
          or: [
            { subject: query },
            { from: query },
            { to: query },
            { body: query },
          ],
        } as never,
        { uid: true },
      );
      return (res || []) as number[];
    } finally {
      lock.release();
    }
  }

  async *fetchMeta(
    path: string,
    uids: number[],
  ): AsyncIterable<FetchedMeta> {
    if (uids.length === 0) return;
    const lock = await this.client.getMailboxLock(path);
    try {
      const gen = this.client.fetch(
        this.uidSetString(uids),
        {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          size: true,
          bodyStructure: true,
          headers: META_HEADERS,
        },
        { uid: true },
      );
      for await (const m of gen) {
        const meta = structureToMeta(m);
        if (meta) yield meta;
      }
    } finally {
      lock.release();
    }
  }

  async *fetchFlags(
    path: string,
    opts: { changedSince?: string },
  ): AsyncIterable<{ uid: number; flags: FlagBits }> {
    const lock = await this.client.getMailboxLock(path);
    try {
      const gen = this.client.fetch(
        "1:*",
        { uid: true, flags: true },
        {
          uid: true,
          changedSince: opts.changedSince
            ? BigInt(opts.changedSince)
            : undefined,
        },
      );
      for await (const m of gen) {
        if (!m.uid) continue;
        yield {
          uid: m.uid,
          flags: {
            seen: hasFlag(m.flags, "\\Seen"),
            flagged: hasFlag(m.flags, "\\Flagged"),
            answered: hasFlag(m.flags, "\\Answered"),
          },
        };
      }
    } finally {
      lock.release();
    }
  }

  async fetchSource(path: string, uid: number): Promise<Uint8Array> {
    const lock = await this.client.getMailboxLock(path);
    try {
      const dl = await this.client.download(String(uid), undefined, {
        uid: true,
      });
      if (!dl.content) throw new Error("Message not found on server");
      return await collectStream(dl.content);
    } finally {
      lock.release();
    }
  }

  async fetchPart(
    path: string,
    uid: number,
    partId: string,
  ): Promise<Uint8Array> {
    const lock = await this.client.getMailboxLock(path);
    try {
      const dl = await this.client.download(String(uid), partId, {
        uid: true,
      });
      if (!dl.content) throw new Error("Message part not found on server");
      return await collectStream(dl.content);
    } finally {
      lock.release();
    }
  }

  async storeFlags(
    path: string,
    uids: number[],
    add: string[],
    remove: string[],
  ): Promise<void> {
    if (uids.length === 0) return;
    const range = this.uidSetString(uids);
    const lock = await this.client.getMailboxLock(path);
    try {
      if (add.length > 0) {
        await this.client.messageFlagsAdd(range, add, { uid: true });
      }
      if (remove.length > 0) {
        await this.client.messageFlagsRemove(range, remove, { uid: true });
      }
    } finally {
      lock.release();
    }
  }

  async moveOrCopy(
    path: string,
    uids: number[],
    targetPath: string,
    canMove: boolean,
  ): Promise<Map<number, number>> {
    const range = this.uidSetString(uids);
    const lock = await this.client.getMailboxLock(path);
    try {
      if (canMove) {
        const res = await this.client.messageMove(range, targetPath, {
          uid: true,
        });
        return res && res.uidMap ? res.uidMap : new Map();
      }
      const res = await this.client.messageCopy(range, targetPath, {
        uid: true,
      });
      await this.client.messageDelete(range, { uid: true });
      return res && res.uidMap ? res.uidMap : new Map();
    } finally {
      lock.release();
    }
  }

  async expunge(
    path: string,
    uids: number[],
    useUidPlus: boolean,
  ): Promise<void> {
    if (uids.length === 0) return;
    const lock = await this.client.getMailboxLock(path);
    try {
      const range = this.uidSetString(uids);
      if (!useUidPlus) {
        // Without UIDPLUS a plain EXPUNGE clears every \Deleted message in
        // the mailbox, so flag the targets explicitly first.
        await this.client.messageFlagsAdd(range, ["\\Deleted"], {
          uid: true,
        });
      }
      await this.client.messageDelete(range, { uid: true });
    } finally {
      lock.release();
    }
  }

  async append(
    path: string,
    source: Uint8Array | string,
    flags: string[],
    date?: Date,
  ): Promise<{ uid?: number }> {
    const res = await this.client.append(
      path,
      typeof source === "string" ? source : Buffer.from(source),
      flags,
      date,
    );
    return { uid: res ? res.uid : undefined };
  }

  async createMailbox(path: string): Promise<void> {
    try {
      await this.client.mailboxCreate(path);
    } catch {
      // Already exists or cannot be created; a later sync will surface it.
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }
}

export function accountToImapConfig(account: Doc<"accounts">): {
  host: string;
  port: number;
  secure: boolean;
  username: string;
} {
  return {
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    username: account.username,
  };
}

export { normalizeEmail };
