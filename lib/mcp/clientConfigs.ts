// Client configuration snippets for connecting popular MCP clients to the
// Post endpoint. Each function takes the server URL (e.g.
// https://post.example.com/api/mcp) and returns a ready-to-paste snippet.
// Formats mirror what each client's docs expect today.

export function claudeCodeCommand(url: string): string {
  return `claude mcp add --transport http post ${url} --header "Authorization: Bearer post_sk_YOUR_KEY"`;
}

// Claude Desktop talks stdio only; mcp-remote bridges to the HTTP endpoint.
export function claudeDesktopConfig(url: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        post: {
          command: "npx",
          args: [
            "mcp-remote",
            url,
            "--header",
            "Authorization: Bearer post_sk_YOUR_KEY",
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
        post: {
          url,
          headers: { Authorization: "Bearer post_sk_YOUR_KEY" },
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
    "[mcp_servers.post]",
    `url = "${url}"`,
    'bearer_token_env_var = "POST_API_KEY"',
    "",
    "# then: export POST_API_KEY=post_sk_YOUR_KEY",
  ].join("\n");
}

// VS Code .vscode/mcp.json with a promptString input so the key stays out of
// the committed file.
export function vscodeConfig(url: string): string {
  return JSON.stringify(
    {
      servers: {
        post: {
          type: "http",
          url,
          headers: { Authorization: "Bearer ${input:post-api-key}" },
        },
      },
      inputs: [
        {
          type: "promptString",
          id: "post-api-key",
          description: "Post API key (post_sk_...)",
          password: true,
        },
      ],
    },
    null,
    2,
  );
}
