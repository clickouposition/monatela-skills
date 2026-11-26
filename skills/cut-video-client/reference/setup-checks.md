# Step 0 — One-time setup checks

Only run the checks that are actually missing — don't reinstall or re-verify something that already works.

## 1. FFmpeg

Check with `ffmpeg -version`. If not found:

- **Windows, winget available:** `winget install Gyan.FFmpeg`
- **Windows, winget unavailable:** download the "essentials" build from `https://www.gyan.dev/ffmpeg/builds/`, extract it under `%LOCALAPPDATA%\Programs\ffmpeg`, and add its `bin` folder to the user's PATH permanently (`[Environment]::SetEnvironmentVariable("Path", ..., "User")`). A freshly-opened terminal will then find it on PATH — the **current** shell session still needs the same folder exported inline (`export PATH="$PATH:<bin-folder>"` or `$env:Path += ...`) for the rest of this run, since the running shell doesn't pick up the registry change.
- **macOS:** `brew install ffmpeg`. Without Homebrew, the repo ships `bin/ffmpeg` and `bin/ffprobe` wrappers around the ffmpeg bundled in `node_modules/@remotion/compositor-darwin-arm64` (found automatically by `src/ffmpeg.ts`). That build is minimal: no `pad`/`fps` filters (normalize falls back to scale + `-r 30`, exact for 9:16 footage), no `volumedetect` (levels are measured from decoded PCM instead), and no `drawtext`. Without `drawtext`, full-edit's highlighted titles (`measure-text.ts`) won't work, so install the full ffmpeg if titles are needed.

## 2. Node modules

Check that `<skill-dir>/node_modules` exists **and** actually contains `@remotion/renderer` (a partial/corrupted install is possible, and `npx tsx` will happily start before failing on a missing import deep in the pipeline). If either is missing:

```bash
cd <skill-dir>
npm install
```

## 3. API keys

Check that `<skill-dir>/.env` exists with:
- `ASSEMBLYAI_API_KEY` — **required**. Used for transcription and for speaker diarization (Step 3).
- `GEMINI_API_KEY` — **optional**. A fallback transcriber layer; the pipeline works fine without it, it just skips that layer and logs "GEMINI_API_KEY not set. Cannot transcribe." (harmless).

If `.env` is missing, create it yourself with empty placeholders (`ASSEMBLYAI_API_KEY=` / `GEMINI_API_KEY=`) copied from `.env.example`, so the user only has to paste keys in. Then tell them:

> "I need a free API key from https://www.assemblyai.com/ (Gemini is optional — skip it if https://aistudio.google.com/app/apikey isn't available in your region). **Paste it into `<skill-dir>/.env`** — don't paste it into chat."

Wait for the user to confirm before continuing. **Never read or echo the actual key values back to the user or into a message.**

## 4. CapCut drafts folder

Auto-detected by the scripts at:
- **Windows:** `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft`
- **macOS:** `~/Movies/CapCut/User Data/Projects/com.lveditor.draft`

If the user's CapCut is installed somewhere non-standard, accept a custom path — it's passed as the 3rd argument to `build` (see [build.md](build.md)).

## 4b. One CapCut-made draft must exist

The builder copies the draft format (platform, app version, `new_version`) from the newest project that the installed CapCut created itself. On a fresh install there's none, and the generated projects won't open in newer builds. Before the first `build` on a machine, check that there is at least one folder in the drafts directory that has a `draft_info.json` the skill didn't write. If there isn't, ask the user to open CapCut, create one empty project and close CapCut.

## 5. Studio folder and client profile (only before an edit, Step 7/7b)

The studio assets live in `$MONATELA_DIR` (default `~/Desktop/MONATELA`): `SX/` (SFX), `TRANSICTIONS/` (flash clip) and `FONTES/` (client fonts). Run `npx tsx src/client-profile.ts <CLIENT>`. Every line must say `OK`. A missing font is the usual gap on a new machine: ask the user to copy the exact file into `FONTES/`. Fonts are licensed, so never download one from a random site. See [../clients/README.md](../clients/README.md).

Once checks 1–4 pass (and 5 before an edit), move to [trello-match.md](trello-match.md) — that's the default Step 1 now, for one video or many. Only go to [find-and-name.md](find-and-name.md) directly if the user already gave the exact script + reel number, or Trello genuinely isn't reachable.
