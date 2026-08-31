# igniting-roughcut

A Claude Code skill that turns raw video footage into a CapCut project with silences, repeated takes, and off-camera/background voice removed, plus a hook text overlay. **By Igniting Studios.**

The pipeline normalizes the source video, detects silence, transcribes with AssemblyAI for word-level timestamps, diarizes speakers to find who's on camera, lets Claude compare the transcript against the client's script (when given one) to choose precise cut decisions, then writes a CapCut `draft_content.json` ready to open in CapCut.

---

## How this skill works

When the user says something like "roughcut my video" / "edit this raw footage" / "make a capcut project from this video", follow this flow. If they give you **several videos at once**, process them one at a time, start to finish, before moving to the next — the cut-decision file (`temp/ai-cuts.json`) is shared scratch space and gets overwritten each run, so two videos can never be "in progress" at once. The `analyze` step itself is safe to run in parallel across videos (it doesn't touch `ai-cuts.json`); only the review-and-build portion must be sequential.

### Step 0 — One-time setup checks (only run if missing)

1. **FFmpeg** — `ffmpeg -version`. If not installed:
   - Windows: `winget install Gyan.FFmpeg` (if winget itself is unavailable, download the "essentials" build from gyan.dev/ffmpeg/builds, extract it under `%LOCALAPPDATA%\Programs\ffmpeg`, and add its `bin` folder to the user's PATH permanently — a freshly-opened terminal will then find it on PATH; the current one needs it exported inline for the rest of the session)
   - macOS: `brew install ffmpeg`
2. **Node modules** — check if `<skill-dir>/node_modules` exists AND actually contains `@remotion/renderer` (a partial/corrupted install is possible). If either is missing: `cd <skill-dir> && npm install`
3. **API keys** — check if `<skill-dir>/.env` exists with `ASSEMBLYAI_API_KEY` (required) and `GEMINI_API_KEY` (optional fallback transcriber — the pipeline works fine without it, just skips that layer).
   If `.env` is missing, create it yourself with empty placeholder values (`ASSEMBLYAI_API_KEY=` / `GEMINI_API_KEY=`) from `.env.example` so the user only has to paste keys in, then tell them:
   > "I need a free API key from https://www.assemblyai.com/ (Gemini's optional — skip it if https://aistudio.google.com/app/apikey isn't available in your region). **Paste it into `<skill-dir>/.env`** — don't paste it into chat."
   Wait for confirmation. Never read or echo the actual key values.
4. **CapCut drafts folder** — the script auto-detects:
   - Windows: `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft`
   - macOS: `~/Movies/CapCut/User Data/Projects/com.lveditor.draft`
   If non-standard, accept a custom path as the third arg to `build`.

### Step 1 — Find the video(s) and script(s)

Look for `.mp4 / .mov / .mkv / .webm / .avi` files in the user's current working directory. If multiple and unclear which is which, ask. If none, ask for an absolute path. **Always pass absolute paths to the script.**

Ask the user for the **script** each video is meant to follow, if they haven't already given one. A script is optional but makes cuts far more reliable — without one you're guessing which repeated take is "the good one" from audio quality and phrasing alone; with one you can match the on-camera speaker's actual words against it line by line. If no script is given, proceed on judgment (repeats, false starts, filler — see Step 4).

### Step 2 — Determine the CapCut project name

The studio's naming convention is:

```
REEL-XX-NOME-DO-CLIENTE
```

- **XX** — the reel number. This is assigned by the studio's own content calendar, not a simple counter you derive — **always ask the user** what number this reel is, unless they already told you.
- **NOME-DO-CLIENTE** — the client this footage belongs to. Try to infer it from context (the working directory name, an active per-client project, prior messages) first. If it isn't clear, **ask the user** rather than guessing — a wrong client name silently misfiles the work.

Build the exact project name before calling `build` (see Step 6) — pass it as the 4th argument so CapCut gets the right name on first write, instead of renaming folders after the fact.

### Step 3 — Analyze (run in background)

```bash
cd <skill-dir>
npx tsx src/roughcut.ts analyze "<absolute-video-path>"
```

Run with `run_in_background: true` and **wait for the completion notification — do not poll**. First run on a new video takes 1–3 min (normalize + transcribe). Subsequent runs are instant (cached).

**Before this step, delete `temp/ai-cuts.json` if it exists from a previous video.** Both `analyze` and `build` read that file as the "repeat source" when present — a leftover file from a different (usually longer) video will apply nonsense cut times to this one. This only pollutes the console stats during `analyze` (the cached transcript itself is unaffected), but during `build` it actually mis-cuts the video, so never skip this.

The output is a single JSON line with fields: `original`, `kept`, `removed`, `sections`, `repeatsRemoved`, `transcript` (full text). Read it for a first impression, but don't treat `kept`/`removed` as final — your own review in Steps 4–5 supersedes it.

### Step 4 — Identify the on-camera speaker (mandatory whenever more than one voice is present)

A single camera or room mic picks up everyone nearby — a director prompting lines, an assistant, a phone call. **Never assume the loudest or most "confident-sounding" take is the right person without checking.** Cutting together a video where the audio doesn't belong to the person on screen is a hard failure, not a style choice.

Run:

```bash
npx tsx src/diarize-speakers.ts "<skill-dir>/temp/normalized-<videoname>.mp4"
```

(The normalized video must already exist — it's created by Step 3.) This diarizes the audio into speaker labels and measures each speaker's average loudness via `ffmpeg volumedetect`, on the theory that the person being filmed is almost always closest to the mic and therefore louder. It prints a JSON report with `speakers`, `avgLoudnessDb`, `onCameraSpeaker` (its best guess), `loudnessGapDb`, and a `confidence` rating (`high` ≥5dB gap, `medium` ≥2dB, `low`/`unknown` otherwise).

- **Only one speaker detected** → nothing to disambiguate, proceed normally.
- **`confidence: "high"`** → proceed using that speaker's utterances as the source of truth for Step 5, but still mention in your summary to the user which speaker you kept and why (loudness gap), so they can catch a wrong call early.
- **`confidence: "medium"` or `"low"`, or the result feels off given what the user told you about the footage** → **stop and ask the user** which speaker is on camera before writing any cuts. Don't guess past this point — a silent wrong guess is exactly the failure mode this step exists to prevent.

Once the on-camera speaker is identified, **every kept segment in Step 5 must come from that speaker's utterance ranges only.** A take that matches the script perfectly but belongs to the wrong speaker is not usable — prefer the on-camera speaker's next-best take over the off-camera speaker's exact match, and tell the user about the wording deviation this causes rather than silently downgrading quality.

### Step 5 — AI cut review

Read the cached word-level transcript at `<skill-dir>/temp/transcript-words-normalized-<videoname>.json` — every word with `{text, start, end}` in seconds, accurate to the normalized video the build step references.

**If the user gave you a script**, go line by line: find every take of that line in the transcript (restricted to the on-camera speaker's ranges from Step 4), and pick the one whose wording is closest to the script, breaking ties toward the cleaner/later take. It's normal for zero takes to match a line word-for-word once you've filtered to the correct speaker — pick the closest available and tell the user the deviation, rather than reaching for an off-camera take just because its wording is exact. If a script line was never actually recorded, say so plainly instead of inventing a cut for it.

**If there's no script** (or on top of script matching), look for:
- **Repeated phrases** — speaker says the same thing twice (keep the LATER/cleaner version, unless a script says otherwise)
- **False starts** — "I want to— so what I mean is..."
- **Standalone fillers** — "So", "Okay", "Alright" said alone before the real sentence starts
- **Stretched/stuttered words** — a single word with abnormally long duration often indicates a stutter the speaker glossed over
- **Trailing/abandoned sentences** — incomplete thoughts the speaker dropped
- **Self-corrections** — "the API is— I mean, the SDK is..."
- **Off-topic banter** — director/crew chatter, meta-commentary about the script or the take ("did I already say that?", "let's do it again"), phone-call asides — none of this is script content even when it's the correct speaker talking

For each kept transition, write the cut to `<skill-dir>/temp/ai-cuts.json` as a JSON array:

```json
[
  {"startSec": 24.38, "endSec": 25.46, "reason": "off-camera speaker prompting the line, not the on-camera subject"},
  {"startSec": 32.07, "endSec": 34.02, "reason": "stretched 'And then' stutter — keep starting at 'I trained it'"}
]
```

**Cut placement rules:**
- `startSec` should equal the `start` of the first word being cut
- `endSec` should equal the `start` of the first word being KEPT after the cut (not the `end` of the last cut word — that would leak the kept word's onset into the cut)
- If a kept sentence ends with a different word than what follows, leave a gap of natural silence between them — the pipeline preserves it
- When in doubt, **don't cut** — false positives are worse than missed repeats
- Keep cuts aligned to word boundaries; don't cut mid-word
- When `build` runs with a non-empty `ai-cuts.json`, it uses **only** those cuts as the repeat source — the rule-based detectors are skipped entirely. Your list must be complete; there's no automatic second pass filling in what you missed.

### Step 6 — Present hooks to the user

Skip this step for footage that shouldn't carry a hook overlay (e.g. a client testimonial) — confirm with the user if unsure, don't assume every video wants one.

Otherwise show:
- **Stats**: `"Removing 0:24 of dead time — silences, repeated takes, off-camera voice (1:05 → 0:41)"`
- **5 hook text suggestions** (see Hook Rules below)
- **Option 6: "Write your own"**

Wait for the user to pick a hook (or confirm no hook).

### Step 7 — Build the CapCut project

```bash
cd <skill-dir>
npx tsx src/roughcut.ts build "<absolute-video-path>" "<chosen-hook-text>" "" "REEL-XX-NOME-DO-CLIENTE"
```

Pass `""` for the 3rd arg (CapCut drafts dir) to use the auto-detected default, or a real path if it's non-standard. Pass the exact project name from Step 2 as the 4th arg — the project is auto-suffixed (`-2`, `-3`, ...) only if that exact name already exists. For a no-hook build (e.g. testimonials), pass `""` as the hook text.

The build step:
1. Reuses the cached normalized video
2. Reuses the cached AssemblyAI transcript
3. Loads `temp/ai-cuts.json` and applies your cuts
4. Writes a CapCut project under the given name

When done, tell the user: **"Done! Open CapCut — your project `<projectname>` is in the projects list."** Mention which speaker's audio was used if diarization was involved, and any script-wording deviations from Step 5.

---

## Hook generation rules

Generate exactly **5 hooks** based on the transcript content. Each must follow:
- **Maximum 4–5 words** — never longer
- **Never lie or exaggerate** — must be truthful to the actual video content
- **Create curiosity without clickbait** — no false promises

### The 5 styles

1. **Generic curiosity** — "Nobody talks about this", "Stop doing this manually"
2. **Descriptive** — tells exactly what the video is about
3. **Attention-grabber** — punchy, emotional, topic-related
4. **Specific claim** — bold personal result, plausible given the transcript
5. **Contrarian / hot take** — challenges audience assumptions

Present numbered 1–5 plus option 6: "Write your own". If a hook proposed by the user (or by you) doesn't actually relate to the video's content, say so before building — don't build a mismatched hook silently.

---

## Architecture notes (for debugging if something breaks)

The pipeline has one critical insight: **the source video is normalized once at the start** (`src/normalize-video.ts`), and every downstream tool (silence detection, AssemblyAI, diarization, CapCut export) operates on the same normalized file. Without this, ffmpeg / AssemblyAI / CapCut can each interpret the source's timeline differently (especially for H.265 + variable frame rate + rotation metadata + AAC priming delays), causing words to be cut off or cut content to leak.

The cut-aware functions in `src/calculate-sections.ts` (`snapToWordBoundaries`, `preserveIntentionalPauses`, `calculateSections`'s bridging + padding) all accept a `cutBoundaries` array and refuse to extend section boundaries past cut starts. This is what prevents the bridging step from merging across cut gaps when no natural silence exists between adjacent kept sections.

`src/diarize-speakers.ts` reuses the mono WAV already extracted for transcription when present, calls AssemblyAI with `speaker_labels: true`, and samples `ffmpeg volumedetect` over each speaker's longest utterances to rank them by loudness. It's a heuristic (closer to mic ≈ on camera), not ground truth — treat its `confidence` field as a gate for asking the user, not as license to skip asking.

If users report "the last word is cut off", "stutters are leaking through", or "wrong person's voice":
1. Confirm the user is testing the LATEST built project (CapCut suffixes duplicates with `-2`, `-3`, ...)
2. Check `temp/transcript-words-normalized-<videoname>.json` exists and has reasonable timestamps
3. Check `temp/ai-cuts.json` cut times match the actual word boundaries in the transcript, and that it was rebuilt (not stale from a previous video — see Step 3's warning)
4. Verify the build is pointing at `temp/normalized-<videoname>.mp4` (not the original source) — look at `material.path` in the produced `draft_content.json`
5. For a wrong-voice report specifically: re-run `diarize-speakers.ts`, sanity check the loudness numbers, and re-derive `ai-cuts.json` restricted to the correct speaker's utterance ranges before rebuilding

---

## Important rules

- **All paths must be absolute.**
- **Never paste API keys into chat.** They live in `.env` only. Don't ask the user to give them to you — ask them to save them in `.env`.
- **Run `analyze` (and `diarize-speakers`, when it needs a fresh API call) in background and wait for notification** — do not poll with `sleep`.
- **Always delete/overwrite `temp/ai-cuts.json` before starting a new video** — it's shared scratch space, not per-video state.
- The first run on each video does a one-time normalize (~1–3 min) and a fresh AssemblyAI call (both transcription and, if needed, diarization). Subsequent runs are instant.
- Project names auto-increment only if the exact requested name already exists in the CapCut drafts folder.
- Don't use `npx tsx -e` with inline imports — always invoke the script files.

## Dependencies

- Node.js 18+
- FFmpeg (full build, in PATH)
- AssemblyAI API key (free tier covers ~5 h/month — stored in `.env`; also used for diarization)
- Gemini API key (free tier, optional fallback transcriber — stored in `.env`)
- CapCut desktop (Windows or macOS) installed
