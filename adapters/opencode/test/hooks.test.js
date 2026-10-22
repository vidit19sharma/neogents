import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorktree, runScript } from "../hooks.js";

test("resolveWorktree uses the launch directory when there is no git worktree", () => {
  assert.equal(resolveWorktree("/repo", "/repo/sub"), "/repo");
  assert.equal(resolveWorktree("/", "/tmp/x"), "/tmp/x");
  assert.equal(resolveWorktree(undefined, undefined), process.cwd());
});

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

test("runScript bounds a slow script with the configured timeout", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "neo-hooks-slow-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "slow.sh"), "#!/usr/bin/env bash\nexec sleep 5\n");
  const start = performance.now();
  const r = runScript(dir, "slow.sh", {}, dir, { timeout: 200 });
  const elapsed = performance.now() - start;
  assert.equal(typeof r.status, "number");
  assert.notEqual(r.status, 0);
  assert.ok(elapsed < 2_000, `script took ${elapsed}ms`);
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

test("system.transform runs brain-load once per root session and injects it every turn", async () => {
  const { run, calls } = fakeRunner({ "brain-load.sh": { stdout: "BRAIN\n" } });
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "root1" } } } });
  const out1 = { system: ["sys"] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "root1" }, out1);
  const out2 = { system: ["sys"] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "root1" }, out2);
  assert.deepEqual(calls, [["brain-load.sh", { source: "startup" }]]);
  assert.deepEqual(out1.system, ["sys", "BRAIN"]);
  assert.deepEqual(out2.system, ["sys", "BRAIN"]);
});

test("system.transform skips child sessions", async () => {
  const { run, calls } = fakeRunner({ "brain-load.sh": { stdout: "BRAIN\n" } });
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "child1", parentID: "root1" } } } });
  const out = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "child1" }, out);
  assert.deepEqual(calls, []);
  assert.deepEqual(out.system, []);
});

test("resumed subagents skip system.transform and session.idle without a creation event", async () => {
  const { run, calls } = fakeRunner({ "brain-load.sh": { stdout: "BRAIN\n" } });
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  await hooks["chat.message"]({ sessionID: "s1", agent: "trinity" }, {});
  const out = { system: ["sys"] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
  assert.deepEqual(calls, []);
  assert.deepEqual(out.system, ["sys"]);
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
  assert.deepEqual(calls, []);
});

test("tool.execute.before runs jail.sh for neo-shadow writes and throws on exit 2", async () => {
  const { run, calls } = fakeRunner({ "jail.sh": { status: 2, stderr: "neo-shadow may only write under .neo/brain/\n" } });
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  await hooks["chat.message"]({ sessionID: "s1", agent: "neo-shadow" }, {});
  await assert.rejects(
    () => hooks["tool.execute.before"]({ tool: "write", sessionID: "s1", callID: "c1" }, { args: { filePath: "/wt/src/app.js" } }),
    { message: "neo-shadow may only write under .neo/brain/" },
  );
  assert.deepEqual(calls, [[
    "jail.sh",
    { agent_type: "neo-shadow", cwd: "/wt", hook_event_name: "PreToolUse", tool_name: "write", tool_input: { file_path: "/wt/src/app.js" } },
  ]]);
});

test("tool.execute.before allows when jail.sh exits 0 and skips other agents/tools", async () => {
  const { run, calls } = fakeRunner();
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  await hooks["chat.message"]({ sessionID: "s1", agent: "neo-shadow" }, {});
  await hooks["chat.message"]({ sessionID: "s2", agent: "trinity" }, {});
  await hooks["tool.execute.before"]({ tool: "edit", sessionID: "s1" }, { args: { filePath: "/wt/.neo/brain/ACTIVE.md" } });
  await hooks["tool.execute.before"]({ tool: "write", sessionID: "s2" }, { args: { filePath: "/wt/x" } });
  await hooks["tool.execute.before"]({ tool: "read", sessionID: "s1" }, { args: { filePath: "/wt/x" } });
  await hooks["tool.execute.before"]({ tool: "apply_patch", sessionID: "s1" }, { args: { patchText: "..." } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "jail.sh");
});

test("tool.execute.before resolves paths against the launch directory", async () => {
  const { run, calls } = fakeRunner();
  const hooks = createHooks({ run, client: {}, worktree: "/wt", directory: "/wt/pkg", config });
  await hooks["chat.message"]({ sessionID: "s1", agent: "neo-shadow" }, {});
  for (const filePath of [".neo/brain/x.md", "/wt/.neo/brain/x.md"]) {
    await hooks["tool.execute.before"]({ tool: "write", sessionID: "s1" }, { args: { filePath } });
  }
  assert.deepEqual(calls, ["/wt/pkg/.neo/brain/x.md", "/wt/.neo/brain/x.md"].map((file_path) => [
    "jail.sh",
    { agent_type: "neo-shadow", cwd: "/wt/pkg", hook_event_name: "PreToolUse", tool_name: "write", tool_input: { file_path } },
  ]));
});

test("tool.execute.after logs task spawns to the run ledger", async () => {
  const { run, calls } = fakeRunner();
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  await hooks["tool.execute.after"](
    { tool: "task", sessionID: "s1", callID: "c1", args: { subagent_type: "trinity", description: "Add tests", prompt: "..." } },
    { title: "t", output: "<task id=\"ses_x\" state=\"completed\">\n<task_result>\nVERDICT: APPROVE\nlooks good\n</task_result>\n</task>", metadata: {} },
  );
  await hooks["tool.execute.after"]({ tool: "write", sessionID: "s1", args: {} }, { output: "" });
  assert.deepEqual(calls, [[
    "run-ledger.sh",
    {
      hook_event_name: "PostToolUse",
      tool_name: "Task",
      tool_input: { subagent_type: "trinity", description: "Add tests" },
      tool_response: "VERDICT: APPROVE\nlooks good",
    },
  ]]);
});

test("tool.execute.after passes unwrapped task text through unchanged", async () => {
  const { run, calls } = fakeRunner();
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  await hooks["tool.execute.after"]({ tool: "task", args: {} }, { output: "plain text" });
  assert.equal(calls[0][1].tool_response, "plain text");
});

function fakeClient(lastText) {
  return {
    session: {
      messages: async () => ({
        data: [
          { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
          { info: { role: "assistant" }, parts: [{ type: "text", text: lastText }, { type: "tool", text: "ignored" }] },
        ],
      }),
    },
  };
}

test("session.idle on a root session: checkpoint, stop-gate, brain-sync in order; nudge delivered once", async () => {
  const { run, calls } = fakeRunner({ "stop-gate.sh": { status: 2, stderr: "src/app.js changed; brain not saved\n" } });
  const hooks = createHooks({ run, client: fakeClient("done"), worktree: "/wt", config });
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "r" } } } });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "r" } } });
  assert.deepEqual(calls, [
    ["checkpoint.sh", { hook_event_name: "Stop", last_assistant_message: "done" }],
    ["stop-gate.sh", { stop_hook_active: false }],
    ["brain-sync.sh", {}],
  ]);
  const out1 = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "r" }, out1);
  assert.ok(out1.system.includes("[neo stop-gate] src/app.js changed; brain not saved"));
  const out2 = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "r" }, out2);
  assert.ok(!out2.system.some((s) => s.startsWith("[neo stop-gate]")));
});

