"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import nodemailer from "nodemailer";
import { connectImap, capabilitiesOf } from "./imap";
import { decryptCredentials, encryptCredentials } from "./crypto";
import { validateMailServer } from "../lib/mailServers";

export function smtpTransport(cfg: {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}) {
  const host = validateMailServer("smtp", cfg.host, cfg.port, cfg.secure);
  return nodemailer.createTransport({
    host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: { user: cfg.username, pass: cfg.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

export function mapConnectError(err: unknown): Error {
  const e = err as {
    authenticationFailed?: boolean;
    responseCode?: number;
    code?: string;
    message?: string;
  };
  const msg = String(e?.message ?? "");
  if (
    e?.authenticationFailed ||
    e?.responseCode === 535 ||
    /AUTHENTICATIONFAILED|invalid credentials|authentication failed|535/i.test(
      msg,
    )
  ) {
    return new Error("Authentication failed. Check the mailbox password.");
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|timed out/i.test(
      msg,
    ) ||
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH/.test(
      e?.code ?? "",
    )
  ) {
    return new Error("Could not reach the mail server.");
  }
  if (/certificate|TLS|SSL|EPROTO|self signed/i.test(msg)) {
    return new Error("Secure connection failed. Check the server TLS settings.");
  }
  return new Error(
    msg.length > 0 && msg.length < 200 ? msg : "Connection failed.",
  );
}

const connectArgs = {
  imapHost: v.string(),
  imapPort: v.number(),
  imapSecure: v.boolean(),
  smtpHost: v.string(),
  smtpPort: v.number(),
  smtpSecure: v.boolean(),
  username: v.string(),
  password: v.string(),
};

// Logs in over IMAP and verifies SMTP. Returns capabilities on success,
// throws a user-facing error otherwise.
export const testConnectionNow = internalAction({
  args: connectArgs,
  handler: async (_ctx, args) => {
    let caps;
    try {
      const client = await connectImap({
        host: args.imapHost,
        port: args.imapPort,
        secure: args.imapSecure,
        username: args.username,
        password: args.password,
      });
      caps = capabilitiesOf(client);
      await client.logout().catch(() => client.close());
    } catch (err) {
      throw mapConnectError(err);
    }
    try {
      const transport = smtpTransport({
        host: args.smtpHost,
        port: args.smtpPort,
        secure: args.smtpSecure,
        username: args.username,
        password: args.password,
      });
      await transport.verify();
      transport.close();
    } catch (err) {
      throw mapConnectError(err);
    }
    return { capabilities: caps };
  },
});

// Encrypts credentials for storage. Only node actions ever see plaintext.
export const encrypt = internalAction({
  args: { username: v.string(), password: v.string() },
  handler: async (_ctx, args) => {
    return { payload: encryptCredentials(args.username, args.password) };
  },
});

// Tests the saved credentials of an existing account.
export const testSavedConnection = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    capabilities: {
      condstore: boolean;
      qresync: boolean;
      move: boolean;
      uidplus: boolean;
      specialUse: boolean;
    };
  }> => {
    const account = await ctx.runQuery(internal.syncStore.getAccountDoc, {
      accountId: args.accountId,
    });
    const secret = await ctx.runQuery(internal.syncStore.getSecret, {
      accountId: args.accountId,
    });
    if (!account || !secret) throw new Error("Account not found.");
    const { username, password } = decryptCredentials(secret);
    return await ctx.runAction(internal.node.accountsOps.testConnectionNow, {
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      imapSecure: account.imapSecure,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
      smtpSecure: account.smtpSecure,
      username,
      password,
    });
  },
});
