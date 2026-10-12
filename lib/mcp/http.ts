// HTTP wiring for /api/mcp: bearer auth via a Kite API key, then the
// stateless Streamable HTTP MCP handler. Kept free of Next imports so the
// auth layer is unit testable with plain Request objects.
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import { registerKiteTools, SERVER_INSTRUCTIONS } from "./server";
import type { KiteBackend } from "./backend";

export const API_KEY_PREFIX = "kite_sk_";

export interface WhoamiResult {
  userId: string;
  keyName: string;
}

export type VerifyApiKey = (apiKey: string) => Promise<WhoamiResult | null>;

// Builds (req: Request) => Promise<Response>. verifyApiKey maps a raw
// kite_sk_ key to its owner or null; in production it is a whoami query
// against Convex.
export function buildMcpHandler(opts: {
  verifyApiKey: VerifyApiKey;
  backendFor: (apiKey: string) => KiteBackend;
  version: string;
}) {
  const handler = createMcpHandler(
    (server) => {
      registerKiteTools(server, (ctx: ServerContext) => {
        const apiKey = ctx.http?.authInfo?.extra?.apiKey;
        if (typeof apiKey !== "string" || !apiKey) {
          throw new Error("Missing API key");
        }
        return opts.backendFor(apiKey);
      });
    },
    {
      serverInfo: {
        name: "kite",
        title: "Kite Mail",
        version: opts.version,
      } as { name: string; version: string },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  const verifyToken = async (
    _req: Request,
    bearerToken?: string,
  ): Promise<AuthInfo | undefined> => {
    if (!bearerToken || !bearerToken.startsWith(API_KEY_PREFIX)) {
      return undefined;
    }
    const who = await opts.verifyApiKey(bearerToken);
    if (!who) return undefined;
    return {
      token: bearerToken,
      clientId: who.userId,
      scopes: [],
      extra: { apiKey: bearerToken, userId: who.userId, keyName: who.keyName },
    };
  };

  return withMcpAuth(handler, verifyToken, { required: true });
}
