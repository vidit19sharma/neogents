import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

export function runScript(scriptsDir, name, payload, worktree, { env = process.env, timeout = 15_000 } = {}) {
  // ponytail: synchronous by design — hooks are awaited and the scripts take ~200ms; the timeout bounds a hung git. Go async (spawn + promise) if the TUI ever stalls.
  const r = spawnSync("bash", [join(scriptsDir, name)], {
    input: JSON.stringify(payload),
    cwd: worktree,
    env: { ...env, CLAUDE_PROJECT_DIR: worktree },
    encoding: "utf8",
    timeout,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);

export function createHooks({ run, client, worktree, directory = worktree, config }) {
  const agentOf = new Map(); // sessionID -> agent name (from chat.message)
  const children = new Set(); // sessionIDs created with a parent
  const brain = new Map(); // sessionID -> cached brain-load stdout
  const nudge = new Map(); // sessionID -> pending stop-gate message

  const isRoot = (id) => !children.has(id) && config.agent[agentOf.get(id)]?.mode !== "subagent";

  async function lastAssistantMessage(sessionID) {
    try {
      const res = await client.session.messages({ path: { id: sessionID } });
      const msgs = res?.data ?? res ?? [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m?.info?.role === "assistant") {
          return (m.parts ?? [])
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n");
        }
      }
    } catch {
      // SDK shape differs or call failed: checkpoint.sh tolerates an empty message
    }
    return "";
  }

  return {
    config: async (cfg) => {
      cfg.agent = { ...(cfg.agent ?? {}) };
      for (const [name, def] of Object.entries(config.agent)) {
        cfg.agent[name] = { ...def, ...(cfg.agent[name] ?? {}) };
      }
      cfg.command = { ...(cfg.command ?? {}) };
      for (const [name, def] of Object.entries(config.command)) {
        cfg.command[name] = { ...def, ...(cfg.command[name] ?? {}) };
      }
    },

    event: async ({ event }) => {
      const p = event?.properties ?? {};
      if (event?.type === "session.created") {
        const info = p.info ?? p;
        if (info?.parentID && info?.id) children.add(info.id);
        return;
      }
      if (event?.type === "session.idle") {
        const id = p.sessionID ?? p.info?.id;
        if (!id || !isRoot(id)) return;
        run("checkpoint.sh", { hook_event_name: "Stop", last_assistant_message: await lastAssistantMessage(id) });
        const gate = run("stop-gate.sh", { stop_hook_active: false });
        if (gate.status === 2 && gate.stderr.trim()) nudge.set(id, gate.stderr.trim());
        run("brain-sync.sh", {});
      }
    },

    "chat.message": async (input) => {
      if (input?.sessionID && input.agent) agentOf.set(input.sessionID, input.agent);
    },

    "experimental.chat.system.transform": async (input, output) => {
      const id = input?.sessionID;
      if (!id || !isRoot(id)) return;
      if (!brain.has(id)) {
        const r = run("brain-load.sh", { source: "startup" });
        brain.set(id, r.stdout.trim());
      }
      const text = brain.get(id);
      if (text) output.system.push(text);
      const n = nudge.get(id);
      if (n) {
        output.system.push(`[neo stop-gate] ${n}`);
        nudge.delete(id);
      }
    },

    "tool.execute.before": async (input, output) => {
      if (!WRITE_TOOLS.has(input?.tool)) return;
      if (agentOf.get(input.sessionID) !== "neo-shadow") return;
      const file = output?.args?.filePath;
      if (!file) return; // apply_patch carries no path; the permission glob covers it
      const r = run("jail.sh", {
        agent_type: "neo-shadow",
        cwd: directory,
        hook_event_name: "PreToolUse",
        tool_name: input.tool,
        tool_input: { file_path: resolve(directory, file) },
      });
      if (r.status === 2) throw new Error(r.stderr.trim() || "neo: write blocked by jail.sh");
    },

    "tool.execute.after": async (input, output) => {
      if (input?.tool !== "task") return;
      const a = input.args ?? {};
      const out = String(output?.output ?? "");
      const m = out.match(/<task_(?:result|error)>\n?([\s\S]*?)\n?<\/task_(?:result|error)>/);
      run("run-ledger.sh", {
        hook_event_name: "PostToolUse",
        tool_name: "Task",
        tool_input: { subagent_type: a.subagent_type, description: a.description },
        tool_response: m ? m[1] : out,
      });
    },

    "experimental.session.compacting": async (input, output) => {
      const id = input?.sessionID;
      if (!id || !isRoot(id)) return;
      run("checkpoint.sh", {
        hook_event_name: "PreCompact",
        last_assistant_message: await lastAssistantMessage(id),
      });
      const r = run("brain-load.sh", { source: "compact" });
      brain.set(id, r.stdout.trim());
      const text = brain.get(id);
      if (text) output.context.push(text);
    },
  };
}
