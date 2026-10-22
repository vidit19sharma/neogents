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
