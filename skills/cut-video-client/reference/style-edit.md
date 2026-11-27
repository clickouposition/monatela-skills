# Step 7b — Full edit from a client profile (no style project)

Use this step when the user asks for the full edit (captions, zooms, transitions, SFX) and **no CapCut project the editor finished by hand for this client is available on this machine**. That happens on a new or replacement machine, or when only the exported `.mp4` of past reels exists, as is the case in Drive.

If such a project exists, prefer [full-edit.md](full-edit.md), because it clones the exact CapCut presets. This step rebuilds the same look from `clients/<CLIENT>.json`. See [../clients/README.md](../clients/README.md).

## Run

```bash
cd <skill-dir>
npx tsx src/client-profile.ts <CLIENT>          # pre-flight: every line must be OK
npx tsx src/style-edit.ts "<rough-project>" <video-basename> <eyeX> <eyeY> --client=<CLIENT>
```

- **rough-project**: the project written by [build.md](build.md), e.g. `REEL-03-FRANCIS-DHIENE-ADVOGADA`. It is never modified. The result is `<rough-project>-EDITADO` (or `-EDITADO-2`, … if that name is taken).
- **video-basename**: the raw file name without extension (`C0531`). It locates `temp/transcript-words-normalized-<video>.json` and `temp/ai-cuts-<video>.json`.
- **eyeX / eyeY**: the speaker's eye line in canvas units. Measure it once per recording:
  1. Grab a frame of `temp/normalized-<video>.mp4`.
  2. Find the row `r` and column `c` of the eyes, in px of the 1080×1920 frame.
  3. Compute `eyeY = 1 − 2r/1920` and `eyeX = 2c/1080 − 1`.

  Zooms are anchored there so the face doesn't jump.

**First time for a client on this machine:** there's no `clients/<CLIENT>.json` yet, because profiles are local and never in the repo. Ask the user for the client's identity (caption font, size, letter spacing, colour, shadow opacity / blur / distance / angle, and words per caption). Then copy `clients/_TEMPLATE.json` to `clients/<CLIENT>.json`, fill it in, and run the pre-flight.

If the pre-flight fails, style-edit stops before writing anything. The usual cause is the client font missing on this machine. Tell the user exactly which file to copy into `<studio>/FONTES`. **Never substitute another font**: the captions would silently render in the wrong typeface. If the user wants the edit now anyway, add `--font-pending`: everything is built and the captions use CapCut's default font. Tell the user, and re-run style-edit (it writes `-EDITADO-2`) once the font file is in `<studio>/FONTES`.

## What it does

| Element | Rule |
|---|---|
| Cut safety | Each clip is trimmed to the first cut of `temp/ai-cuts-<video>.json` inside it, then the timeline is closed up. The rough builder's padding can run up to ~0.8 s past a cut start and leak the director's next line. A word starting in a clip's last 0.12 s is treated as the next take's onset: no caption. |
| Captions | `wordsPerCaption` words at a time (the studio default is 1, word by word), in the profile's font, size, letter spacing, colour, shadow and case, at `captions.y`. Each caption lasts until the next word, at most 0.6 s past its own word. |
| Zooms | Clips alternate 1.0 ↔ `zoom.punch`, anchored on the eye line. Clips longer than `splitClipsLongerThanSec` get an internal zoom cut at their widest word gap. |
| Flash | `flash.file` is laid over the cut nearest ⅓ and ⅔ of the reel (½ when ≤ 40 s), starting 2 frames before the cut. Measured on a finished reel, the flash sits at 13.5 s and 29.0 s of 47 s: 4 white frames that then fade. |
| SFX | Boom at 0, riser ending on each flash, "Transition 2" on the flash, a whoosh on the first two punch-ins, a click on every other punch-in, a pop on zoom-outs, and a pop-up near the last words. Every effect gets CapCut volume `sfx.volumeDb` (−12 dB), never within 1 s of another accent, and spread over as many audio tracks as overlaps need. |
| Pauses | Clip edges are cut on the **waveform**, not on the transcript: AssemblyAI word ends can run 0.3–0.5 s past the real end of speech. Threshold = the clip's speech level (p80) − 20 dB; 0.04 s kept before the voice onset and 0.07 s after its decay, never more than the transcript allows (0.08 s / 0.15 s). The same applies at internal zoom cuts. Check: no clip edge should hold more than ~0.2 s of silence. |
| Slow push-in | The longest unzoomed clip of 3–7 s eases 1.0 → 1.07 on the eye line (keyframes on source time). |
| Colour | `--grade=type:value,…` (slider ÷ 50), same types as full-edit. Measure the footage first: skin B/G ≈ 0.85 is neutral, plus luma median/p99 and saturation. The adjust effect is cloned from a draft where CapCut already used one. If no draft has one, the cached effect (Cache/effect/7501974767453474064, downloaded when Ajustar is first opened in CapCut) is used. If neither exists, the grade is skipped with a warning. |
| SFX sync | Every accent is computed from the **final picture cuts**, after trims and J-cuts: zoom SFX on the cut (whoosh 0.15 s before), transition and riser on the flash's first white frame. Any change to the cut means re-running style-edit, never moving clips by hand without moving the SFX. |
| Voice | CapCut volume `voice.volumeDb` (−6 dB). |
| J-cuts | The voice moves to its own audio track (the WAV from analyze, video muted). At every real cut (not at internal zoom cuts), the picture cuts 4 frames after the audio, so the next line's voice leads its picture. |
| Not added | Hook text, music, slow push-in, colour grade and highlighted titles. Use full-edit for those, or the editor adds them. |

## Report back

Give the user:
- the project name, duration, the zoom pattern, the flash times and the SFX list;
- any wording deviations from the script that the rough cut kept;
- a reminder to check the caption **shadow** in CapCut once. The JSON fields for blur and spacing are inferred from CapCut's sliders and haven't been verified against a hand-made project.
