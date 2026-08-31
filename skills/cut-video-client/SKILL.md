---
name: cut-video-client
description: Turns raw client video footage into a CapCut project with silences, repeated takes, and off-camera/background voice removed, plus a hook text overlay. Verifies which speaker is actually on camera before cutting, so a director's or assistant's voice never gets used by mistake. Use when the user asks to "roughcut" a video, "edit this raw footage", "make a capcut project from this video", or hands over raw footage (with or without a script) to cut down for a client. Also handles a whole folder of unlabeled raw footage at once by matching each video's transcript against the client's Trello content queue to figure out its reel number and script.
version: 1.0.0
author: Igniting Studios
---

# cut-video-client

Created by Igniting Studios.

**Purpose:** turn raw, multi-take client footage into a ready-to-open CapCut project — silences and repeated takes gone, only the on-camera speaker's audio kept, hook text overlay added, project named to the studio's convention — without a human scrubbing through the raw file by hand.

Normalizes the source video, detects silence, transcribes with word-level timestamps, diarizes speakers to identify who's on camera, compares the transcript against the client's script when one is given, then writes the CapCut project.

## Trigger

Use this when the user hands over raw video footage and asks to roughcut, edit, or turn it into a CapCut project — with or without an accompanying script. Phrases like "roughcut this video", "edit this raw footage", "make a capcut project from this", "here's the footage and the script, cut it down". Can also be called directly by typing `/cut-video-client`.

**Default to Trello matching.** Raw footage almost never arrives pre-mapped to a script or reel number — the usual case is a folder of videos downloaded wholesale from Drive into `Downloads`, with filenames that don't correspond to any Trello card. So unless the user has *already stated* which script/reel a specific video belongs to in the same message, treat every run as a Trello-match run: read the client board's **Conteúdo** list first, transcribe the footage, and match transcript to card — whether it's one video or eighteen. See [reference/trello-match.md](reference/trello-match.md). Only skip straight to the manual path ([reference/find-and-name.md](reference/find-and-name.md)) when the user gave an explicit script + reel number up front, or Trello isn't reachable at all (no MCP connector, no API keys, and the user has no way to provide either).

## Named rules (apply through the whole run, no exceptions)

- **The Never Guess the Speaker Rule.** More than one voice in the footage means running the diarization check before any cut is written. An ambiguous or low-confidence result means STOP and ask the user which speaker is on camera — never assume the louder or cleaner-sounding take is the right person.
- **The Script Is Ground Truth Rule.** When a script is given, cuts must match its wording as closely as the on-camera speaker's actual takes allow. A wording deviation gets reported to the user, never silently smoothed over or hidden in a cut's `reason` field alone.
- **The One Video At A Time Rule.** `temp/ai-cuts.json` is shared scratch space, not per-video state. Never start reviewing or building a new video before the previous one's build has finished, and always clear it before a new video's `analyze` step.
- **The Confirm Before Building Rule.** No CapCut project gets written before the user has picked (or explicitly declined) a hook, and confirmed the client name / reel number if either was inferred rather than stated outright.
- **The Absolute Paths Rule.** Every path passed to a pipeline script is absolute, never relative — background tasks and the working directory can diverge.
- **The Trello Match Confidence Rule.** (Whenever matching against Trello — the default.) A video's REEL number and client are never assigned from a weak or ambiguous text match against the Trello content queue. A clear leading match still gets a quick confirm from the user; anything ambiguous means STOP and ask, quoting both sides. See [reference/trello-match.md](reference/trello-match.md).

## Mode (decide once at the start, never switch mid-run without re-confirming)

- **Setup already verified this session** (ffmpeg, node modules, `.env`, CapCut drafts folder all previously confirmed): skip straight to Step 1.
- **New session, or nothing verified yet:** run [reference/setup-checks.md](reference/setup-checks.md) first.

If something that was supposed to be verified turns out broken partway through (ffmpeg missing after all, wrong CapCut folder, corrupted `node_modules`), go back to setup checks instead of working around it in place — that's a sign the earlier verification was wrong or stale.

**Step 1 default vs. fallback.** Go to [reference/trello-match.md](reference/trello-match.md) **by default** — this is the normal path, for one video or many. Use [reference/find-and-name.md](reference/find-and-name.md) instead only when the user already stated the exact script + reel number for this footage in their request, or when Trello genuinely isn't reachable (no MCP connector and no `TRELLO_API_KEY`/`TRELLO_TOKEN`, and the user has neither to give). If Trello matching turns up nothing usable partway through (board/list not found, no candidate cards at all), fall back to [reference/find-and-name.md](reference/find-and-name.md) for that footage rather than stalling.

## Steps, load only the reference for the step in progress

| Step | What it does | Reference |
|---|---|---|
| 0 | One-time setup checks (ffmpeg, node modules, API keys, CapCut folder) | [reference/setup-checks.md](reference/setup-checks.md) |
| 1 | *(Default)* Read the Trello **Conteúdo** list, transcribe the footage, match each video to its card to derive script + `REEL-XX-NOME-DO-CLIENTE` | [reference/trello-match.md](reference/trello-match.md) |
| 1-fallback | *(Only when Trello isn't usable, or the user already gave the script/reel explicitly)* Ask directly for the video + script, decide the project name | [reference/find-and-name.md](reference/find-and-name.md) |
| 2 | Analyze the footage (normalize, silence detection, transcription) | [reference/analyze.md](reference/analyze.md) |
| 3 | Identify the on-camera speaker via diarization + loudness | [reference/speaker-check.md](reference/speaker-check.md) |
| 4 | Review the transcript and write `temp/ai-cuts.json` | [reference/cut-review.md](reference/cut-review.md) |
| 5 | Propose hook text overlay options | [reference/hooks.md](reference/hooks.md) |
| 6 | Build the CapCut project and report back | [reference/build.md](reference/build.md) |

No need to read every reference at once. Load the one for the step currently running. Step 1 and step 1-fallback are alternatives, not sequential — pick per the rule above and use the other's naming-confirmation output the same way going forward.

## If something breaks

See [INSTALL_AND_TROUBLESHOOTING.md](INSTALL_AND_TROUBLESHOOTING.md) for the pre-flight checklist and a table of known errors with their real root cause and fix — read it before improvising a workaround.
