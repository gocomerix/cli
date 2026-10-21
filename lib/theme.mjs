// comerix theme …: work on a store's theme from a folder on your computer (or an AI agent's workspace). Files go to the
// theme's working copy; nothing reaches shoppers until the merchant presses Publish in the Builder.
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";
import { ComerixError } from "./mcp.mjs";
import { changedFiles, fingerprint, isEmptyDir, isText, localFiles, readState, writeState, writeThemeFile } from "./theme-files.mjs";

const say = (line = "") => process.stdout.write(`${line}\n`);

// Runs tasks a few at a time (the server is happiest with a handful of calls in flight).
async function pool(items, size, task) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

async function themeFor(dir, explicit) {
  if (explicit) return explicit;
  const state = await readState(dir);
  if (state.themeId) return state.themeId;
  throw new ComerixError("Which theme? Pass --theme <id> (see: comerix theme list), or pull one into this folder first.");
}

export async function list(client) {
  const themes = await client.listThemes();
  if (!themes.length) return say("No themes in this store yet.");
  for (const theme of themes) say(`${theme.id}  ${theme.live ? "LIVE " : "     "} ${theme.name}`);
}

export async function pull(client, { dir, theme }) {
  const themeId = await themeFor(dir, theme);
  const files = await client.listFiles(themeId);
  say(`Pulling ${files.length} files from ${themeId} into ${dir}`);
  const state = { themeId, files: {} };
  await pool(files, 6, async ({ path }) => {
    const bytes = isText(path) ? Buffer.from(await client.readText(themeId, path), "utf8") : await client.readAsset(themeId, path);
    await writeThemeFile(dir, path, bytes);
    state.files[path] = fingerprint(bytes);
  });
  await writeState(dir, state);
  say(`Done. Edit the files, then: comerix theme push`);
}

export async function push(client, { dir, theme, all = false }) {
  const themeId = await themeFor(dir, theme);
  const saved = await readState(dir);
  // Fingerprints belong to the theme they were pulled from; another theme gets every file.
  const state = saved.themeId === themeId ? saved : { themeId, files: {} };
  const changed = await changedFiles(dir, state, all);
  if (!changed.length) return say("Nothing changed since the last pull or push.");
  say(`Pushing ${changed.length} file${changed.length === 1 ? "" : "s"} to ${themeId}`);
  const failed = [];
  // Assets and snippets first, templates last, so a template never points at a section that isn't there yet.
  const order = (path) => (path.startsWith("assets/") ? 0 : path.startsWith("snippets/") ? 1 : path.startsWith("sections/") && path.endsWith(".liquid") ? 2 : path.startsWith("templates/") ? 4 : 3);
  changed.sort((a, b) => order(a.path) - order(b.path) || a.path.localeCompare(b.path));
  for (const file of changed) {
    try {
      if (isText(file.path)) await client.writeText(themeId, file.path, file.bytes.toString("utf8"));
      else await client.writeAsset(themeId, file.path, file.bytes);
      state.files = { ...(state.files || {}), [file.path]: file.sha };
      say(`  ✓ ${file.path}`);
    } catch (error) {
      failed.push(file.path);
      say(`  ✗ ${file.path}\n${String(error.message).split("\n").map((line) => `      ${line}`).join("\n")}`);
    }
  }
  await writeState(dir, { themeId, files: state.files || {} });
  if (failed.length) throw new ComerixError(`${failed.length} file${failed.length === 1 ? "" : "s"} not saved (see above).`);
  say("Saved to the theme's working files. The merchant publishes in the Builder.");
}

export async function check(client, { dir, theme }) {
  say(await client.check(await themeFor(dir, theme)));
}

export async function preview(client, { dir, theme, path }) {
  say(await client.preview(await themeFor(dir, theme), path));
}

// A new theme: a git repository (--from <url>, e.g. a base theme on GitHub) or a copy of the Comerix Starter made in
// the store and pulled into the folder.
export async function init(client, { dir, name, from }) {
  if (!(await isEmptyDir(dir))) throw new ComerixError(`${dir} isn't empty. Pick a new folder: comerix theme init <folder>`);
  if (from) {
    say(`Cloning ${from} into ${dir}`);
    await new Promise((done, fail) => {
      const git = spawn("git", ["clone", "--depth", "1", from, dir], { stdio: "inherit" });
      git.once("error", () => fail(new ComerixError("git isn't installed (needed for --from).")));
      git.once("exit", (code) => (code === 0 ? done() : fail(new ComerixError(`git clone failed (${code})`))));
    });
    if (!(await localFiles(dir)).includes("layout/theme.liquid")) throw new ComerixError(`${from} doesn't look like a Comerix theme (no layout/theme.liquid).`);
    say(`Next: cd ${dir} && comerix theme push --theme <id>   (a theme id from: comerix theme list)`);
    return;
  }
  const created = JSON.parse(await client.createFromStarter(name || "My theme"));
  say(`Created "${created.name}" (${created.id}) from the Comerix Starter — not published.`);
  await pull(client, { dir, theme: created.id });
}

// Push every save while you work; prints the preview link once.
export async function dev(client, { dir, theme }) {
  const themeId = await themeFor(dir, theme);
  await push(client, { dir, theme: themeId }).catch((error) => say(error.message));
  say(await client.preview(themeId).catch(() => ""));
  say("Watching for changes (Ctrl+C to stop)…");
  let timer = null;
  const pending = new Set();
  watch(resolve(dir), { recursive: true }, (_event, file) => {
    if (!file || file.split(/[\\/]/).some((part) => part.startsWith("."))) return;
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      pending.clear();
      await push(client, { dir, theme: themeId }).catch((error) => say(error.message));
    }, 300);
  });
  await new Promise(() => {});
}

