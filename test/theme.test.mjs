import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "../lib/mcp.mjs";
import * as theme from "../lib/theme.mjs";

// A stand-in for builder.comerix.in/mcp: one store with themes held in memory, answering the tools the CLI uses.
function fakeServer() {
  const themes = { thm_a: { name: "Shop", files: { "layout/theme.liquid": Buffer.from("{{ content_for_header }}{{ content_for_layout }}"), "templates/index.json": Buffer.from('{"sections":{},"order":[]}'), "assets/logo.png": Buffer.from([137, 80, 78, 71, 1, 2]) } } };
  const calls = [];
  const answer = (id, text, isError = false) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) } }));
  const fetchImpl = async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer cxai_test");
    const { id, params } = JSON.parse(init.body);
    const { name, arguments: a } = params;
    calls.push(a.path ? `${name} ${a.path}` : name);
    const files = themes[a.theme_id]?.files;
    switch (name) {
      case "list_themes": return answer(id, JSON.stringify(Object.entries(themes).map(([tid, t]) => ({ id: tid, name: t.name, live: tid === "thm_a" }))));
      case "list_files": return answer(id, Object.entries(files).map(([p, b]) => `${p}\t${b.length} bytes`).join("\n"));
      case "read_file": return answer(id, files[a.path].toString("utf8"));
      case "read_asset": return answer(id, JSON.stringify({ path: a.path, base64: files[a.path].toString("base64"), size: files[a.path].length }));
      case "write_file":
        if (a.content.includes("{% broken")) return answer(id, "Not saved. Fix these first:\nsections/bad.liquid:1 Unclosed tag", true);
        files[a.path] = Buffer.from(a.content, "utf8");
        return answer(id, `Saved ${a.path}.`);
      case "write_asset": files[a.path] = Buffer.from(a.base64, "base64"); return answer(id, `Saved ${a.path}.`);
      case "create_theme_from_starter": themes.thm_new = { name: a.name, files: { "layout/theme.liquid": Buffer.from("starter") } }; return answer(id, JSON.stringify({ id: "thm_new", name: a.name, role: "unpublished" }));
      default: return answer(id, `unknown ${name}`, true);
    }
  };
  return { themes, calls, client: createClient({ token: "cxai_test", fetchImpl }) };
}
const quiet = async (fn) => {
  const write = process.stdout.write;
  let out = "";
  process.stdout.write = (chunk) => ((out += chunk), true);
  try { await fn(); } finally { process.stdout.write = write; }
  return out;
};

test("pull writes every file (text and binary) and remembers the theme", async () => {
  const server = fakeServer();
  const dir = await mkdtemp(join(tmpdir(), "comerix-"));
  await quiet(() => theme.pull(server.client, { dir, theme: "thm_a" }));
  assert.equal(await readFile(join(dir, "templates/index.json"), "utf8"), '{"sections":{},"order":[]}');
  assert.deepEqual([...(await readFile(join(dir, "assets/logo.png")))], [137, 80, 78, 71, 1, 2]);
  const state = JSON.parse(await readFile(join(dir, ".comerix/theme.json"), "utf8"));
  assert.equal(state.themeId, "thm_a");
  assert.equal(Object.keys(state.files).length, 3);
});

test("push sends only what changed, assets and sections before templates, and remembers it", async () => {
  const server = fakeServer();
  const dir = await mkdtemp(join(tmpdir(), "comerix-"));
  await quiet(() => theme.pull(server.client, { dir, theme: "thm_a" }));
  assert.match(await quiet(() => theme.push(server.client, { dir })), /Nothing changed/);
  await writeFile(join(dir, "templates/index.json"), '{"sections":{"h":{"type":"hero"}},"order":["h"]}');
  await mkdir(join(dir, "sections"), { recursive: true });
  await writeFile(join(dir, "sections/hero.liquid"), "<h1>Hi</h1>");
  await writeFile(join(dir, "assets/logo.png"), Buffer.from([1, 2, 3]));
  server.calls.length = 0;
  await quiet(() => theme.push(server.client, { dir }));
  assert.deepEqual(server.calls, ["write_asset assets/logo.png", "write_file sections/hero.liquid", "write_file templates/index.json"]);
  assert.equal(server.themes.thm_a.files["sections/hero.liquid"].toString(), "<h1>Hi</h1>");
  assert.match(await quiet(() => theme.push(server.client, { dir })), /Nothing changed/);
});

test("a file the server refuses is reported with its problems; the others are saved", async () => {
  const server = fakeServer();
  const dir = await mkdtemp(join(tmpdir(), "comerix-"));
  await quiet(() => theme.pull(server.client, { dir, theme: "thm_a" }));
  await mkdir(join(dir, "sections"), { recursive: true });
  await writeFile(join(dir, "sections/bad.liquid"), "{% broken");
  await writeFile(join(dir, "sections/good.liquid"), "ok");
  let out = "";
  await assert.rejects(async () => { out = await quiet(() => theme.push(server.client, { dir })); }, /1 file not saved/);
  assert.equal(server.themes.thm_a.files["sections/good.liquid"].toString(), "ok");
  // Fixed, it goes on the next push (the refused file was not marked as pushed).
  await writeFile(join(dir, "sections/bad.liquid"), "fixed");
  await quiet(() => theme.push(server.client, { dir }));
  assert.equal(server.themes.thm_a.files["sections/bad.liquid"].toString(), "fixed");
});

test("init makes a Starter copy in the store and pulls it into an empty folder", async () => {
  const server = fakeServer();
  const dir = join(await mkdtemp(join(tmpdir(), "comerix-")), "my-theme");
  await quiet(() => theme.init(server.client, { dir, name: "My theme" }));
  assert.equal(await readFile(join(dir, "layout/theme.liquid"), "utf8"), "starter");
  assert.equal(JSON.parse(await readFile(join(dir, ".comerix/theme.json"), "utf8")).themeId, "thm_new");
  await assert.rejects(() => theme.init(server.client, { dir, name: "Again" }), /isn't empty/);
});
