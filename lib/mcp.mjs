// The Comerix themes server (the same MCP server AI tools use): builder.comerix.in/mcp, a token from
// Builder → AI. Each call is one JSON-RPC "tools/call"; the answer's text is returned, or an error is thrown.
export const DEFAULT_ENDPOINT = "https://builder.comerix.in/mcp";

export class ComerixError extends Error {}

export function createClient({ token, endpoint = DEFAULT_ENDPOINT, fetchImpl = globalThis.fetch }) {
  if (!token) throw new ComerixError("Not signed in. Run: comerix login");
  let id = 0;
  async function call(name, args = {}) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
    });
    if (response.status === 401) throw new ComerixError("This token isn't valid any more. Create a new one in the Builder (AI) and run: comerix login");
    if (!response.ok) throw new ComerixError(`The Comerix server answered ${response.status}`);
    const body = await response.json();
    if (body.error) throw new ComerixError(body.error.message || "The Comerix server refused the request");
    const result = body.result || {};
    const text = (result.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (result.isError) throw new ComerixError(text || `${name} failed`);
    return text;
  }
  return {
    call,
    listThemes: async () => JSON.parse(await call("list_themes")),
    // "path<TAB>N bytes" lines.
    listFiles: async (themeId) =>
      (await call("list_files", { theme_id: themeId }))
        .split("\n")
        .map((line) => line.match(/^(.+)\t(\d+) bytes$/))
        .filter(Boolean)
        .map((match) => ({ path: match[1], size: Number(match[2]) })),
    readText: (themeId, path) => call("read_file", { theme_id: themeId, path }),
    readAsset: async (themeId, path) => Buffer.from(JSON.parse(await call("read_asset", { theme_id: themeId, path })).base64, "base64"),
    writeText: (themeId, path, content) => call("write_file", { theme_id: themeId, path, content }),
    writeAsset: (themeId, path, bytes) => call("write_asset", { theme_id: themeId, path, base64: Buffer.from(bytes).toString("base64") }),
    check: (themeId) => call("check_theme", { theme_id: themeId }),
    preview: (themeId, path) => call("preview_link", { theme_id: themeId, ...(path ? { path } : {}) }),
    createFromStarter: (name) => call("create_theme_from_starter", { name }),
  };
}
