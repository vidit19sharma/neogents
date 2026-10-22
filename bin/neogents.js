#!/usr/bin/env node
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const templates = resolve(here, "..", "templates");
const packageName = "@vidit19sharma/neogents";
const usage = "Usage: neogents [setup|init|--help|-h]\n  setup  Configure the global OpenCode plugin.\n  init   Scaffold the second brain in the current project.";
const nextSteps = "Restart OpenCode, then run /neo:init in a project.";

export function mergeSetup(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("OpenCode config must be a JSON object.");
  }
  if (input.plugin !== undefined && (!Array.isArray(input.plugin) || input.plugin.some((p) => typeof p !== "string"))) {
    throw new TypeError("OpenCode plugin must be an array of strings.");
  }
  const cfg = { ...input };
  cfg.plugin = (input.plugin ?? []).map((p) => p === packageName || p.startsWith(`${packageName}@`) ? packageName : p);
  if (!cfg.plugin.includes(packageName)) cfg.plugin.push(packageName);
  if (cfg.default_agent == null) cfg.default_agent = "neo";
  return { cfg, changed: JSON.stringify(cfg) !== JSON.stringify(input) };
}

export function setup({ env = process.env, home = homedir(), log = console.log } = {}) {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, ".config");
  const folder = join(base, "opencode");
  const file = join(folder, "opencode.json");
  if (!existsSync(file) && existsSync(join(folder, "opencode.jsonc"))) {
    log("Add these entries to your existing opencode.jsonc (merge with existing entries):");
    log('"plugin": ["@vidit19sharma/neogents"]');
    log('"default_agent": "neo"');
    log(nextSteps);
    return 0;
  }
  const input = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const { cfg, changed } = mergeSetup(input);
  if (changed) {
    mkdirSync(folder, { recursive: true });
    const target = existsSync(file) ? realpathSync(file) : file;
    const tmp = `${target}.tmp.${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", existsSync(file) ? { mode: statSync(target).mode & 0o777 } : undefined);
      renameSync(tmp, target);
    } catch (e) { rmSync(tmp, { force: true }); throw e; }
    log(`Configured ${file}`);
  } else {
    log(`OpenCode already configured: ${file}`);
  }
  if (cfg.default_agent !== "neo") log(`Keeping your default_agent: ${JSON.stringify(cfg.default_agent)}.`);
  log(nextSteps);
  return 0;
}

export function init({ cwd = process.cwd(), log = console.log } = {}) {
  for (const path of [".neo", ".neo/brain"]) {
    const entry = lstatSync(join(cwd, path), { throwIfNoEntry: false });
    if (entry && !entry.isDirectory()) {
      log(`${path} must be a real directory (found ${entry.isSymbolicLink() ? "symlink" : "non-directory"}); refusing to initialize`);
      return 1;
    }
  }
  const ignore = join(cwd, ".neo/.gitignore");
  const ignoreEntry = lstatSync(ignore, { throwIfNoEntry: false });
  if (ignoreEntry && !ignoreEntry.isFile()) {
    log(".neo/.gitignore must be a regular file; refusing to initialize");
    return 1;
  }
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const entry = lstatSync(join(cwd, name), { throwIfNoEntry: false });
    if (entry && !entry.isFile()) {
      log(`${name} must be a regular file (found ${entry.isSymbolicLink() ? "symlink" : "non-file"}); refusing to initialize`);
      return 1;
    }
  }
  if (existsSync(join(cwd, ".neo/brain"))) {
    log("Brain already initialized; use /neo:status.");
    return 0;
  }
  try {
    mkdirSync(join(cwd, ".neo/brain"), { recursive: true });
    mkdirSync(join(cwd, ".neo/plans"), { recursive: true });
    log("Created .neo/plans/");
    for (const name of readdirSync(join(templates, "brain")).filter((name) => name.endsWith(".md")).sort()) {
      copyFileSync(join(templates, "brain", name), join(cwd, ".neo/brain", name));
      log(`Created .neo/brain/${name}`);
    }
    if (ignoreEntry) {
      const content = readFileSync(ignore, "utf8");
      if (!content.split(/\r?\n/).includes(".session")) {
        appendFileSync(ignore, `${content && !content.endsWith("\n") ? "\n" : ""}.session\n`);
        log("Updated .neo/.gitignore");
      }
    } else {
      writeFileSync(ignore, ".session\n");
      log("Created .neo/.gitignore");
    }
    if (existsSync(join(cwd, "CLAUDE.md")) && !existsSync(join(cwd, "AGENTS.md"))) {
      log('CLAUDE.md exists without AGENTS.md: move its contents to AGENTS.md and leave CLAUDE.md as "@AGENTS.md" so both harnesses read the same rules. Skipped writing instruction files.');
    } else {
      for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        if (!existsSync(join(cwd, name))) {
          copyFileSync(join(templates, name), join(cwd, name));
          log(`Created ${name}`);
        }
      }
      if (!/^@AGENTS\.md\r?$/m.test(readFileSync(join(cwd, "CLAUDE.md"), "utf8"))) {
        log("Add @AGENTS.md on its own line at the top of CLAUDE.md so Claude Code reads AGENTS.md.");
      }
    }
    log("BRIEF.md/ARCHITECTURE.md are template placeholders to fill by hand or via /neo:init's interview.");
    log("Brain initialized. It loads automatically next session; save anytime with /neo:save.");
    return 0;
  } catch (e) {
    rmSync(join(cwd, ".neo/brain"), { recursive: true, force: true });
    throw e;
  }
}

export function main(args = process.argv.slice(2), options = {}) {
  const { log = console.log, error = console.error } = options;
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    log(usage);
    return 0;
  }
  try {
    if (args[0] === "setup") return setup(options);
    if (args[0] === "init") return init(options);
    error(usage);
    return 1;
  } catch (cause) {
    error(`neogents: ${cause.message}`);
    return 1;
  }
}

// npm/npx launch bins through a symlink in node_modules/.bin: argv[1] is the
// symlink, import.meta.url is the real file. Compare canonical paths.
let invoked = "";
try { invoked = realpathSync(process.argv[1]); } catch { /* not a file: imported, or run via -e */ }
if (invoked === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main();
