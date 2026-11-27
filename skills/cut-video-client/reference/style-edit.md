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

If the pre-flight fails, style-edit stops before writing anything. The usual cause is the client font missing on this machine. Tell the user exactly which file to copy into `<studio>/FONTES`. **Never substitute another font**: the captions would silently render in the wrong typeface. If the user wants the edit now anyway, add `--font-pending`: everything is built and the captions use CapCut's default font. Once the font file is in `<studio>/FONTES`, run `npx tsx src/set-caption-font.ts <project> --client=<CLIENT>`. It swaps only the caption font and keeps every change the editor made by hand (backup in `temp/backups/`). On macOS, also copy the font to `~/Library/Fonts` so CapCut lists it.

## What it does

| Element | Rule |
|---|---|
| Cut safety | Each clip is trimmed to the first cut of `temp/ai-cuts-<video>.json` inside it, then the timeline is closed up. The rough builder's padding can run up to ~0.8 s past a cut start and leak the director's next line. A word starting in a clip's last 0.12 s is treated as the next take's onset: no caption. |
| Captions | `wordsPerCaption` words at a time (the studio default is 1, word by word), in the profile's font, size, letter spacing, colour, shadow and case, at `captions.y`. Each caption lasts until the next word, at most 0.6 s past its own word. |
| Zooms | Clips alternate 1.0 ↔ `zoom.punch`, anchored on the eye line. Clips longer than `splitClipsLongerThanSec` get an internal zoom cut at their widest word gap. |
| Transition | `flash.*` from the profile, laid over the cut nearest ⅓ and ⅔ of the reel (½ when ≤ 40 s). Default: a white flash (`TRANSICTIONS/White.mov`), whole clip, starting 2 frames before the cut. A client can use any clip with its own in-point, length, lead, scale and volume. Fran: film burn, 10 frames from 1.033 s, starting 5 frames before the cut, scale 4.47. |
| SFX | Boom at 0; a whoosh on the first two punch-ins; a pop on every other zoom-out (max 2); one riser into the first transition; "Transition 2" on every transition; a pop-up on the call-to-action caption. No clicks: the click file holds a run of many clicks. Every effect is at CapCut volume `sfx.volumeDb` (−12 dB), at least 1 s from another accent, spread over as many audio tracks as overlaps need. This pattern comes from the editor's hand pass on REEL-01. |
| Pauses | Clip edges are cut on the **waveform**, not on the transcript: AssemblyAI word ends can run 0.3–0.5 s past the real end of speech. Threshold = the clip's speech level (p80) − 20 dB; 0.04 s kept before the voice onset and 0.07 s after its decay, never more than the transcript allows (0.08 s / 0.15 s). The same applies at internal zoom cuts. Check: no clip edge should hold more than ~0.2 s of silence. **False starts:** a clip that ends on the same word the next clip opens with, after a sentence end or a pause (`…carta de alta. Então` \| `Então a carta…`), loses that word. Listed as `falseStartsDropped`. |
| Slow push-in | The longest unzoomed clip of 3–7 s eases 1.0 → 1.07 on the eye line (keyframes on source time). |
| Colour | **Use `--grade=auto`** ([src/auto-grade.ts](../src/auto-grade.ts)): the values are measured per video on 12 frames of the kept clips, never reused between videos. Neutrals (low-saturation mid-tones) set **tone** (green↔magenta) and **temperature** to remove ~⅔ of the cast toward Rec.709 white. Skin hue then nudges temperature: Rec.709 skin band is ~18–24°, so below 14° (pink/pale) goes warmer and above 26° (orange) cooler. **Brightness** moves only if skin luma is outside 0.45–0.58, by at most ±3. **Highlights** are only pulled down when > 0.5% of pixels clip, never pushed up. **Saturation** gets a light lift (≤ +4) only if skin saturation < 0.36. The output prints the slider values and the measurement. **Never** push brightness or whites by habit: on dark-background footage it blows the skin out (user feedback). `--grade=type:value,…` still forces manual values. The adjust effect comes from a draft that uses one, or from CapCut's cache (`Cache/effect/7501974767453474064`, downloaded the first time Ajustar is opened). |
| SFX sync | Each SFX file is measured: its **peak** (strike), its onset and where it decays (−45 dB). The lead-in before the onset and the tail after the decay are trimmed, and the clip slides so the **peak lands on the target**: the picture cut for whoosh, pop, riser and Transition 2, the caption start for the pop-up. Measured peaks: whoosh 0.86 s, riser 0.79 s, Transition 2 0.59 s, pop 0.06 s, pop-up 1.99 s. Placing the file start on the cut sounds late, and a pop-up placed near the end never plays. Targets are the **final** picture cuts, after trims and J-cuts. Any change to the cut means re-running style-edit, never moving clips without moving their SFX. |
| Voice | CapCut volume `voice.volumeDb` (−6 dB). |
| J-cuts | The voice moves to its own audio track (the WAV from analyze, video muted). At every real cut (not at internal zoom cuts), the picture cuts 4 frames after the audio, so the next line's voice leads its picture. |
| Not added | Hook text, music, slow push-in, colour grade and highlighted titles. Use full-edit for those, or the editor adds them. |

## Report back

Give the user:
- the project name, duration, the zoom pattern, the flash times and the SFX list;
- any wording deviations from the script that the rough cut kept;
- a reminder to check the caption **shadow** in CapCut once. The JSON fields for blur and spacing are inferred from CapCut's sliders and haven't been verified against a hand-made project.

## Learning from the editor's hand pass

When the editor fixes one reel by hand and asks for the others to match, compare that project's `draft_content.json` with its `draft_info.json`. CapCut 9.9 saves to `draft_info.json`, so `draft_content.json` still holds what style-edit wrote. Turn each difference into a rule or a profile value, never a one-off patch: transition clip and timing go in `flash.*`, SFX placement and selection in the SFX rules above, and cut fixes in the clip-edge rules. Keep the editor's reel as it is (only `set-caption-font.ts` if needed), and regenerate the reels they didn't touch.
