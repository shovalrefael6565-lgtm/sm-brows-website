# Provenance — ai-visibility-optimizer

| | |
|---|---|
| Upstream | https://github.com/surfacedby/ai-visibility-optimizer-for-claude |
| Commit SHA | `c018605204cf33b6622760d2533d2b4f6771c5a4` |
| Commit date | 2026-07-01 |
| Branch | master |
| License | MIT |
| Author | Ali Khallad (surfacedby) |
| Vendored on | 2026-08-23 |

## What was copied
Only `skills/ai-visibility-optimizer/` — SKILL.md, 2 scripts, 8 reference files.

## What was deliberately NOT copied
- `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json` (plugin marketplace)

No installer was run. No dependencies were added.

## Security review (2026-08-23)
Both scripts were read line by line in full.
- Python standard library only. No pip install, no third-party imports.
- No subprocess, os.system, eval, exec. No file writes. Read-only.
- Network: only `https://<domain-you-pass>/robots.txt`, `/llms.txt`,
  `/llms-full.txt`. Nothing is sent anywhere; results print to stdout.
- No hooks, no telemetry, no env/secret access.
