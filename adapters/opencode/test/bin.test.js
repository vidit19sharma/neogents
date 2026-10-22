import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const text = (path) => readFileSync(join(root, path), "utf8");

test("package exposes the plugin and CLI with a public zero-dependency payload", () => {
  const pkg = JSON.parse(text("package.json"));
  const plugin = JSON.parse(text(".claude-plugin/plugin.json"));
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.name, "@vidit19sharma/neogents");
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.version, plugin.version);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.main, "./adapters/opencode/plugin.js");
  assert.deepEqual(pkg.bin, { neogents: "bin/neogents.js" });
  assert.deepEqual(pkg.files, [
    "agents/", "skills/", "hooks/scripts/", "templates/", "adapters/opencode/", "bin/",
  ]);
  assert.deepEqual(pkg.repository, {
    type: "git", url: "git+https://github.com/vidit19sharma/neogents.git",
  });
  assert.deepEqual(pkg.engines, { node: ">=20" });
  assert.deepEqual(pkg.publishConfig, { access: "public" });
  assert.deepEqual(pkg.keywords, plugin.keywords);
  assert.deepEqual(pkg.scripts, { test: "node --test adapters/opencode/test/" });
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { mergeSetup, setup, init, main } from "../../../bin/neogents.js";

const packageName = "@vidit19sharma/neogents";
const bin = join(root, "bin/neogents.js");
const brainNames = [
  "ACTIVE.md", "ARCHITECTURE.md", "BRIEF.md", "DECISIONS.md", "FRICTION.md",
  "INDEX.md", "LESSONS.md", "PROGRESS.md", "WORKFLOWS.md",
];

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "neo-bin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lines = [];
  const errors = [];
  return {
    dir, lines, errors,
    options: {
      cwd: dir, home: dir, env: { XDG_CONFIG_HOME: join(dir, "xdg") },
      log: (line) => lines.push(line), error: (line) => errors.push(line),
    },
  };
}

test("mergeSetup adds the plugin and default agent without mutating its input", () => {
  const input = Object.freeze({});
  assert.deepEqual(mergeSetup(input), {
    cfg: { plugin: [packageName], default_agent: "neo" }, changed: true,
  });
  assert.deepEqual(input, {});
});

test("mergeSetup preserves unrelated keys, schema, plugin order, and key order", () => {
  const input = {
    $schema: "https://opencode.ai/config.json", model: "vendor/model",
    plugin: ["other-plugin"], permission: { edit: "ask" },
  };
  const { cfg, changed } = mergeSetup(input);
  assert.equal(changed, true);
  assert.deepEqual(cfg, { ...input, plugin: ["other-plugin", packageName], default_agent: "neo" });
  assert.deepEqual(Object.keys(cfg), ["$schema", "model", "plugin", "permission", "default_agent"]);
  assert.deepEqual(input.plugin, ["other-plugin"]);
});

test("mergeSetup replaces a pinned entry in place and preserves a chosen default", () => {
  const input = { plugin: ["first", `${packageName}@0.0.9`, "last"], default_agent: "build" };
  const { cfg } = mergeSetup(input);
  assert.deepEqual(cfg, { plugin: ["first", packageName, "last"], default_agent: "build" });
  assert.deepEqual(Object.keys(cfg), ["plugin", "default_agent"]);
});

test("mergeSetup is idempotent and treats a null default as unset", () => {
  const first = mergeSetup({ default_agent: null });
  assert.equal(first.cfg.default_agent, "neo");
  assert.deepEqual(mergeSetup(first.cfg), { cfg: first.cfg, changed: false });
});

test("mergeSetup rejects invalid config and plugin shapes without discarding data", () => {
  for (const value of [null, [], "config", { plugin: "other" }, { plugin: [7] }]) {
    assert.throws(() => mergeSetup(value), TypeError);
  }
});

test("setup honors XDG_CONFIG_HOME, creates its directory, and does not rewrite", (t) => {
  const { dir, options, lines } = fixture(t);
  const file = join(dir, "xdg/opencode/opencode.json");
  assert.equal(setup(options), 0);
  assert.equal(readFileSync(file, "utf8"), JSON.stringify({ plugin: [packageName], default_agent: "neo" }, null, 2) + "\n");
  assert.ok(lines.includes("Restart OpenCode, then run /neo:init in a project."));
  utimesSync(file, new Date(1_000_000), new Date(1_000_000));
  const before = statSync(file).mtimeMs;
  lines.length = 0;
  assert.equal(setup(options), 0);
  assert.equal(statSync(file).mtimeMs, before);
  assert.ok(lines.some((line) => line.includes("already configured")));
});