test("session.idle on a child session does nothing", async () => {
  const { run, calls } = fakeRunner();
  const hooks = createHooks({ run, client: fakeClient("x"), worktree: "/wt", config });
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "c", parentID: "r" } } } });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "c" } } });
  assert.deepEqual(calls, []);
});

test("session.idle survives an SDK that cannot list messages", async () => {
  const { run, calls } = fakeRunner();
  const hooks = createHooks({ run, client: {}, worktree: "/wt", config });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "r" } } });
  assert.deepEqual(calls[0], ["checkpoint.sh", { hook_event_name: "Stop", last_assistant_message: "" }]);
});

test("compacting skips child sessions", async () => {
  const { run, calls } = fakeRunner();
  const hooks = createHooks({ run, client: fakeClient("last"), worktree: "/wt", config });
  await hooks.event({ event: { type: "session.created", properties: { info: { id: "c", parentID: "r" } } } });
  const out = { context: [] };
  await hooks["experimental.session.compacting"]({ sessionID: "c" }, out);
  assert.deepEqual(calls, []);
  assert.deepEqual(out.context, []);
});

test("compacting writes a PreCompact checkpoint and refreshes the brain", async () => {
  const { run, calls } = fakeRunner({ "brain-load.sh": { stdout: "BRAIN\n" } });
  const hooks = createHooks({ run, client: fakeClient("last"), worktree: "/wt", config });
  await hooks["experimental.chat.system.transform"]({ sessionID: "r" }, { system: [] });
  const out = { context: [] };
  await hooks["experimental.session.compacting"]({ sessionID: "r" }, out);
  assert.deepEqual(calls, [
    ["brain-load.sh", { source: "startup" }],
    ["checkpoint.sh", { hook_event_name: "PreCompact", last_assistant_message: "last" }],
    ["brain-load.sh", { source: "compact" }],
  ]);
  assert.deepEqual(out.context, ["BRAIN"]);
});
