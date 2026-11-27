/**
 * style-edit — full edit from a CLIENT PROFILE, without a style project.
 *
 * full-edit.ts clones captions/flash/SFX from a CapCut project the editor finished by
 * hand. When that project isn't on this machine, style-edit rebuilds the same look
 * from clients/<CLIENT>.json (font, size, spacing, shadow, colour, zoom, flash):
 *   - captions: N words at a time (profile), case/punctuation per profile
 *   - zooms: clips alternate 1.0 ↔ punch-in, anchored on the eye line; long clips get
 *     an internal zoom cut at the widest word gap
 *   - flash: the profile's flash clip over the cut nearest ⅓ and ⅔ (one at ½ if ≤ 40 s)
 *   - SFX: boom at the open, riser + "Transition 2" into each flash, whoosh/click on
 *     punch-ins, pop on zoom-outs, pop-up near the end; every effect at the
 *     profile's CapCut volume (−12 dB), voice at −6 dB; never within 1 s of another accent
 * Every clip is first trimmed to temp/ai-cuts-<video>.json so the builder's padding
 * can't leak the director's next line.
 *
 *   npx tsx src/style-edit.ts <rough-project> <video-basename> <eyeX> <eyeY> --client=<CLIENT>
 *
 * Refuses to write anything when the pre-flight check fails (font missing, etc.).
 * Writes <rough-project>-EDITADO next to the original (never modifies the rough one).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
const probeDurEarly = (f: string) => parseFloat(execSync(`"${findFfprobe(true)}" -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString());
import { CAPCUT_USER_DATA, findFfprobe } from "./ffmpeg.js";
import { loadProfile, checkProfile, printCheck, resolveFont, resolveStudioPath, hexToRgb, STUDIO_DIR } from "./client-profile.js";
import { SFX_FILES, type SfxKey } from "./style-edit-sfx.js";

type Json = any;
const args = process.argv.slice(2);
const flag = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const [roughName, videoBase, eyeXArg, eyeYArg] = args.filter((a) => !a.startsWith("--"));
if (!roughName || !videoBase || eyeXArg === undefined || eyeYArg === undefined || !flag("client")) {
  console.error("Usage: npx tsx src/style-edit.ts <rough-project> <video-basename> <eyeX> <eyeY> --client=<CLIENT>");
  process.exit(1);
}
const profile = loadProfile(flag("client")!);
console.log(`Pre-flight for ${profile.client}:`);
const checks = checkProfile(profile, Object.values(SFX_FILES));
printCheck(checks);
// --font-pending: build everything now, captions in CapCut's default font until the font file arrives
const FONT_PENDING = args.includes("--font-pending");
const blocking = checks.filter((c) => !c.ok && !(FONT_PENDING && c.what === "caption font"));
if (blocking.length) {
  console.error("\nFix the MISSING items above, then re-run (or --font-pending if only the font is missing). Nothing was written.");
  process.exit(1);
}
if (FONT_PENDING && !resolveFont(profile)) console.warn(`\n⚠ --font-pending: captions use CapCut's default font, not ${profile.captions.font}. Re-run once the font file is in FONTES.`);
const DRAFTS = path.join(CAPCUT_USER_DATA, "Projects/com.lveditor.draft");
const TEMP = path.resolve(import.meta.dirname, "..", "temp");
const SFX_DIR = process.env.MONATELA_SFX_DIR ?? path.join(STUDIO_DIR, "SX");
const FLASH_FILE = resolveStudioPath(profile.flash.file);
const FONT = resolveFont(profile) ?? "";
const J_CUT_US = 4 * (1_000_000 / 30); // next clip's voice leads its picture by 4 frames
const cap = profile.captions;
const SIZE = cap.size;
const SPACING = cap.letterSpacing;
const sh = { alpha: cap.shadow.opacity, blur: cap.shadow.blur, distance: cap.shadow.distance, angle: cap.shadow.angle };
const CAPTION_Y = cap.y;
const PUNCH = profile.zoom.punch;
const EYE = { x: parseFloat(eyeXArg), y: parseFloat(eyeYArg) };
// CapCut volume slider values (dB): every SFX clip at sfx.volumeDb, the voice at voice.volumeDb
const SFX_VOL = Math.pow(10, (profile.sfx.volumeDb ?? -12) / 20);
const VOICE_VOL = Math.pow(10, (profile.voice?.volumeDb ?? -6) / 20);
const HEAD_PAD = 0.08, TAIL_PAD = 0.15; // upper bounds from the transcript; the waveform tightens them
const ENERGY_HEAD = 0.04, ENERGY_TAIL = 0.07; // kept around the measured voice onset / offset

const MICRO = 1_000_000;
const FRAME = MICRO / 30;
const snap = (us: number) => Math.round(us / FRAME) * FRAME;
const uuid = () => randomUUID().toUpperCase();
const sec = (us: number) => us / MICRO;

// ─── load ────────────────────────────────────────────────────────────────
const srcDir = path.join(DRAFTS, roughName);
const srcFile = ["draft_info.json", "draft_content.json"].map((f) => path.join(srcDir, f)).find((p) => fs.existsSync(p))!;
const d: Json = JSON.parse(fs.readFileSync(srcFile, "utf8"));
const words: { text: string; start: number; end: number }[] =
  JSON.parse(fs.readFileSync(path.join(TEMP, `transcript-words-normalized-${videoBase}.json`), "utf8")).words;

const videoTrack = d.tracks.find((t: Json) => t.type === "video");
// drop the empty hook placeholder text track
d.tracks = d.tracks.filter((t: Json) => t.type !== "text" || t.segments.some((s: Json) => {
  const m = d.materials.texts.find((x: Json) => x.id === s.material_id);
  return m && JSON.parse(m.content).text.trim();
}));
d.materials.texts = d.materials.texts.filter((m: Json) => JSON.parse(m.content).text.trim());

// clone the 9 per-segment helper materials (speed, canvas, …) for a split segment
const REF_KEYS = ["time_marks", "speeds", "placeholder_infos", "canvases", "material_animations", "sound_channel_mappings", "material_colors", "loudnesses", "vocal_separations"];
function cloneRefs(refs: string[]): string[] {
  return refs.map((id) => {
    for (const k of REF_KEYS) {
      const m = d.materials[k]?.find((x: Json) => x.id === id);
      if (m) { const c = { ...structuredClone(m), id: uuid() }; d.materials[k].push(c); return c.id; }
    }
    return id;
  });
}

// ─── voice energy (10 ms RMS of the analyze WAV) — word timestamps can run 0.3–0.5 s past the
// real end of speech, which leaves dead air before a cut and kills the J-cut's flow.
const WAV = path.join(TEMP, `audio-normalized-${videoBase}.wav`);
const env: number[] = (() => {
  const b = fs.readFileSync(WAV);
  let off = 12, rate = 48000, ch = 1, dataOff = -1, dataLen = 0;
  while (off + 8 <= b.length) { // walk RIFF chunks
    const id = b.toString("ascii", off, off + 4), len = b.readUInt32LE(off + 4);
    if (id === "fmt ") { ch = b.readUInt16LE(off + 10); rate = b.readUInt32LE(off + 12); }
    if (id === "data") { dataOff = off + 8; dataLen = Math.min(len, b.length - off - 8); break; }
    off += 8 + len + (len & 1);
  }
  const hop = Math.round(rate * 0.01) * ch * 2, out: number[] = [];
  for (let p = dataOff; p + hop <= dataOff + dataLen; p += hop) {
    let sum = 0;
    for (let q = p; q < p + hop; q += 2 * ch) { const v = b.readInt16LE(q) / 32768; sum += v * v; }
    out.push(10 * Math.log10(sum / (hop / (2 * ch)) + 1e-12));
  }
  return out;
})();
const dbAt = (t: number) => env[Math.max(0, Math.min(env.length - 1, Math.round(t * 100)))];
/** Speech level of the words in [a,b] (p80 of their frames) − 20 dB: Fran's tail decays below it, room tone stays under it. */
function voiceThreshold(ws: { start: number; end: number }[]): number {
  const v: number[] = [];
  for (const w of ws) for (let t = w.start; t < w.end; t += 0.01) v.push(dbAt(t));
  v.sort((x, y) => x - y);
  return (v[Math.floor(v.length * 0.8)] ?? -30) - 20;
}
/** Last instant ≤ upTo where the voice is above thr (searching back to `floor`). */
function voiceEnd(upTo: number, floor: number, thr: number): number {
  for (let t = upTo; t > floor; t -= 0.01) if (dbAt(t) > thr && dbAt(t - 0.01) > thr) return t;
  return floor;
}
/** First instant ≥ from where the voice is above thr (searching up to `ceil`). */
function voiceStart(from: number, ceil: number, thr: number): number {
  for (let t = from; t < ceil; t += 0.01) if (dbAt(t) > thr && dbAt(t + 0.01) > thr) return t;
  return ceil;
}

