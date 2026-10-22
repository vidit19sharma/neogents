import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, swapHarnessBlock, transformAgent, HARNESS_BEGIN, HARNESS_END } from "../transform.js";
import { readFileSync } from "node:fs";
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
  const body = `before\n${HARNESS_BEGIN}\nold\n${HARNESS_END}\n`;
  const out = swapHarnessBlock(body, "replacement\n");
  assert.equal(out, "before\nreplacement\n\n");
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
  assert.ok(a.prompt.includes('`subagent_type: "general"`'));
  assert.ok(a.prompt.includes("`todowrite`"));
  assert.ok(!a.prompt.includes(HARNESS_BEGIN));
  assert.ok(!a.prompt.includes(HARNESS_END));
});

test("transformAgent: neo-shadow is a jailed subagent with inherited model", () => {
  const md = readFileSync(join(root, "agents/neo-shadow.md"), "utf8");
  const a = transformAgent("neo-shadow", md, { permissions, models });
  assert.equal(a.mode, "subagent");
  assert.equal(a.model, undefined);
  assert.deepEqual(a.permission, permissions["neo-shadow"]);
  assert.equal(a.description, parseFrontmatter(md).attrs.description);
});

test("transformAgent: trinity maps sonnet to the configured model id", () => {
  const md = readFileSync(join(root, "agents/trinity.md"), "utf8");
  const a = transformAgent("trinity", md, { permissions, models });
  assert.equal(a.model, models.sonnet);
  assert.deepEqual(a.permission, { task: "deny" });
  assert.ok(!("tools" in a));
});
