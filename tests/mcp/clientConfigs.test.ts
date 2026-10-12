import { describe, it, expect } from "vitest";
import {
  claudeCodeCommand,
  claudeDesktopConfig,
  codexConfig,
  cursorConfig,
  vscodeConfig,
} from "../../lib/mcp/clientConfigs";

const URL = "https://kite.example.com/api/mcp";

describe("client config snippets", () => {
  it("claude code adds an http server with an auth header", () => {
    const cmd = claudeCodeCommand(URL);
    expect(cmd).toContain("--transport http");
    expect(cmd).toContain(URL);
    expect(cmd).toContain("Authorization: Bearer kite_sk_");
  });

  it("claude desktop bridges via mcp-remote", () => {
    const cfg = JSON.parse(claudeDesktopConfig(URL));
    const kite = cfg.mcpServers.kite;
    expect(kite.command).toBe("npx");
    expect(kite.args).toContain("mcp-remote");
    expect(kite.args).toContain(URL);
    expect(
      kite.args.some((a: string) => a.startsWith("Authorization: Bearer")),
    ).toBe(true);
  });

  it("cursor uses url + headers", () => {
    const cfg = JSON.parse(cursorConfig(URL));
    const kite = cfg.mcpServers.kite;
    expect(kite.url).toBe(URL);
    expect(kite.headers.Authorization).toContain("Bearer kite_sk_");
  });

  it("codex toml points at the url and an env var for the token", () => {
    const toml = codexConfig(URL);
    expect(toml).toContain("[mcp_servers.kite]");
    expect(toml).toContain(`url = "${URL}"`);
    expect(toml).toContain('bearer_token_env_var = "KITE_API_KEY"');
    const fields = toml
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n");
    expect(fields).not.toContain("kite_sk_");
  });

  it("vscode mcp.json uses http type and a prompted input for the key", () => {
    const cfg = JSON.parse(vscodeConfig(URL));
    expect(cfg.servers.kite.type).toBe("http");
    expect(cfg.servers.kite.url).toBe(URL);
    expect(cfg.servers.kite.headers.Authorization).toBe(
      "Bearer ${input:kite-api-key}",
    );
    const input = cfg.inputs.find((i: { id: string }) => i.id === "kite-api-key");
    expect(input?.type).toBe("promptString");
    expect(input?.password).toBe(true);
  });
});