// ─── respect the cut list: the rough builder's padding can run past a cut start
// (leaking the director's next line) — trim each clip to the first cut inside it,
// then close the gaps on the timeline.
const perVideo = path.join(TEMP, `ai-cuts-${videoBase}.json`);
const cutsFile = fs.existsSync(perVideo) ? perVideo : path.join(TEMP, "ai-cuts.json");
const aiCuts: { startSec: number; endSec: number }[] = fs.existsSync(cutsFile) ? JSON.parse(fs.readFileSync(cutsFile, "utf8")) : [];
let cursor = 0;
for (const s of videoTrack.segments) {
  const a = sec(s.source_timerange.start), b = a + sec(s.source_timerange.duration);
  const c = aiCuts.find((x) => x.startSec > a + 0.2 && x.startSec < b);
  if (c) s.source_timerange.duration = snap((c.startSec - a) * MICRO);
  // trim dead air at the clip edges: rough sections carry up to ~1 s of silence after a phrase
  const b2 = a + sec(s.source_timerange.duration);
  const inClip = words.filter((w) => w.start >= a && w.start < b2 - 0.12); // last 0.12 s = next take's onset
  if (inClip.length) {
    const thr = voiceThreshold(inClip);
    const first = inClip[0], last = inClip.at(-1)!;
    // never earlier than the transcript allows minus the pad, never later than the measured onset
    const onset = voiceStart(Math.max(a, first.start - 0.15), Math.max(first.start + 0.1, first.end - 0.05), thr);
    const offset = voiceEnd(Math.min(b2, last.end + 0.1), last.start + 0.08, thr);
    const ns = Math.max(a, first.start - HEAD_PAD, onset - ENERGY_HEAD);
    const ne = Math.min(b2, last.end + TAIL_PAD, offset + ENERGY_TAIL);
    s.source_timerange = { start: snap(ns * MICRO), duration: snap(ne * MICRO) - snap(ns * MICRO) };
  }
  s.target_timerange = { start: cursor, duration: s.source_timerange.duration };
  cursor += s.source_timerange.duration;
}

