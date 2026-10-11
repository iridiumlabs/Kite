import { ConvexHttpClient } from "convex/browser";
import pkg from "../../../package.json";
import { buildMcpHandler } from "../../../lib/mcp/http";
import { convexBackend } from "../../../lib/mcp/backend";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");

const convex = new ConvexHttpClient(CONVEX_URL);

const handler = buildMcpHandler({
  version: pkg.version,
  verifyApiKey: async (apiKey) => {
    const who = (await convex.query("apiKeys:whoami" as never, {
      apiKey,
    } as never)) as { userId: string; keyName: string } | null;
    return who;
  },
  backendFor: (apiKey) => convexBackend(apiKey, CONVEX_URL),
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
