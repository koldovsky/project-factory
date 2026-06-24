// REPO-DEV TOOL (not installed into target projects).
//
// Mirrors the canonical orchestration docs INTO the skill so
// `skills/project-factory/` is SELF-CONTAINED — it works both as a
// plugin-provided skill AND as a standalone `~/.claude/skills/project-factory/`
// copy (no `${CLAUDE_PLUGIN_ROOT}` dependency, no dangling references).
//
// The ROOT files stay canonical (edit those). Run this after editing any of
// them; CI / the drift-watch automation can run `--check` to catch drift.
//
// Usage:
//   node scripts/sync-skill-refs.mjs            # regenerate the mirrors
//   node scripts/sync-skill-refs.mjs --check    # fail if any mirror is stale
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DEST = "skills/project-factory/references";
// [canonical source, mirror filename under DEST]
const MIRRORS = [
  ["MASTER-PROMPT.md", "master-playbook.md"],
  ["checklists/quality-gates.md", "quality-gates.md"],
  ["LOOP.md", "loop.md"],
  ["commands/init.md", "init.md"],
  ["commands/onboard.md", "onboard.md"],
];

function withNote(src, content) {
  // Always prepend the note. We do NOT try to slot it after YAML frontmatter:
  // that made the output depend on CRLF vs LF (`---\r\n` fails `startsWith("---\n")`),
  // so the same source produced different mirrors on Windows vs Unix and the
  // drift `--check` flickered. The mirrors are read as reference docs, not loaded
  // as commands, so frontmatter position is irrelevant. Deterministic > tidy.
  const note = `<!-- GENERATED MIRROR of ${src}. Do not edit here — edit the canonical file and run \`node scripts/sync-skill-refs.mjs\`. Bundled so the skill is self-contained (standalone + plugin). -->\n`;
  return note + "\n" + content;
}

const check = process.argv.includes("--check");
let stale = 0;
mkdirSync(DEST, { recursive: true });
for (const [src, out] of MIRRORS) {
  if (!existsSync(src)) {
    console.error(`FAIL  canonical source missing: ${src}`);
    process.exit(1);
  }
  // Normalize to LF so the written mirror matches git's stored form — otherwise
  // a Windows checkout rewrites every mirror with CRLF and shows them all as
  // "modified" even when nothing changed.
  const want = withNote(src, readFileSync(src, "utf8")).replace(/\r\n/g, "\n");
  const dest = join(DEST, out);
  const have = existsSync(dest) ? readFileSync(dest, "utf8") : null;
  if (check) {
    if (have?.replace(/\r\n/g, "\n") !== want.replace(/\r\n/g, "\n")) {
      console.error(`FAIL  ${dest} is stale vs ${src} — run \`node scripts/sync-skill-refs.mjs\``);
      stale += 1;
    }
  } else {
    writeFileSync(dest, want);
    console.log(`mirrored ${src} -> ${dest}`);
  }
}
if (check) {
  console.log(stale ? `\n${stale} stale mirror(s).` : "\nskill references are in sync.");
  process.exit(stale ? 1 : 0);
}
console.log("\nskill references synced — skills/project-factory/ is self-contained.");
