import { describe, it, expect } from "vitest";
import {
  claudeCodeCommand,
  claudeDesktopConfig,
  codexConfig,
  cursorConfig,
  vscodeConfig,
} from "../../lib/mcp/clientConfigs";

const URL = "https://post.example.com/api/mcp";

describe("client config snippets", () => {
  it("claude code adds an http server with an auth header", () => {
    const cmd = claudeCodeCommand(URL);
    expect(cmd).toContain("--transport http");
    expect(cmd).toContain(URL);
    expect(cmd).toContain("Authorization: Bearer post_sk_");
  });

  it("claude desktop bridges via mcp-remote", () => {
    const cfg = JSON.parse(claudeDesktopConfig(URL));
    const post = cfg.mcpServers.post;
    expect(post.command).toBe("npx");
    expect(post.args).toContain("mcp-remote");
    expect(post.args).toContain(URL);
    expect(
      post.args.some((a: string) => a.startsWith("Authorization: Bearer")),
    ).toBe(true);
  });

  it("cursor uses url + headers", () => {
    const cfg = JSON.parse(cursorConfig(URL));
    const post = cfg.mcpServers.post;
    expect(post.url).toBe(URL);
    expect(post.headers.Authorization).toContain("Bearer post_sk_");
  });

  it("codex toml points at the url and an env var for the token", () => {
    const toml = codexConfig(URL);
    expect(toml).toContain("[mcp_servers.post]");
    expect(toml).toContain(`url = "${URL}"`);
    expect(toml).toContain('bearer_token_env_var = "POST_API_KEY"');
    const fields = toml
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n");
    expect(fields).not.toContain("post_sk_");
  });

  it("vscode mcp.json uses http type and a prompted input for the key", () => {
    const cfg = JSON.parse(vscodeConfig(URL));
    expect(cfg.servers.post.type).toBe("http");
    expect(cfg.servers.post.url).toBe(URL);
    expect(cfg.servers.post.headers.Authorization).toBe(
      "Bearer ${input:post-api-key}",
    );
    const input = cfg.inputs.find((i: { id: string }) => i.id === "post-api-key");
    expect(input?.type).toBe("promptString");
    expect(input?.password).toBe(true);
  });
});