test("setup uses the home fallback and notes an existing default choice", (t) => {
  const { dir, options, lines } = fixture(t);
  const file = join(dir, ".config/opencode/opencode.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{"$schema":"s","default_agent":"build","model":"m"}\n');
  assert.equal(setup({ ...options, env: {} }), 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    $schema: "s", default_agent: "build", model: "m", plugin: [packageName],
  });
  assert.ok(lines.includes('Keeping your default_agent: "build".'));
});

test("setup with only JSONC prints the two additions and writes nothing", (t) => {
  const { dir, options, lines } = fixture(t);
  const folder = join(dir, "xdg/opencode");
  mkdirSync(folder, { recursive: true });
  const original = '// keep comments\n{"model":"m"}\n';
  writeFileSync(join(folder, "opencode.jsonc"), original);
  assert.equal(setup(options), 0);
  assert.deepEqual(readdirSync(folder), ["opencode.jsonc"]);
  assert.equal(readFileSync(join(folder, "opencode.jsonc"), "utf8"), original);
  assert.ok(lines.includes('"plugin": ["@vidit19sharma/neogents"]'));
  assert.ok(lines.includes('"default_agent": "neo"'));
});

test("setup uses JSON when both config files exist and preserves the JSONC", (t) => {
  const { dir, options } = fixture(t);
  const folder = join(dir, "xdg/opencode");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "opencode.json"), '{"model":"kept"}\n');
  writeFileSync(join(folder, "opencode.jsonc"), "// untouched\n{}\n");
  assert.equal(setup(options), 0);
  assert.equal(JSON.parse(readFileSync(join(folder, "opencode.json"), "utf8")).model, "kept");
  assert.equal(readFileSync(join(folder, "opencode.jsonc"), "utf8"), "// untouched\n{}\n");
});

test("init creates all nine bundled brain files and both instruction files", (t) => {
  const { dir, options, lines } = fixture(t);
  assert.equal(init(options), 0);
  assert.deepEqual(readdirSync(join(dir, ".neo/brain")).sort(), brainNames);
  assert.ok(statSync(join(dir, ".neo/plans")).isDirectory());
  assert.equal(readFileSync(join(dir, ".neo/.gitignore"), "utf8"), ".session\n");
  for (const name of brainNames) {
    assert.equal(readFileSync(join(dir, ".neo/brain", name), "utf8"), text(`templates/brain/${name}`));
    assert.ok(lines.includes(`Created .neo/brain/${name}`));
  }
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    assert.equal(readFileSync(join(dir, name), "utf8"), text(`templates/${name}`));
    assert.ok(lines.includes(`Created ${name}`));
  }
  assert.ok(lines.includes("Created .neo/plans/"));
  assert.ok(lines.includes("Created .neo/.gitignore"));
  assert.ok(lines.includes("BRIEF.md/ARCHITECTURE.md are template placeholders to fill by hand or via /neo:init's interview."));
});

test("init's brain guard makes a second run a complete no-op", (t) => {
  const { dir, options, lines } = fixture(t);
  init(options);
  const brief = join(dir, ".neo/brain/BRIEF.md");
  writeFileSync(brief, "living brain\n");
  rmSync(join(dir, "CLAUDE.md"));
  rmSync(join(dir, ".neo/.gitignore"));
  rmSync(join(dir, ".neo/plans"), { recursive: true });
  utimesSync(brief, new Date(1_000_000), new Date(1_000_000));
  const before = statSync(brief).mtimeMs;
  lines.length = 0;
  assert.equal(init(options), 0);
  assert.equal(readFileSync(brief, "utf8"), "living brain\n");
  assert.equal(statSync(brief).mtimeMs, before);
  assert.equal(existsSync(join(dir, "CLAUDE.md")), false);
  assert.equal(existsSync(join(dir, ".neo/.gitignore")), false);
  assert.equal(existsSync(join(dir, ".neo/plans")), false);
  assert.deepEqual(lines, ["Brain already initialized; use /neo:status."]);
});

