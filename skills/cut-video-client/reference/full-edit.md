# Step 7 (optional) — Full edit on top of a rough cut

Use when the user asks Claude to *edit* (not just roughcut) a video whose rough-cut CapCut project already exists. Runs after [build.md](build.md), or on any rough project the editor cut by hand.

```bash
cd <skill-dir>
npx tsx src/full-edit.ts "<rough-project>" "<style-project>" <eyeX> <eyeY>
```

- **rough-project** — the CapCut project to edit (e.g. `REEL-03-NOME-DO-CLIENTE`). Never modified; the result is written as `<rough-project>-EDITADO` (`-EDITADO-2`, … if taken).
- **style-project** — a project of the **same client** that the editor finished by hand. Captions, the flash transition, SFX segments and keyframe curves are cloned from it, so fonts, shadow, caption template and position match exactly.
- **eyeX / eyeY** — the speaker's eye line in CapCut canvas units (−1..1, +y up, 0 = centre). Measure it once per recording: grab a frame with ffmpeg, find the eye row `r` (px, of 1920) and column `c` (px, of 1080), then `eyeY = 1 − 2r/1920`, `eyeX = 2c/1080 − 1`. Zooms are anchored there so the eyes don't move when the frame punches in.

- **caption-font.ttf** *(optional)* — overrides the caption font, for a client with no finished project of their own whose style is borrowed from another client (e.g. another client's finished project + `<fonts folder>/Poppins-Regular.ttf`).

- **--tail=S** — silence kept after a sentence (default 0.3, calibrated on an editor's own fixes). **--max-pause=S** — pauses longer than this *inside* a clip are cut out (default: off). When the editor wants tight joins: `--tail=0.12 --max-pause=0.3` → 0–0.16 s of silence per join.
- **--speaker=X** — the on-camera diarization label, when the loudness guess is unsure.
- **--center** — puts the speaker on the vertical centre line: a small base zoom (1 / (1 − |eyeX|)) lets the picture shift sideways without borders, and every punch-in keeps the eyes centred and level. Use it when the speaker sits off-centre (e.g. eyeX 0.066 → base 1.076).
- **--grade=type:value,…** — color correction with CapCut's basic adjustments on every speaker clip (value = slider ÷ 50, so −1…1; types: temperature, tone, brightness, contrast, saturation, shadow, white, black, light_sensation, sharpen, clear). Decide the values from the footage, not by habit: measure a few frames (face RGB — skin normally has B ≈ 0.85 × G; luma median/p99; mean saturation), check the direction with an ffmpeg mock (colortemperature + eq + curves), keep it moderate. Example (cool skin, dark and flat footage): `temperature:0.16,brightness:0.14,contrast:0.14,shadow:0.12,saturation:0.1,sharpen:0.16`.
- **--sfx-from=PROJECT** — take the SFX segment template from another project when the style project has no `SX` clips (e.g. `--sfx-from=<another finished project>`).
- **--in-place** — write into the editor's own project instead of a `-EDITADO` copy (use when they say "edit mine"). The original is backed up to `temp/backups/<project>-<timestamp>` first, and a project this script already edited is refused (re-running would treat the J-cut shifts as cuts) — restore the backup to redo it. CapCut must not have the project open while it's written.
- **--keep-cuts** — the editor cut this project themselves: use its clips exactly (no waveform refinement, no off-camera removal, no pause cuts) and only add captions, zooms, J-cuts, flash and SFX. **Use this whenever the user says the cut is already done.** The automatic off-camera check has misfired (it once flagged one of the talent's own lines as the director's), so the editor's cut always wins.

**Off-camera voice (director prompting lines).** If `temp/diarized-<video>.json` exists, every phrase that diarization gives to another speaker is checked: if the same words were said ≥ 1 dB louder within ±8 s (director reads the line, talent repeats it), the phrase is swapped for that take; otherwise a phrase ≥ 0.6 s peaking at the off-camera level is dropped. Diarization alone lumps prompt + repeat together, so it is never trusted on its own. Report every removal — a single take where the director fed the first words (e.g. "e sem…") leaves the sentence starting mid-way, and the editor must hear it. `DEBUG_SPEAKER=1` prints the per-phrase speaker/peak table.

Needs `temp/transcript-words-<video>.json` and `temp/audio-<video>.wav` from [analyze.md](analyze.md).

## What it does

| Element | Rule |
|---|---|
| Cut precision | Every rough-cut boundary is re-snapped to the waveform (10 ms frames, speech > −38 dB): head ~40 ms before the voice rises (recovers clipped first words, drops leading silence); tail keeps 0.3 s of decay or stops 0.25 s before the next take; a clipped last word is extended, the next take's first syllable and cut-off words ("—") are dropped; never trims into a soft-spoken last word. Calibrated on the editor's own fixes to a reel (median 77 ms from the editor vs 133 ms for the rough cut). |
| Captions | Cloned caption template (the editor's favourite: "弹出-粗体阴影") + client font; lowercase, no punctuation, acronyms kept; ≤ 6 words / 2.6 s; lone words folded into the previous caption. **Per-word timings are written** — the template reveals one word at a time from them; without them the whole line pops in. |
| Zooms | Clips alternate 1.0 ↔ 1.12–1.25, anchored on the eye line; clips > 6 s get an internal zoom cut at a word gap; one slow push-in (1.0 → 1.07). |
| J-cuts | Voice moves to its own audio track (video muted); at every real cut the next clip's audio leads its picture by 4 frames. |
| Transitions | Flash preset + riser, low riser and "Transition 2" at ~⅓ and ~⅔ (one at ½ for videos ≤ 40 s), same volumes/offsets as the style project. |
| SFX levels | **Every effect peaks at −12 dBFS** (`--sfx-peak`, default −12): the editor mixes the voice at −6 dB and the music at −12 dB. Each clip's volume is computed from the measured peak of the exact source window used (gain capped at CapCut's +20 dB). |
| Title clicks | A mouse click the moment each line of a highlighted title appears (top / big / bottom). |
| SFX | Low boom at the open; whoosh on up to two punch-in cuts; a mouse/button click on every other punch-in, a soft pop on zoom-outs, a pop-up on the call-to-action caption and a short whoosh into the slow push-in — never within 1 s of another accent. Files from the studio's SX folder: `MONATELA_SFX_DIR`, default `%USERPROFILE%\Desktop\MONATELA\SX`. |
| Not added | Hook text, music, b-roll, audio treatment — the editor does these. |

## Highlighted titles

The editor likes dynamic "small / **BIG** / small" titles (CapCut preset **Minhas predefinições5**: Rosario Light / Montserrat ExtraBold, blur in-out, lines enter at 0 / 0.46 / 0.88 s). Pick 2–4 punchlines per reel and write `temp/titles-<video>.json`:

```json
[{ "match": "pagando imposto mais caro", "top": "pagando", "big": "imposto", "bottom": "mais caro" }]
```

`match` is the spoken phrase (only words actually said, in order). Layout, as in the editor's reference ("para / **advogados** / de todo Brasil"):

- each line's real width is measured in the preset's fonts (`src/measure-text.ts`, calibrated on the preset itself — the two alignment equations agree within 3 %);
- the top line starts at the big word's left edge, the bottom line ends at its right edge; a big word wider than the frame is scaled down;
- letters must not touch: each line is drawn where it lands and a small line that collides with the big word (e.g. "pagando" over the dot of "imposto") is nudged away just enough;
- the whole block is centred on screen.

The title stays for its phrase + 0.3 s (≥ 1.4 s). **No running caption is on screen while a title shows** — captions are trimmed around it (any that would vanish entirely are listed under `captionsHiddenByTitles`). Another preset: `--title-preset="<name>"`. Every compound clip (flash, titles) is also written to `<project>/subdraft/<id>/`. A drawtext mock of the titles (preset + generated) is a quick way to eyeball the layout before the editor opens CapCut.

## Transcription fixes

When a caption is garbled, add `temp/caption-fixes-<video>.json`:

```json
[{ "from": "que eu tiajude entendê", "to": "que eu te ajudo a entender" }]
```

It is applied to the transcript's word stream on every run (case- and punctuation-insensitive, so it holds wherever the captions break); the new words are spread evenly over the replaced span. Collapsed word timings from the transcriber (runs of ~20 ms words) are spread automatically.

## Report back

Tell the user the project name, and flag what needs their eye: rough-cut issues the edit kept (repeated phrases, words cut mid-way), caption fixes applied, and that J-cuts briefly show the next take's first syllable muted. If CapCut was open, the new project may need a CapCut restart to appear.
