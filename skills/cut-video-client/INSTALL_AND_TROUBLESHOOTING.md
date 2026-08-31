# Install & Troubleshooting (for the AI agent)

Read this before executing `SKILL.md`. Section 1 is a pre-flight checklist — resolve everything here before starting Step 1. Section 2 is a table of real errors hit while building and running this pipeline, with their actual root cause and fix, so you don't have to re-diagnose them from scratch. Section 3 covers what to do about an error that isn't listed.

## 1. Pre-flight checklist

**1.1 — FFmpeg on PATH.** Run `ffmpeg -version`. If it fails: check whether it's installed but just not on THIS shell session's PATH (a manual install that updated the user-level PATH registry key still won't be visible to an already-running shell — export it inline for this session, e.g. `export PATH="$PATH:<bin-folder>"`). If truly not installed, follow `SETUP.md` section 3. Do not proceed to Step 2 (analyze) while this is unresolved — every downstream step depends on it.

**1.2 — Node modules complete.** Check `node_modules` exists **and** `node_modules/@remotion/renderer` specifically exists. A present-but-incomplete `node_modules` is a real failure mode (interrupted install, partial `npm ci`), and `npx tsx` will run for a while before failing deep inside the pipeline on this missing import — cheaper to check upfront than to debug after a failed `analyze` run.

**1.3 — `.env` has a real AssemblyAI key.** Check the file exists and `ASSEMBLYAI_API_KEY` isn't empty or the placeholder text. If missing, ask the user to create it per `SETUP.md` section 4 — never ask them to paste the key into chat, and never read the value back once it's there.

**1.4 — CapCut drafts folder exists.** Check the default path for the OS; if absent, ask the user whether CapCut has been opened at least once (it creates the folder on first launch), or for a custom drafts path to pass as `build`'s 3rd argument.

**1.5 — `temp/ai-cuts.json` is clean for this video.** If it exists from a previous run, delete it before `analyze` — see the "stale ai-cuts.json" row below for why this matters.

**1.6 — Trello access, only when running batch/Trello-match mode.** Check whether a Trello MCP connector is available in the current environment; if not, check `.env` for real `TRELLO_API_KEY` / `TRELLO_TOKEN` values. Neither present means: stop and ask the user for one of the two before starting `reference/trello-match.md` — don't try to scrape the Trello web UI as a workaround.

## 2. Error → cause → fix

| Symptom | Root cause | Fix |
|---|---|---|
| `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@remotion/renderer'` | `node_modules` present but incomplete/corrupted | `npm install` in the skill directory, then re-run |
| `Error: FFmpeg not found. Install FFmpeg via winget install Gyan.FFmpeg or add it to PATH.` | Installed via winget/manual download, but the current shell session's PATH predates the install | Export the FFmpeg `bin` folder onto PATH for this session's commands; open a fresh terminal for it to stick permanently |
| `winget` itself not found when trying to install FFmpeg | Not every Windows machine has App Installer/winget available | Download the "essentials" build directly from `https://www.gyan.dev/ffmpeg/builds/`, extract, add `bin` to PATH manually |
| `analyze` prints cut stats that make no sense for this video (way more removed than expected, or a cut list clearly from different content) | Stale `temp/ai-cuts.json` left over from a **previous, different** video — both `analyze` and `build` read it unconditionally when present | Delete `temp/ai-cuts.json` before starting a new video's `analyze`. This is why the "One Video At A Time Rule" in `SKILL.md` exists |
| Final video contains the wrong person's voice, or a voice that sounds "off"/distant/muffled throughout | `ai-cuts.json` included time ranges belonging to an off-camera speaker (director, assistant) rather than the on-camera subject — happens when the speaker-diarization step is skipped or its result isn't trusted | Run `diarize-speakers.ts`, confirm the on-camera speaker by loudness gap (ask the user if the gap is small), and rebuild `ai-cuts.json` restricted to only that speaker's utterance ranges |
| `diarize-speakers.ts` reports `confidence: "low"` or a loudness gap under ~2dB | Both speakers are roughly equidistant from the mic, or the audio is mono-downmixed with no usable stereo separation | Do not trust the loudest-speaker guess. Quote sample lines from each speaker's `utterances` to the user and ask them to identify which is on camera |
| The last word of a kept sentence sounds clipped, or a stutter/repeat leaks through in the final video | Either testing an older `roughcut-N` project (CapCut suffixes duplicates), or `ai-cuts.json` cut boundaries don't precisely match the transcript's word timestamps | Confirm which project the user opened is the latest one; re-check that every cut's `startSec`/`endSec` matches an actual word boundary in `temp/transcript-words-normalized-<video>.json`, not an approximate guess |
| Gemini transcription step logs `GEMINI_API_KEY not set. Cannot transcribe.` | Expected and harmless — Gemini is an optional fallback layer, not required | No action needed; the pipeline continues on AssemblyAI alone. Only worth flagging to the user if they explicitly wanted Gemini and forgot to add the key |
| Gemini key generation redirects to `https://ai.google.dev/gemini-api/docs/available-regions` instead of producing a key | The Gemini API isn't available in the user's region | Tell the user Gemini is optional here; leave `GEMINI_API_KEY` blank and continue with AssemblyAI-only |
| A background `npx tsx` command silently uses a different/older `tsx` than the one in `node_modules/.bin` | `npx` fetched a fresh `tsx` from its own cache instead of the local dependency, usually right after an interrupted `npm install` | Re-run `npm install` to make sure `node_modules/.bin/tsx` exists and is current, then re-run the command |
| A video in a Trello-match batch gets assigned to the wrong REEL/client, or to no card at all | The transcript-to-card match was forced past a weak/ambiguous score instead of stopping to ask | This is a Trello Match Confidence Rule violation, not a bug to patch around — re-run the match for that video and, per `reference/trello-match.md`, stop and ask the user instead of auto-picking the top-scoring card |
| Trello card list comes back empty, or the wrong client's cards | Wrong board/list resolved, or the "Conteúdo" list name doesn't match exactly (accents, capitalization) on that particular board | Confirm the exact board with the user rather than guessing from a folder/filename; list the board's lists and match the name literally instead of assuming the list id from another board |
| CapCut project won't relink its media — clip shows as offline/missing, but the project (and its cuts) already exist | `temp/normalized-<name>.mp4` was deleted (disk cleanup, moved `temp/` folder) while the CapCut draft still points at that exact path | Run `npx tsx src/renormalize.ts <original-video-path>` to regenerate the normalized file at the same path — it re-runs only the normalize step, without touching transcripts, `ai-cuts.json`, or the CapCut project itself |

## 3. When you hit something not listed here

1. Read the actual error message literally before guessing — the fix is usually implied directly in the text (a missing package name, a missing binary, a wrong path).
2. Check whether it's a **setup** problem (section 1 checklist) before assuming it's a **logic** problem in the cut decisions.
3. If a write action already partially happened (e.g. a CapCut project folder got created before the failure), don't leave it half-finished silently — tell the user what state it's in.
4. Prefer asking the user over guessing when the fix would change what gets kept/cut in the final video — a wrong guess there ships a wrong video, not just a wasted step.
