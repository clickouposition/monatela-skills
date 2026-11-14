# Step 4 — AI cut review

Read the cached word-level transcript at `<skill-dir>/temp/transcript-words-normalized-<videoname>.json` — every word with `{text, start, end}` in seconds, accurate to the normalized video the build step references directly.

Restrict every candidate take to the on-camera speaker's time ranges from [speaker-check.md](speaker-check.md) before doing anything else with the transcript.

## With a script

Go line by line: find every take of that line in the transcript (on-camera speaker only), and pick the one whose wording is closest to the script, breaking ties toward the cleaner/later take. It's normal for **zero** takes to match a line word-for-word once filtered to the correct speaker — pick the closest available one and tell the user about the deviation, rather than reaching for an off-camera take just because its wording happens to be exact. If a script line was never actually recorded by anyone, say so plainly instead of inventing a cut for it.

## Without a script (or on top of script matching)

Look for:
- **Repeated phrases** — the speaker says the same thing twice; keep the LATER/cleaner version, unless a script says otherwise
- **False starts** — "I want to— so what I mean is..."
- **Standalone fillers** — "So", "Okay", "Alright" said alone before the real sentence starts
- **Stretched/stuttered words** — a single word with abnormally long duration often means a stutter the speaker glossed over
- **Trailing/abandoned sentences** — incomplete thoughts the speaker dropped
- **Self-corrections** — "the API is— I mean, the SDK is..."
- **Off-topic banter** — director/crew chatter, meta-commentary about the script or the take ("did I already say that?", "let's do it again"), phone-call asides — none of this is script content even when it's the correct speaker talking

## Writing the cuts

For each transition, append to `<skill-dir>/temp/ai-cuts.json` as a JSON array:

```json
[
  {"startSec": 24.38, "endSec": 25.46, "reason": "off-camera speaker prompting the line, not the on-camera subject"},
  {"startSec": 32.07, "endSec": 34.02, "reason": "stretched 'And then' stutter — keep starting at 'I trained it'"}
]
```

**Placement rules:**
- `startSec` = the `start` of the first word being cut.
- `endSec` = the `start` of the first word being **kept** after the cut (not the `end` of the last cut word — that leaks the kept word's onset into the cut).
- If a kept sentence ends with a different word than what follows, leave the natural silence gap between them uncut — the pipeline preserves it on its own.
- When in doubt, **don't cut** — a false positive (cutting something that should stay) is worse than a missed repeat.
- Cuts must land on word boundaries — never mid-word.

**This list must be complete.** When `build` runs with a non-empty `ai-cuts.json`, it uses those cuts as the **sole** repeat source — every rule-based detector in the pipeline is skipped entirely. There is no automatic second pass filling in what you missed.

## Alternative: build straight from a keep list

When the cut is decided take by take (a director prompts every line and the talent repeats it, so the cut is "these takes, in this order"), skip `ai-cuts.json` and `build`:

1. Split the transcript into sentences and label each by peak loudness — the on-camera speaker is ~10 dB louder than an off-camera prompter (C0513/C0514: Lívia −19…−31 dB, prompter −33…−41 dB). Diarization utterances lump prompt + repeat together, so don't trust them alone.
2. Pick the last clean on-camera take of each script line; write `temp/keeps-<video>.json` = `[[firstWordStart, lastWordEnd], …]` in timeline order.
3. Check every kept take's peak level again — a take at the prompter's level is the prompter, swap it.
4. `npx tsx src/build-ranges.ts "<video>" REEL-XX-NOME "<keeps.json>"` — edges snap to the waveform without crossing into neighbouring words, never cut a soft last word, no hook track. The editor wants tight sentence endings: add `--end-db=-30 --pad-out=0.05` (drops the voice's fading tail).

Then go to [full-edit.md](full-edit.md) with `--keep-cuts`.

Move to [hooks.md](hooks.md).
