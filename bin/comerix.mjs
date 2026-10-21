#!/usr/bin/env node
// The Comerix CLI: sign in to a store once, then pull, edit, check, preview and push its themes from a folder — by
// hand or from an AI agent. It talks to the same server AI tools use (builder.comerix.in/mcp).
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { ComerixError, createClient } from "../lib/mcp.mjs";
import { clearConfig, configPath, currentToken, endpoint, readConfig, saveConfig } from "../lib/config.mjs";
import * as theme from "../lib/theme.mjs";

const VERSION = "0.2.0";
const HELP = `Comerix CLI ${VERSION}

  comerix login [--token <token>]        Connect to a store (token: Builder → AI → Create token, "Read and edit")
  comerix logout                         Forget the saved token
  comerix theme list                     The store's themes and their ids
  comerix theme init [folder] [--name <name>] [--from <git url>]
                                         Start a theme: a copy of the Comerix Starter in the store, or a git repository
  comerix theme pull --theme <id> [--dir <folder>]
                                         Download a theme's files
  comerix theme push [--theme <id>] [--dir <folder>] [--all]
                                         Upload changed files (all with --all) to the theme's working copy
  comerix theme dev [--theme <id>] [--dir <folder>]
                                         Push every save while you work, with a preview link
  comerix theme check [--theme <id>]     Theme Check on the theme in the store
  comerix theme preview [--theme <id>] [--path /products]
                                         A link to see the unpublished theme

The folder remembers its theme (.comerix/theme.json), so --theme is only needed the first time.
COMERIX_TOKEN in the environment is used instead of the saved token (CI, AI agents).
Nothing goes live until the merchant presses Publish in the Builder.
Docs: https://www.comerix.in/developers/themes/
`;

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new ComerixError(`--${name} needs a value`);
  args.splice(index, 2);
  return value;
};
const has = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
};

async function client() {
  return createClient({ token: await currentToken(), endpoint: endpoint() });
}

async function login() {
  let token = flag("token");
  if (!token) {
    if (!process.stdin.isTTY) throw new ComerixError("Pass the token with --token, or set COMERIX_TOKEN.");
    process.stdout.write("Create a token in the Comerix Builder: AI → Create token (choose \"Read and edit\").\n");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    token = (await rl.question("Paste the token: ")).trim();
    rl.close();
  }
  if (!/^cxai_[A-Za-z0-9_-]{20,}$/.test(token)) throw new ComerixError("That doesn't look like a Comerix token (it starts with cxai_).");
  const themes = await createClient({ token, endpoint: endpoint() }).listThemes();
  await saveConfig({ ...(await readConfig()), token });
  process.stdout.write(`Signed in. ${themes.length} theme${themes.length === 1 ? "" : "s"} in this store. Saved to ${configPath()}\n`);
}

async function main() {
  const [command, sub] = args;
  if (!command || command === "--help" || command === "-h" || command === "help") return process.stdout.write(HELP);
  if (command === "--version" || command === "-v") return process.stdout.write(`${VERSION}\n`);
  if (command === "login") return login();
  if (command === "logout") {
    await clearConfig();
    return process.stdout.write("Signed out.\n");
  }
  if (command !== "theme" || !sub) {
    process.stdout.write(HELP);
    process.exitCode = 1;
    return;
  }
  args.splice(0, 2);
  const options = { theme: flag("theme"), dir: resolve(flag("dir") || "."), path: flag("path"), name: flag("name"), from: flag("from"), all: has("all") };
  if (sub === "init") options.dir = resolve(args[0] || options.dir);
  const api = await client();
  const run = { list: () => theme.list(api), pull: () => theme.pull(api, options), push: () => theme.push(api, options), check: () => theme.check(api, options), preview: () => theme.preview(api, options), init: () => theme.init(api, options), dev: () => theme.dev(api, options) }[sub];
  if (!run) throw new ComerixError(`Unknown command: comerix theme ${sub}. See: comerix --help`);
  await run();
}

main().catch((error) => {
  process.stderr.write(`comerix: ${error instanceof ComerixError ? error.message : error?.stack || error}\n`);
  process.exitCode = 1;
});
