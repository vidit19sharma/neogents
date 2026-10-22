import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScript } from "../hooks.js";

test("runScript feeds JSON on stdin, sets CLAUDE_PROJECT_DIR, returns status/stdout/stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "neo-hooks-"));
  const script = join(dir, "echo.sh");
  writeFileSync(script, '#!/usr/bin/env bash\nread -r line\necho "root=$CLAUDE_PROJECT_DIR in=$line"\necho "nope" >&2\nexit 2\n');
  chmodSync(script, 0o755);
  const r = runScript(dir, "echo.sh", { a: 1 }, dir);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, `root=${dir} in={"a":1}\n`);
  assert.equal(r.stderr, "nope\n");
});

import { createHooks } from "../hooks.js";

function fakeRunner(results = {}) {
  const calls = [];
  const run = (name, payload) => {
    calls.push([name, payload]);
    return { status: 0, stdout: "", stderr: "", ...(results[name] ?? {}) };
  };
  return { run, calls };
}

const config = {
  agent: { neo: { mode: "primary", prompt: "P" }, trinity: { mode: "subagent", prompt: "T", model: "x/y" } },
  command: { "neo:init": { description: "d", agent: "neo", template: "t" } },
};

test("config hook injects agents and commands without clobbering user keys", async () => {
  const { run } = fakeRunner();
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  const cfg = { agent: { trinity: { model: "user/override" } }, command: {}, default_agent: "neo" };
  await hooks.config(cfg);
  assert.equal(cfg.agent.neo.mode, "primary");
  assert.equal(cfg.agent.trinity.model, "user/override");
  assert.equal(cfg.agent.trinity.prompt, "T");
  assert.deepEqual(cfg.command["neo:init"], config.command["neo:init"]);
  assert.equal(cfg.default_agent, "neo");
});

test("config hook tolerates a config with no agent/command keys", async () => {
  const { run } = fakeRunner();
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  const cfg = {};
  await hooks.config(cfg);
  assert.equal(Object.keys(cfg.agent).length, 2);
  assert.equal(Object.keys(cfg.command).length, 1);
});
