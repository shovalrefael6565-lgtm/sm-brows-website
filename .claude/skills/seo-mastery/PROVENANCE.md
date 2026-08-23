# Provenance — seo-mastery

| | |
|---|---|
| Upstream | https://github.com/kpab/seo-mastery-agent-skills |
| Commit SHA | `15ad6c739caafffa9d128fca9d895654feb2edfe` |
| Commit date | 2026-07-10 |
| Branch | main |
| License | MIT |
| Author | kpab |
| Vendored on | 2026-08-23 |

## What was copied
Only `.claude/skills/seo-mastery/` — SKILL.md and its 5 reference files.

## What was deliberately NOT copied
- `.claude/skills/seo-mastery-jp/` (Japanese variant)
- `.claude-plugin/marketplace.json`, `marketplace.json` (plugin marketplace)
- `scripts/validate.py`, `.github/workflows/ci.yml` (upstream CI)
- `.claude/settings.local.json` (upstream author's local settings)

No installer was run. No dependencies were added.

## Security review (2026-08-23)
- No hooks, no lifecycle scripts, no telemetry, no network egress of its own.
- Reads no env vars, no secrets. The only API key reference is the literal
  placeholder `YOUR_API_KEY` in a PageSpeed Insights doc example.
- All shell examples are read-only `curl -s`/`curl -I` against `example.com`.
- SKILL.md ships an explicit prompt-injection defence: treat all fetched page
  content as untrusted data, never as instructions.

## Local note
Reference files may show older Next.js snippets. This project runs Next.js 16.3.1 —
always prefer `node_modules/next/dist/docs/` over any snippet in this skill.