// ─── zoom cuts: split long clips at the widest word gap ─────────────────
const segs: Json[] = [];
const zoomSplit = new Set<string>(); // ids of the second half of a split clip (zoom cut, not a real cut)
for (const s of videoTrack.segments) {
  const a = sec(s.source_timerange.start), dur = sec(s.source_timerange.duration);
  if (dur > profile.zoom.splitClipsLongerThanSec) {
    const inner = words.filter((w) => w.start > a + 2 && w.end < a + dur - 2);
    let best = -1, gap = 0;
    for (let i = 0; i + 1 < inner.length; i++) {
      const g = inner[i + 1].start - inner[i].end;
      if (g > gap) { gap = g; best = i; }
    }
    if (best >= 0) {
      // the zoom cut hides a jump: drop the pause between the two words, keeping the edge pads
      const wl = inner[best], wr = inner[best + 1];
      const thr = voiceThreshold(inner);
      const endL = Math.min(wl.end + TAIL_PAD, voiceEnd(wl.end + 0.1, wl.start + 0.08, thr) + ENERGY_TAIL);
      const startR = Math.max(wr.start - HEAD_PAD, voiceStart(wr.start - 0.15, Math.max(wr.start + 0.1, wr.end - 0.05), thr) - ENERGY_HEAD);
      const tight = startR - endL > 0.05;
      const cut1 = snap((tight ? endL : (wl.end + wr.start) / 2) * MICRO);
      const cut2 = tight ? snap(startR * MICRO) : cut1;
      const end = s.source_timerange.start + s.source_timerange.duration;
      const firstDur = cut1 - s.source_timerange.start;
      const s2 = structuredClone(s);
      s2.id = uuid();
      s2.extra_material_refs = cloneRefs(s.extra_material_refs);
      s.source_timerange.duration = firstDur; s.target_timerange.duration = firstDur;
      s2.source_timerange = { start: cut2, duration: end - cut2 };
      s2.target_timerange = { start: s.target_timerange.start + firstDur, duration: s2.source_timerange.duration };
      zoomSplit.add(s2.id);
      segs.push(s, s2);
      continue;
    }
  }
  segs.push(s);
}
videoTrack.segments = segs;
{ let t = 0; for (const x of segs) { x.target_timerange = { start: t, duration: x.source_timerange.duration }; t += x.source_timerange.duration; } }
const totalUs = segs.reduce((m, s) => Math.max(m, s.target_timerange.start + s.target_timerange.duration), 0);
d.duration = totalUs;

