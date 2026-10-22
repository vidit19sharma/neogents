import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "./transform.js";
import { createHooks, runScript } from "./hooks.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", ".."); // package root: agents/, skills/, hooks/scripts/
const permissions = JSON.parse(readFileSync(join(here, "permissions.json"), "utf8"));
const models = JSON.parse(readFileSync(join(here, "models.json"), "utf8"));

export const NeoPlugin = async ({ client, worktree, directory }) => {
  const wt = worktree || directory || process.cwd();
  const config = buildConfig({
    agentsDir: join(root, "agents"),
    skillsDir: join(root, "skills"),
    pluginRoot: root,
    permissions,
    models,
  });
  const scriptsDir = join(root, "hooks", "scripts");
  return createHooks({
    config,
    client,
    worktree: wt,
    directory: directory || wt,
    run: (name, payload) => runScript(scriptsDir, name, payload, wt),
  });
};

export default NeoPlugin;
