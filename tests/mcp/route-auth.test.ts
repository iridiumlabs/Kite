// @vitest-environment node
// Route-level auth: missing, malformed, and unknown bearer tokens must 401
// with WWW-Authenticate; a verified key reaches the MCP protocol.
import { describe, it, expect } from "vitest";
import { buildMcpHandler } from "../../lib/mcp/http";

const URL = "http://localhost/api/mcp";

function handlerWith(verify: (key: string) => Promise<{ userId: string; keyName: string } | null>) {
  return buildMcpHandler({
    verifyApiKey: verify,
    backendFor: () => ({} as never),
    version: "0.1.0",
  });
}

describe("mcp route auth", () => {
  it("rejects a missing bearer token with 401 + WWW-Authenticate", async () => {
    const handler = handlerWith(async () => ({ userId: "u", keyName: "k" }));
    const res = await handler(
      new Request(URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "t", version: "1" },
          },
        }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("rejects a non-kite_sk bearer and an unknown key", async () => {
    const handler = handlerWith(async () => null);
    for (const tok of ["not-a-key", "kite_sk_unknown"]) {
      const res = await handler(
        new Request(URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${tok}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "t", version: "1" },
            },
          }),
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  it("accepts a verified kite_sk key and answers initialize", async () => {
    const seen: string[] = [];
    const handler = handlerWith(async (key) => {
      seen.push(key);
      return { userId: "u-live", keyName: "test" };
    });
    const res = await handler(
      new Request(URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer kite_sk_abc123",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "t", version: "1" },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual(["kite_sk_abc123"]);
    const body = await res.text();
    expect(body).toContain('"name":"kite"');
    expect(body).toContain('"title":"Kite Mail"');
  });
});
