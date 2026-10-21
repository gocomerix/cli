// Where the CLI keeps its sign-in: ~/.config/comerix/config.json (only the user can read it), or COMERIX_TOKEN in
// the environment (CI, AI agents), which wins. The token is never printed.
import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const configPath = (home = homedir()) => join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "comerix", "config.json");

export async function readConfig(path = configPath()) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

export async function saveConfig(config, path = configPath()) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function clearConfig(path = configPath()) {
  await rm(path, { force: true });
}

export async function currentToken(env = process.env, path = configPath()) {
  if (env.COMERIX_TOKEN) return env.COMERIX_TOKEN.trim();
  return (await readConfig(path)).token || "";
}

export const endpoint = (env = process.env) => env.COMERIX_MCP_URL || undefined;
