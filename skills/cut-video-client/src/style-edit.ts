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
 *     punch-ins, pop on zoom-outs, pop-up near the end; every effect peaks at the
 *     profile's level (−12 dBFS); never within 1 s of another accent
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
import { CAPCUT_USER_DATA, findFfprobe, peakDb } from "./ffmpeg.js";
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
if (!printCheck(checkProfile(profile, Object.values(SFX_FILES)))) {
  console.error("\nFix the MISSING items above, then re-run. Nothing was written.");
  process.exit(1);
}
const DRAFTS = path.join(CAPCUT_USER_DATA, "Projects/com.lveditor.draft");
const TEMP = path.resolve(import.meta.dirname, "..", "temp");
const SFX_DIR = process.env.MONATELA_SFX_DIR ?? path.join(STUDIO_DIR, "SX");
const FLASH_FILE = resolveStudioPath(profile.flash.file);
const FONT = resolveFont(profile)!;
const cap = profile.captions;
const SIZE = cap.size;
const SPACING = cap.letterSpacing;
const sh = { alpha: cap.shadow.opacity, blur: cap.shadow.blur, distance: cap.shadow.distance, angle: cap.shadow.angle };
const CAPTION_Y = cap.y;
const PUNCH = profile.zoom.punch;
const EYE = { x: parseFloat(eyeXArg), y: parseFloat(eyeYArg) };
const SFX_PEAK_DB = profile.sfx.peakDb;

const MICRO = 1_000_000;
const FRAME = MICRO / 30;
const snap = (us: number) => Math.round(us / FRAME) * FRAME;
const uuid = () => randomUUID().toUpperCase();
const sec = (us: number) => us / MICRO;

// ─── load ────────────────────────────────────────────────────────────────
const srcDir = path.join(DRAFTS, roughName);
const d: Json = JSON.parse(fs.readFileSync(path.join(srcDir, "draft_content.json"), "utf8"));
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
  s.target_timerange = { start: cursor, duration: s.source_timerange.duration };
  cursor += s.source_timerange.duration;
}

// ─── zoom cuts: split long clips at the widest word gap ─────────────────
const segs: Json[] = [];
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
      const cut = snap(((inner[best].end + inner[best + 1].start) / 2) * MICRO);
      const firstDur = cut - s.source_timerange.start;
      const s2 = structuredClone(s);
      s2.id = uuid();
      s2.extra_material_refs = cloneRefs(s.extra_material_refs);
      s.source_timerange.duration = firstDur; s.target_timerange.duration = firstDur;
      s2.source_timerange = { start: cut, duration: s2.source_timerange.duration - firstDur };
      s2.target_timerange = { start: s.target_timerange.start + firstDur, duration: s2.source_timerange.duration };
      segs.push(s, s2);
      continue;
    }
  }
  segs.push(s);
}
videoTrack.segments = segs;
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
      font: { id: "", path: FONT },
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
    font_path: FONT, font_name: path.basename(FONT, path.extname(FONT)), font_size: SIZE,
    letter_spacing: SPACING * 0.05, alignment: 1, line_max_width: 0.82,
    has_shadow: true, shadow_alpha: sh.alpha / 100, shadow_angle: sh.angle,
    shadow_distance: sh.distance, shadow_smoothing: sh.blur / 100, shadow_color: cap.shadow.color,
    shadow_point: { x: Math.cos(rad), y: Math.sin(rad) },
    background_alpha: 0, text_color: cap.color, text_size: 30,
  };
}
// the rough project's (empty) hook text is the template for every caption material/segment
const raw: Json = JSON.parse(fs.readFileSync(path.join(srcDir, "draft_content.json"), "utf8"));
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
  add("riser", Math.max(0, f - riserDur), true);
  add("transition", f, true);
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
accents.sort((a, b) => a.at - b.at);

const audioSegs: Json[] = [];
for (const { key, at } of accents) {
  const file = path.join(SFX_DIR, SFX[key]);
  const fileDur = probeDur(file);
  const len = Math.min(fileDur, totalSec - at);
  const peak = peakDb(file, 0, len);
  const volume = Math.min(10, Math.pow(10, (SFX_PEAK_DB - peak) / 20));
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
fs.writeFileSync(path.join(outDir, "draft_content.json"), json);
const tlDir = path.join(outDir, "Timelines");
fs.rmSync(path.join(tlDir, oldId), { recursive: true, force: true });
fs.mkdirSync(path.join(tlDir, newId), { recursive: true });
fs.writeFileSync(path.join(tlDir, newId, "draft_content.json"), json);
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
  flashesAt: flashAt.map((x) => +x.toFixed(2)),
  sfx: accents.map((a) => `${a.key}@${a.at.toFixed(2)}`),
}, null, 1));