test("init leaves existing instruction files alone and requests a missing import", (t) => {
  const { dir, options, lines } = fixture(t);
  const claude = "# Existing\nMention @AGENTS.md inline only.\n";
  writeFileSync(join(dir, "CLAUDE.md"), claude);
  writeFileSync(join(dir, "AGENTS.md"), "# User conventions\n");
  init(options);
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), claude);
  assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "# User conventions\n");
  assert.ok(lines.includes("Add @AGENTS.md on its own line at the top of CLAUDE.md so Claude Code reads AGENTS.md."));
  assert.ok(!lines.includes("Created AGENTS.md"));
  assert.ok(!lines.includes("Created CLAUDE.md"));
});

test("init recognizes an existing standalone import with CRLF", (t) => {
  const { dir, options, lines } = fixture(t);
  writeFileSync(join(dir, "CLAUDE.md"), "@AGENTS.md\r\n\r\n# Existing\r\n");
  init(options);
  assert.ok(!lines.some((line) => line.startsWith("Add @AGENTS.md")));
});

test("main routes setup/init and handles usage, unknown commands, and bad JSON", (t) => {
  const { dir, options, lines, errors } = fixture(t);
  for (const args of [[], ["--help"], ["-h"]]) {
    assert.equal(main(args, options), 0);
    assert.match(lines.pop(), /^Usage: neogents/);
  }
  assert.equal(main(["unknown"], options), 1);
  assert.match(errors.pop(), /^Usage: neogents/);
  assert.equal(main(["setup"], options), 0);
  assert.equal(main(["init"], options), 0);
  const file = join(dir, "xdg/opencode/opencode.json");
  writeFileSync(file, "{broken\n");
  assert.equal(main(["setup"], options), 1);
  assert.match(errors.pop(), /^neogents: /);
  assert.equal(readFileSync(file, "utf8"), "{broken\n");
});

test("direct execution runs main and importing the bin has no side effects", (t) => {
  const { dir } = fixture(t);
  const env = { ...process.env, XDG_CONFIG_HOME: join(dir, "xdg") };
  const run = (args) => spawnSync(process.execPath, args, { cwd: dir, env, encoding: "utf8" });
  const imported = run(["--input-type=module", "-e", `await import(${JSON.stringify(new URL("../../../bin/neogents.js", import.meta.url).href)})`]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(existsSync(join(dir, ".neo")), false);
  assert.equal(existsSync(join(dir, "xdg")), false);
  for (const args of [[], ["--help"], ["-h"]]) {
    const result = run([bin, ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage: neogents/);
    assert.equal(result.stderr, "");
  }
  const unknown = run([bin, "unknown"]);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, "");
  assert.match(unknown.stderr, /^Usage: neogents/);
  const initialized = run([bin, "init"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.ok(existsSync(join(dir, ".neo/brain/BRIEF.md")));
  const configured = run([bin, "setup"]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir, "xdg/opencode/opencode.json"), "utf8")).default_agent, "neo");
});

test("execution through an npm-style node_modules/.bin symlink still runs main", (t) => {
  const { dir } = fixture(t);
  const env = { ...process.env, XDG_CONFIG_HOME: join(dir, "xdg") };
  const link = join(dir, "node_modules/.bin/neogents");
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(bin, link);
  const run = (args) => spawnSync(process.execPath, [link, ...args], { cwd: dir, env, encoding: "utf8" });
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage: neogents/);
  const initialized = run(["init"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.ok(existsSync(join(dir, ".neo/brain/BRIEF.md")));
  const configured = run(["setup"]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir, "xdg/opencode/opencode.json"), "utf8")).default_agent, "neo");
});

test("adapter CI syntax-checks the bin and retains tests and version sync", () => {
  const ci = text(".github/workflows/ci.yml");
  const adapter = ci.split("\n  adapter:\n")[1].split(/\n  [a-z][a-z-]*:\n/)[0];
  assert.ok(adapter.includes("for f in adapters/opencode/*.js bin/neogents.js; do"));
  assert.ok(adapter.includes("run: node --test adapters/opencode/test/"));
  assert.ok(adapter.includes("name: package.json version matches plugin.json"));
  assert.ok(adapter.includes("require('./.claude-plugin/plugin.json').version"));
});
