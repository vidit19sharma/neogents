import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function parseFrontmatter(md) {
  if (!md.startsWith("---\n")) return { attrs: {}, body: md };
  const end = md.indexOf("\n---\n", 4);
  if (end === -1) return { attrs: {}, body: md };
  const attrs = {};
  for (const line of md.slice(4, end).split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) attrs[m[1]] = m[2].trim();
  }
  return { attrs, body: md.slice(end + 5) };
}
