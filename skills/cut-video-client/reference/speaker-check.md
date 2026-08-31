# Step 3 — Identify the on-camera speaker

**Mandatory whenever more than one voice is present in the footage.** This step exists because of a real failure: a finished cut was built entirely from an off-camera director's voice instead of the on-camera client's, because nothing in the pipeline checked *who* was talking before picking the "cleanest-sounding" take.

A single camera or room mic picks up everyone nearby — a director prompting lines, an assistant, a phone call bleeding through. **Never assume the loudest or most "confident-sounding" take is the right person without checking.** Cutting together a video where the audio doesn't belong to the person on screen is a hard failure, not a style choice — it fails regardless of how clean the edit otherwise is.

## Running the check

```bash
cd <skill-dir>
npx tsx src/diarize-speakers.ts "<skill-dir>/temp/normalized-<videoname>.mp4"
```

The normalized video must already exist — [analyze.md](analyze.md) creates it. This diarizes the audio into speaker labels via AssemblyAI (`speaker_labels: true`) and measures each speaker's average loudness with `ffmpeg volumedetect`, on the theory that the person being filmed is almost always closest to the mic and therefore louder. It prints a JSON report:

```json
{
  "speakers": ["A", "B"],
  "avgLoudnessDb": { "A": -40.3, "B": -27.5 },
  "onCameraSpeaker": "B",
  "loudnessGapDb": 12.8,
  "confidence": "high",
  "utterances": [ { "speaker": "A", "start": 2.4, "end": 10.5, "text": "..." }, ... ]
}
```

## Reading the result

- **Only one speaker detected** → nothing to disambiguate. Proceed to [cut-review.md](cut-review.md) normally.
- **`confidence: "high"`** (loudness gap ≥ 5 dB) → proceed, using `onCameraSpeaker`'s utterance ranges as the only valid source for kept segments in the next step. Still name the speaker and the loudness gap in your final summary to the user, so a wrong call is easy to catch.
- **`confidence: "medium"`** (gap ≥ 2 dB) **or `"low"`/`"unknown"`** (smaller gap, or volume detection failed) → **stop and ask the user** which speaker is on camera before writing a single cut. Quote them a couple of sample lines per speaker (from `utterances`) so they can recognize which is which. Don't guess past this point.
- **The result contradicts what the user already told you about the footage** (e.g. they described a solo talking-head video but two speakers were detected) → also stop and ask, regardless of the confidence number.

## Using the result

Once the on-camera speaker is identified, **every kept segment in [cut-review.md](cut-review.md) must come from that speaker's utterance time ranges only.** A take that matches the script perfectly but belongs to the wrong speaker is not usable — prefer the on-camera speaker's next-best take over the off-camera speaker's exact match, and report the resulting wording deviation to the user rather than silently downgrading quality to hit a better wording match.

Move to [cut-review.md](cut-review.md).
