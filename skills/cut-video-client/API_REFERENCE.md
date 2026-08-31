# API Reference

The real commands and endpoints behind each step of `WORKFLOW.md`. No browser automation is used anywhere in this pipeline — every step is either a local CLI call (FFmpeg) or a REST call (AssemblyAI). CapCut itself has no API; the project is produced by writing its project file format directly to disk.

## FFmpeg (local CLI, no API key)

**Normalize** (constant frame rate, H.264, rotation baked in, AAC 48kHz stereo):

```
ffmpeg -i <source> -vf "fps=30,format=yuv420p" -c:v libx264 -c:a aac -b:a 192k -ar 48000 -ac 2 <normalized-output>
```

**Extract mono audio for transcription/diarization** (WAV, source sample rate — MP3 or resampling shifts word timestamps by up to ~1s due to encoder priming/latency, so avoid both):

```
ffmpeg -i <normalized-video> -vn -ac 1 -c:a pcm_s16le <audio.wav>
```

**Measure a clip's loudness** (used by the speaker-diarization loudness heuristic):

```
ffmpeg -ss <start> -i <video> -t <duration> -af "volumedetect" -f null -
```

Parse `mean_volume: X dB` from stderr output.

**Probe stream layout** (sanity check for a dual-mic setup before trusting the loudness heuristic — if left/right channels carry genuinely different mic feeds rather than an identical downmix, that's a stronger signal than diarization loudness alone):

```
ffprobe -v error -show_entries stream=index,codec_type,codec_name,channels -of default=noprint_wrappers=0 <video>
```

## AssemblyAI (REST, requires `ASSEMBLYAI_API_KEY`)

Base URL: `https://api.assemblyai.com/v2`. Auth header: `authorization: <api-key>`.

**1. Upload the audio** (or pass a local file path directly if using the official SDK, which handles the upload internally):

```
POST /upload
Headers: authorization: <key>
Body: raw audio bytes
-> { "upload_url": "https://..." }
```

**2. Request a transcript** — word-level timestamps and speaker diarization both come from this single call:

```
POST /transcript
Headers: authorization: <key>, content-type: application/json
Body: {
  "audio_url": "<upload_url or public URL>",
  "speech_model": "universal-3-pro",
  "speaker_labels": true    // omit or false when diarization isn't needed
}
-> { "id": "<transcript_id>", "status": "queued" }
```

**3. Poll for completion:**

```
GET /transcript/<transcript_id>
-> { "status": "queued" | "processing" | "completed" | "error", ... }
```

**4. On `"completed"`, the response includes:**

- `words[]` — `{ text, start, end, confidence }` in **milliseconds**; convert to seconds by dividing by 1000.
- `utterances[]` (only when `speaker_labels: true` was requested) — `{ speaker, start, end, text }`, also in milliseconds. `speaker` is a short label (`"A"`, `"B"`, ...) assigned per detected voice cluster, not a real name — it's a clustering result, not identity, and can occasionally split one person's voice into two labels or merge two people into one when their voices are similar and the audio is noisy. Sanity-check with the loudness heuristic (see `WORKFLOW.md` step 4) rather than trusting the label count blindly.

Free tier covers roughly 5 hours of audio per month. The official Node SDK (`assemblyai` on npm) wraps all three calls above into a single `client.transcripts.transcribe({...})` call that also handles the upload step.

## Gemini (REST, optional, requires `GEMINI_API_KEY`)

Used only as a coarse sentence-level fallback transcriber, not for anything diarization- or cut-precision-related. Endpoint: `generativelanguage.googleapis.com`, model `gemini-2.5-flash` family. Skippable entirely — the pipeline falls back to AssemblyAI-only when this key is absent, it just logs a harmless "cannot transcribe" line for this layer. Not available in every region; if `https://aistudio.google.com/app/apikey` doesn't generate a key for the user, leave this key blank.

## CapCut project format (no API — a file format, not a service)

CapCut has no public API. A "project" is a directory under the drafts folder (`%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\<project-name>\` on Windows) containing a `draft_content.json` plus material references. The pipeline writes this JSON directly:

- `materials.videos[]` — references the **normalized** video file by absolute path (`material.path`) — never the original raw source. If a rebuilt project still shows old audio/cuts, check this path first; it usually means the build pointed at a stale cache.
- `tracks[]` — one video track built from the kept time ranges (post-cut), one text track carrying the hook overlay (if any) with its own animation and duration.
- `materials.material_animations[]` — the hook text's entrance/exit animation definition, referenced by ID from the text segment.

This format is undocumented and reverse-engineered — treat any structural change to it as something to verify against a real CapCut open, not just JSON validity.
