import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "../transform.js";

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
