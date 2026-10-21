// A theme on disk: the folders Comerix knows, and .comerix/theme.json (which theme it is, and the fingerprint of each
// file as last pulled or pushed, so push sends only what changed).
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

export const THEME_DIRS = ["layout", "templates", "sections", "snippets", "assets", "config", "locales"];
export const TEXT_EXTENSIONS = new Set(["liquid", "json", "css", "js", "svg", "txt"]);
export const isText = (path) => TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
export const fingerprint = (bytes) => createHash("sha256").update(bytes).digest("hex");

const STATE = join(".comerix", "theme.json");

export async function readState(dir) {
  try {
    return JSON.parse(await readFile(join(dir, STATE), "utf8"));
  } catch {
    return { themeId: null, files: {} };
  }
}

export async function writeState(dir, state) {
  await mkdir(join(dir, ".comerix"), { recursive: true });
  await writeFile(join(dir, STATE), JSON.stringify(state, null, 2) + "\n");
}

// Every theme file under dir, as theme paths ("sections/hero.liquid"). Hidden files and anything outside the theme
// folders are left out.
export async function localFiles(dir) {
  const out = [];
  async function walk(folder) {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join("/"));
    }
  }
  for (const top of THEME_DIRS) await walk(join(dir, top));
  return out.sort();
}

export async function writeThemeFile(dir, path, bytes) {
  const full = join(dir, ...path.split("/"));
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

// Files that differ from the last pull/push (or every file with all = true).
export async function changedFiles(dir, state, all = false) {
  const changed = [];
  for (const path of await localFiles(dir)) {
    const bytes = await readFile(join(dir, ...path.split("/")));
    const sha = fingerprint(bytes);
    if (all || state.files?.[path] !== sha) changed.push({ path, bytes, sha });
  }
  return changed;
}

export async function isEmptyDir(dir) {
  try {
    if (!(await stat(dir)).isDirectory()) return false;
    return (await readdir(dir)).filter((name) => !name.startsWith(".")).length === 0;
  } catch {
    return true;
  }
}
