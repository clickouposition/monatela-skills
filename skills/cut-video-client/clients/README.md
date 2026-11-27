# Client style profiles

**Profiles are local.** The repo only ships `_TEMPLATE.json`; each client's real profile is filled in the first time that client is edited on a machine and stays there (`clients/.gitignore` keeps every other `*.json` out of git). Back up the `clients/` folder with the studio folder if you move machines.

One JSON file per client: `clients/<CLIENT>.json`, where `<CLIENT>` is exactly the `NOME-DO-CLIENTE` part of the project name (`REEL-XX-<CLIENT>`). Every client has their own caption font, size, colour, shadow and zoom strength. The profile is the single source of truth for those values, so any machine produces the same edit.

`style-edit.ts` reads the profile. `full-edit.ts` doesn't need one, because it clones the look from a CapCut project the editor finished by hand.

## Check a profile on this machine

```bash
npx tsx src/client-profile.ts <CLIENT>
```

The output lists each asset as `OK` or `MISSING`, with the fix for anything missing. `style-edit.ts` runs the same check first and **refuses to write a project** if anything is missing. A missing font is the usual case on a new machine, because CapCut needs the font **file**. With only the font name, it silently falls back to its default font.

Fonts are searched, in this order, in:

1. `$MONATELA_FONTS_DIR`, default `<studio>/FONTES`
2. the OS font folders:
   - macOS: `~/Library/Fonts`, `/Library/Fonts`, `/System/Library/Fonts`, and the Microsoft Office app bundles (`/Applications/Microsoft Word.app/Contents/Resources/DFonts`, …)
   - Windows: `C:\Windows\Fonts` and `%LOCALAPPDATA%\Microsoft\Windows\Fonts`

`<studio>` is `$MONATELA_DIR`, default `~/Desktop/MONATELA`. The SFX (`SX/`), the transitions (`TRANSICTIONS/`) and the fonts (`FONTES/`) live there. Keep that folder synced between machines.

## Fields

| Field | Meaning |
|---|---|
| `client` | Same as the file name. |
| `projectPattern` | CapCut project name, e.g. `REEL-XX-FRANCIS-DHIENE-ADVOGADA`. |
| `trelloBoard` | The client's Trello board, used to match footage to scripts. |
| `captions.font` | Font name as CapCut shows it. Used only for messages. |
| `captions.fontFiles` | File names to look for, in order. Windows, macOS and Office spell them differently (Candara Light = `Candaral.ttf` on Windows/Office). |
| `captions.size` | CapCut text size (the "Tamanho" slider). |
| `captions.letterSpacing` | CapCut "Caractere" slider value. |
| `captions.color` | Text colour, `#RRGGBB`. |
| `captions.case` | `lower`, `upper` or `as-spoken`. |
| `captions.stripPunctuation` | `true` drops `.,!?;:` and quotes. |
| `captions.wordsPerCaption` | How many words appear at a time. `1` means word by word. |
| `captions.y` | Vertical position in CapCut canvas units (−1 bottom … 0 centre … 1 top). To measure it from a finished reel: take the caption's row `r` in px of a 1920-tall frame, then `y = 1 − 2r/1920`. |
| `captions.shadow` | CapCut shadow sliders: `opacity` (0–100), `blur` (the "Indefinição" slider), `distance`, `angle` (degrees), `color`. |
| `zoom.punch` | Punch-in scale on alternating clips, e.g. `1.18`. |
| `zoom.splitClipsLongerThanSec` | Clips longer than this get an extra zoom cut at their widest word gap. |
| `flash.file` | Transition clip laid over the cut nearest ⅓ and ⅔ (½ for reels ≤ 40 s). Relative paths resolve inside `<studio>`. |
| `flash.srcStart`, `flash.frames`, `flash.leadFrames` | Optional. In-point inside the clip (s), its length on the timeline (frames at 30 fps), and how many frames it starts before the cut. Defaults: whole clip, 2 frames. |
| `flash.scale`, `flash.volume`, `flash.trackFlag` | Optional. CapCut scale (a 16:9 clip needs > 3.16 to cover the 9:16 canvas), the clip's own audio (linear, default 0 = muted), and the track flag. Copy them from a project the editor fixed by hand. |
| `sfx.volumeDb` | CapCut volume (dB) set on every SFX clip. Studio default −12. |
| `voice.volumeDb` | CapCut volume (dB) on the voice track. Studio default −6. |

## First edit of a client on this machine

1. Get the client's identity from the editor: font, size, letter spacing, colour, shadow (opacity, blur, distance, angle), and words per caption. If there's a finished reel, measure `captions.y` and the flash timing from it. To spot the flash frames: `ffmpeg … -vf scale=16:16,format=gray`, then look for frames with a mean above 200.
2. `cp clients/_TEMPLATE.json clients/<CLIENT>.json` and replace every placeholder. The loader refuses a profile that still has template values.
3. Put the font file in `<studio>/FONTES` and run `npx tsx src/client-profile.ts <CLIENT>` until every item is `OK`.
4. Don't commit the profile or the font. Profiles are per-machine by design, and fonts are licensed.
