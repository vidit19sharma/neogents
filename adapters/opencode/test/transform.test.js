import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, swapHarnessBlock, transformAgent, transformSkill, buildConfig, HARNESS_BEGIN, HARNESS_END, OPENCODE_BLOCK } from "../transform.js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const permissions = JSON.parse(readFileSync(join(root, "adapters/opencode/permissions.json"), "utf8"));
const models = JSON.parse(readFileSync(join(root, "adapters/opencode/models.json"), "utf8"));

test("parseFrontmatter splits attrs and body", () => {
  const md = "---\nname: neo\ndescription: The One. Orchestrator.\nmodel: sonnet\ntools: Read, Grep\n---\n\n# NEO\n\nbody";
  const { attrs, body } = parseFrontmatter(md);
  assert.deepEqual(attrs, { name: "neo", description: "The One. Orchestrator.", model: "sonnet", tools: "Read, Grep" });
  assert.equal(body, "\n# NEO\n\nbody");
});

test("parseFrontmatter returns whole text when no frontmatter", () => {
  const { attrs, body } = parseFrontmatter("# plain");
  assert.deepEqual(attrs, {});
  assert.equal(body, "# plain");
});

test("swapHarnessBlock replaces everything between the markers inclusive", () => {
  const body = `before\n${HARNESS_BEGIN}\n## Claude Code Specifics\n- Agent tool\n${HARNESS_END}\n`;
  const out = swapHarnessBlock(body, "## X\n- task tool\n");
  assert.equal(out, "before\n## X\n- task tool\n\n");
});

test("parseFrontmatter normalizes CRLF line endings", () => {
  const { attrs, body } = parseFrontmatter("---\r\nname: x\r\ndescription: d\r\n---\r\n\r\nbody");
  assert.deepEqual(attrs, { name: "x", description: "d" });
  assert.equal(body, "\nbody");
});

test("swapHarnessBlock leaves text without markers untouched", () => {
  assert.equal(swapHarnessBlock("no markers", "X"), "no markers");
});

test("transformAgent: neo is primary, inherits model, gets the OpenCode block", () => {
  const md = readFileSync(join(root, "agents/neo.md"), "utf8");
  const a = transformAgent("neo", md, { permissions, models });
  assert.equal(a.mode, "primary");
  assert.equal(a.model, undefined);
  assert.equal(a.permission, undefined);
  assert.ok(a.prompt.includes(OPENCODE_BLOCK));
  assert.ok(!a.prompt.includes("Claude Code Specifics"));
  assert.ok(!a.prompt.includes(HARNESS_BEGIN));
  assert.ok(!a.prompt.includes(HARNESS_END));
  assert.ok(a.prompt.includes("# NEO"));
});

test("transformAgent: neo without harness markers throws", () => {
  assert.throws(
    () => transformAgent("neo", "---\nname: neo\ndescription: d\n---\nno markers", { permissions, models }),
    /markers not found/,
  );
});

test("transformAgent: unknown model alias throws", () => {
  assert.throws(
    () => transformAgent("x", "---\nname: x\ndescription: d\nmodel: haiku\n---\nbody", { permissions: {}, models }),
    /unknown model alias "haiku"/,
  );
});

test("transformAgent: neo-shadow is a jailed subagent with inherited model", () => {
  const md = readFileSync(join(root, "agents/neo-shadow.md"), "utf8");
  const a = transformAgent("neo-shadow", md, { permissions, models });
  assert.equal(a.mode, "subagent");
  assert.equal(a.model, undefined);
  assert.deepEqual(a.permission, permissions["neo-shadow"]);
  assert.ok(a.description.startsWith("Memory keeper."));
});

test("transformAgent: trinity maps sonnet to the configured model id", () => {
  const md = readFileSync(join(root, "agents/trinity.md"), "utf8");
  const a = transformAgent("trinity", md, { permissions, models });
  assert.equal(a.model, models.sonnet);
  assert.deepEqual(a.permission, { task: "deny" });
  assert.ok(!("tools" in a));
});

test("transformSkill: command named neo:<name>, agent neo, plugin root and tool prose rewritten", () => {
  const md = readFileSync(join(root, "skills/gc/SKILL.md"), "utf8");
  const c = transformSkill("gc", md, { pluginRoot: "/pkg" });
  assert.equal(c.agent, "neo");
  assert.ok(c.description.length > 0);
  assert.ok(c.template.includes('bash "/pkg/hooks/scripts/brain-gc.sh"'));
  assert.ok(!c.template.includes("CLAUDE_PLUGIN_ROOT"));
  assert.ok(c.template.includes("(task tool)"));
  assert.ok(!c.template.includes("Agent tool"));
  assert.ok(c.template.includes("Scan: !`"));
});

test("transformSkill: $ in pluginRoot is inserted literally", () => {
  const md = readFileSync(join(root, "skills/gc/SKILL.md"), "utf8");
  const c = transformSkill("gc", md, { pluginRoot: "/p$&q" });
  assert.ok(c.template.includes("/p$&q/hooks/scripts/brain-gc.sh"));
});

test("transformSkill: WebFetch/WebSearch rewritten to OpenCode tool names", () => {
  const md = readFileSync(join(root, "skills/equip/SKILL.md"), "utf8");
  const c = transformSkill("equip", md, { pluginRoot: "/pkg" });
  assert.ok(!c.template.includes("WebSearch"));
  assert.ok(!c.template.includes("WebFetch"));
  assert.ok(c.template.includes("websearch"));
});

test("buildConfig: neo-shadow denies unlisted tools", () => {
  const cfg = buildConfig({
    agentsDir: join(root, "agents"),
    skillsDir: join(root, "skills"),
    pluginRoot: "/pkg",
    permissions,
    models,
  });
  assert.equal(cfg.agent["neo-shadow"].permission["*"], "deny");
  assert.equal(cfg.agent["neo-shadow"].permission.edit[".neo/brain/**"], "allow");
  for (const tool of ["read", "grep", "glob"]) {
    assert.equal(cfg.agent["neo-shadow"].permission[tool], "allow");
  }
});

test("buildConfig: 4 agents, 11 commands, matches snapshot", () => {
  const cfg = buildConfig({
    agentsDir: join(root, "agents"),
    skillsDir: join(root, "skills"),
    pluginRoot: "/pkg",
    permissions,
    models,
  });
  assert.deepEqual(Object.keys(cfg.agent).sort(), ["neo", "neo-shadow", "smith", "trinity"]);
  assert.equal(Object.keys(cfg.command).length, 11);
  for (const name of Object.keys(cfg.command)) assert.ok(name.startsWith("neo:"), name);
  assert.ok("neo:init" in cfg.command && "neo:equip" in cfg.command);

  const snapPath = join(root, "adapters/opencode/test/snapshot.json");
  if (process.env.UPDATE_SNAPSHOT === "1") {
    writeFileSync(snapPath, JSON.stringify(cfg, null, 2) + "\n");
  }
  const snap = JSON.parse(readFileSync(snapPath, "utf8"));
  assert.deepEqual(cfg, snap, "config drifted from snapshot — run UPDATE_SNAPSHOT=1 node --test if intended");
});