// alternate 1.0 ↔ PUNCH, anchored on the eye line (transform keeps the eyes still)
segs.forEach((s, i) => {
  const k = i % 2 === 1 ? PUNCH : 1;
  s.clip.scale = { x: k, y: k };
  s.clip.transform = { x: EYE.x * (1 - k), y: EYE.y * (1 - k) };
  s.uniform_scale = { on: true, value: k };
});

// ─── captions: N words at a time (profile) ───────────────────────────────
const toTimeline = (t: number): number | null => {
  for (const s of segs) {
    const a = sec(s.source_timerange.start), b = a + sec(s.source_timerange.duration);
    // a word starting in the last 0.12 s of a clip is the next take's onset leaking in
    if (t >= a && t < b - 0.12) return sec(s.target_timerange.start) + (t - a);
  }
  return null;
};
const clean = (w: string) => {
  let t = cap.stripPunctuation ? w.replace(/[.,!?;:"“”()…—–]/g, "") : w;
  t = cap.case === "lower" ? t.toLowerCase() : cap.case === "upper" ? t.toUpperCase() : t;
  return t.trim();
};
const spoken = words
  .map((w) => ({ text: clean(w.text), at: toTimeline(w.start), endAt: toTimeline(Math.max(w.start, w.end - 0.01)) }))
  .filter((w) => w.text && w.at !== null) as { text: string; at: number; endAt: number | null }[];
// group N words per caption, never across a clip boundary gap > 0.6 s
const placed: typeof spoken = [];
for (const w of spoken) {
  const last = placed.at(-1);
  const n = last ? last.text.split(" ").length : 0;
  if (last && n < cap.wordsPerCaption && w.at - (last.endAt ?? last.at) < 0.6) {
    last.text += " " + w.text; last.endAt = w.endAt;
  } else placed.push({ ...w });
}
const FILL = hexToRgb(cap.color);
const SHADOW_RGB = hexToRgb(cap.shadow.color);

const rad = (sh.angle * Math.PI) / 180;
function textMaterial(text: string) {
  const content = {
    text,
    styles: [{
      fill: { content: { render_type: "solid", solid: { color: FILL } } },
      font: FONT ? { id: "", path: FONT } : { id: "", path: "" },
      size: SIZE,
      range: [0, text.length],
      shadows: [{
        alpha: sh.alpha / 100, angle: sh.angle, distance: sh.distance, diffuse: sh.blur / 100,
        content: { render_type: "solid", solid: { color: SHADOW_RGB } },
      }],
    }],
  };
  const base = structuredClone(d.materials.texts[0] ?? null);
  return {
    ...(base ?? {}),
    id: uuid(), type: "text", content: JSON.stringify(content),
    font_path: FONT, font_name: FONT ? path.basename(FONT, path.extname(FONT)) : "", font_size: SIZE,
    letter_spacing: SPACING * 0.05, alignment: 1, line_max_width: 0.82,
    has_shadow: true, shadow_alpha: sh.alpha / 100, shadow_angle: sh.angle,
    shadow_distance: sh.distance, shadow_smoothing: sh.blur / 100, shadow_color: cap.shadow.color,
    shadow_point: { x: Math.cos(rad), y: Math.sin(rad) },
    background_alpha: 0, text_color: cap.color, text_size: 30,
  };
}
// the rough project's (empty) hook text is the template for every caption material/segment
const raw: Json = JSON.parse(fs.readFileSync(srcFile, "utf8"));
const textSegTemplate = raw.tracks.find((t: Json) => t.type === "text").segments[0];
const tmplBase = raw.materials.texts[0];

const captionSegs: Json[] = [];
placed.forEach((w, i) => {
  const next = placed[i + 1];
  const startUs = snap(w.at * MICRO);
  let endSec = next ? next.at : (w.endAt ?? w.at) + 0.4;
  endSec = Math.min(endSec, (w.endAt ?? w.at) + 0.6, sec(totalUs));
  const durUs = Math.max(FRAME * 3, snap(endSec * MICRO) - startUs);
  const mat = { ...structuredClone(tmplBase), ...textMaterial(w.text) };
  d.materials.texts.push(mat);
  const anim = { animations: [], id: uuid(), multi_language_current: "none", type: "sticker_animation" };
  d.materials.material_animations.push(anim);
  const seg = structuredClone(textSegTemplate);
  Object.assign(seg, { id: uuid(), material_id: mat.id, extra_material_refs: [anim.id], render_index: 14000 + i });
  seg.clip.transform = { x: 0, y: CAPTION_Y };
  seg.target_timerange = { start: startUs, duration: durUs };
  captionSegs.push(seg);
});
// no overlaps on the caption track
for (let i = 0; i + 1 < captionSegs.length; i++) {
  const a = captionSegs[i], b = captionSegs[i + 1];
  if (a.target_timerange.start + a.target_timerange.duration > b.target_timerange.start)
    a.target_timerange.duration = Math.max(FRAME, b.target_timerange.start - a.target_timerange.start);
}
d.tracks.push({ attribute: 0, flag: 0, id: uuid(), is_default_name: true, name: "", segments: captionSegs, type: "text" });

// ─── voice track + J-cuts ─────────────────────────────────────────────────
// The voice moves to its own audio track at true timing (video muted); at every real cut
// (not a zoom split) the picture cuts 4 frames after the audio, so the voice leads it.
const wavPath = path.join(TEMP, `audio-normalized-${videoBase}.wav`);
const wavDurUs = snap(probeDurEarly(wavPath) * MICRO);
const voiceMatId = uuid();
d.materials.audios.push({
  app_id: 0, category_id: "", category_name: "local", check_flag: 1, copyright_limit_type: "none",
  duration: wavDurUs, effect_id: "", formula_id: "", id: voiceMatId, intensifies_path: "",
  is_ai_clone_tone: false, is_text_edit_overdub: false, is_ugc: false, local_material_id: uuid(),
  music_id: uuid(), name: path.basename(wavPath), path: wavPath, query: "", request_id: "", resource_id: "",
  search_id: "", source_from: "", source_platform: 0, team_id: "", text_id: "", tone_category_id: "",
  tone_category_name: "", tone_effect_id: "", tone_effect_name: "", tone_platform: "",
  tone_second_category_id: "", tone_second_category_name: "", tone_speaker: "", tone_type: "",
  type: "extract_music", video_id: "", wave_points: [],
});
const audioSeg = (matId: string, src: { start: number; duration: number }, at: number, volume: number): Json => ({
  caption_info: null, cartoon: false, clip: null, common_keyframes: [], desc: "", enable_adjust: false,
  enable_color_curves: true, enable_color_wheels: true, enable_lut: false,
  extra_material_refs: cloneRefs([segs[0].extra_material_refs[1], segs[0].extra_material_refs[2], segs[0].extra_material_refs[5], segs[0].extra_material_refs[8]]),
  group_id: "", hdr_settings: null, id: uuid(), intensifies_audio: false, is_loop: false,
  is_placeholder: false, is_tone_modify: false, keyframe_refs: [], last_nonzero_volume: 1,
  material_id: matId, render_index: 0, reverse: false, source: "segmentsourcenormal",
  source_timerange: { ...src }, speed: 1, state: 0,
  target_timerange: { start: at, duration: src.duration },
  template_id: "", template_scene: "default", track_attribute: 0, track_render_index: 0,
  uniform_scale: null, visible: true, volume, hdr_vivid_settings: null, segment_color_tag: "",
});
const voiceSegs = segs.map((s) => audioSeg(voiceMatId, s.source_timerange, s.target_timerange.start, VOICE_VOL));
const srcVideoDurUs = d.materials.videos.find((v: Json) => v.id === segs[0].material_id)?.duration ?? Infinity;
let jCuts = 0;
for (let i = 1; i < segs.length; i++) {
  const prev = segs[i - 1], cur = segs[i];
  if (zoomSplit.has(cur.id)) continue;
  if (cur.source_timerange.duration <= J_CUT_US + 0.6 * MICRO) continue;
  if (prev.source_timerange.start + prev.source_timerange.duration + J_CUT_US > srcVideoDurUs) continue;
  prev.source_timerange.duration += J_CUT_US; prev.target_timerange.duration += J_CUT_US;
  cur.source_timerange.start += J_CUT_US; cur.target_timerange.start += J_CUT_US;
  cur.source_timerange.duration -= J_CUT_US; cur.target_timerange.duration -= J_CUT_US;
  jCuts++;
}
for (const s of segs) s.volume = 0;

// ─── slow push-in: the longest unzoomed clip of 3–7 s eases 1.0 → 1.07 on the eye line ─────
const SLOW_TO = 1.07;
let pushIdx = -1;
segs.forEach((s, i) => {
  const dur = sec(s.target_timerange.duration);
  if (i > 0 && s.clip.scale.x === 1 && dur >= 3 && dur <= 7 && (pushIdx < 0 || dur > sec(segs[pushIdx].target_timerange.duration))) pushIdx = i;
});
if (pushIdx >= 0) {
  const s = segs[pushIdx];
  const t0 = s.source_timerange.start, t1 = t0 + s.source_timerange.duration; // CapCut keyframes run on source time
  const ctl = Math.round((t1 - t0) * 0.3);
  const vals: Record<string, [number, number]> = {
    KFTypePositionX: [0, EYE.x * (1 - SLOW_TO)], KFTypePositionY: [0, EYE.y * (1 - SLOW_TO)],
    KFTypeScaleX: [1, SLOW_TO], KFTypeRotation: [0, 0],
  };
  s.common_keyframes = Object.entries(vals).map(([prop, v]) => ({
    id: uuid(), material_id: "", property_type: prop,
    keyframe_list: [0, 1].map((j) => ({
      id: uuid(), curveType: "Line", graphID: "", string_value: "",
      time_offset: j === 0 ? t0 : t1,
      left_control: { x: j === 0 ? 0 : -ctl, y: 0 }, right_control: { x: j === 0 ? ctl : 0, y: 0 },
      values: [v[j]],
    })),
  }));
}

// ─── colour grade: --grade=temperature:0.12,brightness:0.14,… (slider ÷ 50) on every speaker clip.
// The adjust effect is cloned from any draft where CapCut already applied one (it downloads the
// effect the first time a basic adjustment is used).
const grade: [string, number][] = (flag("grade") ?? "").split(",").filter(Boolean)
  .map((kv) => { const [k, v] = kv.split(":"); return [k.trim(), parseFloat(v)] as [string, number]; });
let gradeApplied = false;
if (grade.length) {
  const ADJ = new Set(["temperature", "tone", "brightness", "contrast", "saturation", "shadow", "white", "black", "light_sensation", "sharpen", "clear", "highlight", "fade", "vignetting"]);
  let tmpl: Json = null;
  for (const name of fs.readdirSync(DRAFTS)) {
    const f = ["draft_info.json", "draft_content.json"].map((x) => path.join(DRAFTS, name, x)).find((x) => fs.existsSync(x));
    if (!f) continue;
    try {
      const m = JSON.parse(fs.readFileSync(f, "utf8")).materials?.effects?.find((e: Json) => ADJ.has(e.type) && e.path && fs.existsSync(e.path));
      if (m) { tmpl = m; break; }
    } catch { /* partial draft */ }
  }
  if (!tmpl) console.warn("\n⚠ --grade skipped: CapCut hasn't downloaded its adjust effect on this machine yet. In CapCut, open any project, Ajustar → Básico, move any slider once, close CapCut and re-run.");
  else {
    d.materials.effects ??= [];
    for (const s of segs) {
      for (const [type, value] of grade) {
        const m = { ...structuredClone(tmpl), id: uuid(), type, value };
        d.materials.effects.push(m);
        s.extra_material_refs.push(m.id);
      }
      s.enable_adjust = true;
    }
    gradeApplied = true;
  }
}
d.tracks.push({ attribute: 0, flag: 0, id: uuid(), is_default_name: true, name: "", segments: voiceSegs, type: "audio" });

// ─── flash transitions ───────────────────────────────────────────────────
const cuts = segs.slice(1).map((s) => sec(s.target_timerange.start));
const totalSec = sec(totalUs);
const targets = totalSec <= 40 ? [totalSec / 2] : [totalSec / 3, (2 * totalSec) / 3];
const flashAt = [...new Set(targets.map((t) => cuts.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b), cuts[0])))];
const probeDur = (f: string) => parseFloat(execSync(`"${findFfprobe(true)}" -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString());
const flashDurUs = snap(probeDur(FLASH_FILE) * MICRO);
const flashSegs: Json[] = [];
for (const at of flashAt) {
  const matId = uuid();
  const vm = structuredClone(d.materials.videos[0]);
  Object.assign(vm, { id: matId, path: FLASH_FILE, material_name: path.basename(FLASH_FILE), duration: flashDurUs, has_audio: false, local_material_id: uuid() });
  vm.stable.time_range = { start: 0, duration: flashDurUs };
  vm.video_algorithm.time_range = { start: 0, duration: flashDurUs };
  d.materials.videos.push(vm);
  const seg = structuredClone(segs[0]);
  Object.assign(seg, { id: uuid(), material_id: matId, extra_material_refs: cloneRefs(segs[0].extra_material_refs), render_index: 11000, volume: 0 });
  seg.clip = { alpha: 1, flip: { horizontal: false, vertical: false }, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } };
  seg.uniform_scale = { on: true, value: 1 };
  seg.source_timerange = { start: 0, duration: flashDurUs };
  seg.target_timerange = { start: Math.max(0, snap(at * MICRO) - FRAME * 2), duration: flashDurUs };
  flashSegs.push(seg);
}
d.tracks.push({ attribute: 0, flag: 0, id: uuid(), is_default_name: true, name: "", segments: flashSegs, type: "video" });

// ─── SFX ─────────────────────────────────────────────────────────────────
const SFX = SFX_FILES;
const accents: { key: SfxKey; at: number }[] = [];
const free = (t: number, gap = 1) => accents.every((a) => Math.abs(a.at - t) >= gap);
const add = (key: SfxKey, at: number, force = false) => { if (at >= 0 && at < totalSec && (force || free(at))) accents.push({ key, at }); };

add("boom", 0, true);
for (const f of flashAt) {
  const riserDur = Math.min(probeDur(path.join(SFX_DIR, SFX.riser)), 2.5);
  const white = Math.max(0, f - 2 / 30); // the flash clip starts 2 frames before the cut
  add("riser", Math.max(0, white - riserDur), true);
  add("transition", white, true);
}
let whooshes = 0, punchIdx = 0;
segs.forEach((s, i) => {
  if (i === 0) return;
  const at = sec(s.target_timerange.start);
  if (flashAt.includes(at)) return;
  if (i % 2 === 1) { // punch-in
    if (whooshes < 2 && free(at)) { add("whoosh", Math.max(0, at - 0.15)); whooshes++; }
    else if (punchIdx++ % 2 === 0) add("click", at);
  } else add("pop", at);
});
const lastCaption = captionSegs.at(-4) ?? captionSegs.at(-1);
if (lastCaption) add("popup", sec(lastCaption.target_timerange.start));
if (pushIdx > 0) add("shortWhoosh", Math.max(0, sec(segs[pushIdx].target_timerange.start) - 0.25));
accents.sort((a, b) => a.at - b.at);

const audioSegs: Json[] = [];
for (const { key, at } of accents) {
  const file = path.join(SFX_DIR, SFX[key]);
  const fileDur = probeDur(file);
  const len = Math.min(fileDur, totalSec - at);
  const volume = SFX_VOL;
  const matId = uuid();
  d.materials.audios.push({
    app_id: 0, category_id: "", category_name: "local", check_flag: 1, copyright_limit_type: "none",
    duration: snap(fileDur * MICRO), effect_id: "", formula_id: "", id: matId, intensifies_path: "",
    is_ai_clone_tone: false, is_text_edit_overdub: false, is_ugc: false, local_material_id: uuid(),
    music_id: uuid(), name: SFX[key], path: file, query: "", request_id: "", resource_id: "",
    search_id: "", source_from: "", source_platform: 0, team_id: "", text_id: "", tone_category_id: "",
    tone_category_name: "", tone_effect_id: "", tone_effect_name: "", tone_platform: "",
    tone_second_category_id: "", tone_second_category_name: "", tone_speaker: "", tone_type: "",
    type: "extract_music", video_id: "", wave_points: [],
  });
  const refs = cloneRefs([segs[0].extra_material_refs[1], segs[0].extra_material_refs[2], segs[0].extra_material_refs[5], segs[0].extra_material_refs[8]]);
  audioSegs.push({
    caption_info: null, cartoon: false, clip: null, common_keyframes: [], desc: "", enable_adjust: false,
    enable_color_curves: true, enable_color_wheels: true, enable_lut: false, extra_material_refs: refs,
    group_id: "", hdr_settings: null, id: uuid(), intensifies_audio: false, is_loop: false,
    is_placeholder: false, is_tone_modify: false, keyframe_refs: [], last_nonzero_volume: 1,
    material_id: matId, render_index: 0, reverse: false, source: "segmentsourcenormal",
    source_timerange: { start: 0, duration: snap(len * MICRO) }, speed: 1, state: 0,
    target_timerange: { start: snap(at * MICRO), duration: snap(len * MICRO) },
    template_id: "", template_scene: "default", track_attribute: 0, track_render_index: 0,
    uniform_scale: null, visible: true, volume, hdr_vivid_settings: null, segment_color_tag: "",
  });
}
// SFX can overlap each other — spread them over as many audio tracks as needed
const audioTracks: Json[][] = [];
for (const s of audioSegs) {
  const t = audioTracks.find((tr) => {
    const last = tr.at(-1);
    return last.target_timerange.start + last.target_timerange.duration <= s.target_timerange.start;
  });
  t ? t.push(s) : audioTracks.push([s]);
}
for (const tr of audioTracks) d.tracks.push({ attribute: 0, flag: 0, id: uuid(), is_default_name: true, name: "", segments: tr, type: "audio" });

// ─── write the -EDITADO copy ─────────────────────────────────────────────
let outName = `${roughName}-EDITADO`;
for (let n = 2; fs.existsSync(path.join(DRAFTS, outName)); n++) outName = `${roughName}-EDITADO-${n}`;
const outDir = path.join(DRAFTS, outName);
fs.cpSync(srcDir, outDir, { recursive: true });
const newId = uuid();
const oldId = d.id;
d.id = newId; d.name = outName;
const json = JSON.stringify(d);
for (const f of ["draft_content.json", "draft_info.json"]) fs.writeFileSync(path.join(outDir, f), json); // 9.9+ reads draft_info.json
const tlDir = path.join(outDir, "Timelines");
fs.rmSync(path.join(tlDir, oldId), { recursive: true, force: true });
fs.mkdirSync(path.join(tlDir, newId), { recursive: true });
for (const f of ["draft_content.json", "draft_info.json"]) fs.writeFileSync(path.join(tlDir, newId, f), json);
const proj = JSON.parse(fs.readFileSync(path.join(tlDir, "project.json"), "utf8"));
proj.id = uuid(); proj.main_timeline_id = newId; proj.timelines[0].id = newId;
fs.writeFileSync(path.join(tlDir, "project.json"), JSON.stringify(proj));
const layout = JSON.parse(fs.readFileSync(path.join(outDir, "timeline_layout.json"), "utf8"));
layout.dockItems[0].timelineIds = [newId];
fs.writeFileSync(path.join(outDir, "timeline_layout.json"), JSON.stringify(layout));
for (const f of ["draft_meta_info.json", "draft_virtual_store.json", "key_value.json"]) {
  const p = path.join(outDir, f);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, "utf8").split(oldId).join(newId).split(srcDir).join(outDir);
  s = s.replace(new RegExp(`"${roughName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"), `"${outName}"`);
  fs.writeFileSync(p, s);
}

console.log(JSON.stringify({
  project: outName, durationSec: +totalSec.toFixed(2), clips: segs.length,
  zooms: segs.map((s) => s.clip.scale.x), captions: captionSegs.length,
  jCuts, fontPending: !FONT, grade: gradeApplied ? grade.map(([k, v]) => `${k}:${v}`).join(",") : "not applied",
  slowPushInAt: pushIdx >= 0 ? +sec(segs[pushIdx].target_timerange.start).toFixed(2) : null,
  flashesAt: flashAt.map((x) => +x.toFixed(2)),
  sfx: accents.map((a) => `${a.key}@${a.at.toFixed(2)}`),
}, null, 1));
