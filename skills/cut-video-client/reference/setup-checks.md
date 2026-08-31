# Step 0 — One-time setup checks

Only run the checks that are actually missing — don't reinstall or re-verify something that already works.

## 1. FFmpeg

Check with `ffmpeg -version`. If not found:

- **Windows, winget available:** `winget install Gyan.FFmpeg`
- **Windows, winget unavailable:** download the "essentials" build from `https://www.gyan.dev/ffmpeg/builds/`, extract it under `%LOCALAPPDATA%\Programs\ffmpeg`, and add its `bin` folder to the user's PATH permanently (`[Environment]::SetEnvironmentVariable("Path", ..., "User")`). A freshly-opened terminal will then find it on PATH — the **current** shell session still needs the same folder exported inline (`export PATH="$PATH:<bin-folder>"` or `$env:Path += ...`) for the rest of this run, since the running shell doesn't pick up the registry change.
- **macOS:** `brew install ffmpeg`

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

Once all four checks pass, move to [trello-match.md](trello-match.md) — that's the default Step 1 now, for one video or many. Only go to [find-and-name.md](find-and-name.md) directly if the user already gave the exact script + reel number, or Trello genuinely isn't reachable.
