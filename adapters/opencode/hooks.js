import { spawnSync } from "node:child_process";
import { join } from "node:path";

export function runScript(scriptsDir, name, payload, worktree, env = process.env) {
  const r = spawnSync("bash", [join(scriptsDir, name)], {
    input: JSON.stringify(payload),
    cwd: worktree,
    env: { ...env, CLAUDE_PROJECT_DIR: worktree },
    encoding: "utf8",
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);

export function createHooks({ run, client, worktree, config }) {
  const agentOf = new Map(); // sessionID -> agent name (from chat.message)
  const children = new Set(); // sessionIDs created with a parent
  const brain = new Map(); // sessionID -> cached brain-load stdout
  const nudge = new Map(); // sessionID -> pending stop-gate message

  const isRoot = (id) => !children.has(id);

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
  };
}
