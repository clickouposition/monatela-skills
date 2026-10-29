# Step 6 — Build the CapCut project

```bash
cd <skill-dir>
npx tsx src/roughcut.ts build "<absolute-video-path>" "<chosen-hook-text>" "" "REEL-XX-NOME-DO-CLIENTE"
```

- 3rd arg (CapCut drafts dir): pass `""` to use the auto-detected default, or a real path if [setup-checks.md](setup-checks.md) found a non-standard one.
- 4th arg: the exact project name confirmed in [find-and-name.md](find-and-name.md). The project is auto-suffixed (`-2`, `-3`, ...) only if that exact name already exists — it does not silently overwrite an existing project.
- Hook text: pass `""` for a no-hook build (e.g. testimonials, per [hooks.md](hooks.md)).

## What it does

1. Reuses the cached normalized video from [analyze.md](analyze.md).
2. Reuses the cached AssemblyAI transcript.
3. Loads `temp/ai-cuts.json` and applies those cuts as the **sole** repeat source.
4. Writes a CapCut project under the given name, in the CapCut 9.x layout (`Timelines/project.json` + `Timelines/<id>/draft_content.json`). It copies the app/format version from the newest project the installed CapCut created itself, so keep at least one CapCut-made project in the drafts folder. With none, it falls back to the 9.5 format (`187.0.0`).

If CapCut shows the project as "0.0 B" or says "caminho desconhecido", see the matching row in [INSTALL_AND_TROUBLESHOOTING.md](../INSTALL_AND_TROUBLESHOOTING.md).

## Reporting back

Tell the user: **"Done! Open CapCut — your project `<projectname>` is in the projects list."** Also mention:

- Which speaker's audio was used, if [speaker-check.md](speaker-check.md) found more than one voice, and the loudness gap that decided it.
- Any script-wording deviations noted during [cut-review.md](cut-review.md) — don't let those surface only in `ai-cuts.json` reasons, say them out loud.
- The before/after duration (`"4:35 → 0:49"`).

## If something looks wrong afterward

See the troubleshooting table in [INSTALL_AND_TROUBLESHOOTING.md](../INSTALL_AND_TROUBLESHOOTING.md) — "last word cut off", "stutters leaking through", and "wrong person's voice" are all covered there with their real root causes.
