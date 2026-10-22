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
