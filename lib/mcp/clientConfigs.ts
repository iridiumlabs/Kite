// Client configuration snippets for connecting popular MCP clients to the
// Kite endpoint. Each function takes the server URL (e.g.
// https://kite.example.com/api/mcp) and returns a ready-to-paste snippet.
// Formats mirror what each client's docs expect today.

export function claudeCodeCommand(url: string): string {
  return `claude mcp add --transport http kite ${url} --header "Authorization: Bearer kite_sk_YOUR_KEY"`;
}

// Claude Desktop talks stdio only; mcp-remote bridges to the HTTP endpoint.
export function claudeDesktopConfig(url: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        kite: {
          command: "npx",
          args: [
            "mcp-remote",
            url,
            "--header",
            "Authorization: Bearer kite_sk_YOUR_KEY",
          ],
        },
      },
    },
    null,
    2,
  );
}

export function cursorConfig(url: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        kite: {
          url,
          headers: { Authorization: "Bearer kite_sk_YOUR_KEY" },
        },
      },
    },
    null,
    2,
  );
}

// Codex reads config.toml. The key lives in an env var, not the file.
export function codexConfig(url: string): string {
  return [
    "[mcp_servers.kite]",
    `url = "${url}"`,
    'bearer_token_env_var = "KITE_API_KEY"',
    "",
    "# then: export KITE_API_KEY=kite_sk_YOUR_KEY",
  ].join("\n");
}

// VS Code .vscode/mcp.json with a promptString input so the key stays out of
// the committed file.
export function vscodeConfig(url: string): string {
  return JSON.stringify(
    {
      servers: {
        kite: {
          type: "http",
          url,
          headers: { Authorization: "Bearer ${input:kite-api-key}" },
        },
      },
      inputs: [
        {
          type: "promptString",
          id: "kite-api-key",
          description: "Kite API key (kite_sk_...)",
          password: true,
        },
      ],
    },
    null,
    2,
  );
}
