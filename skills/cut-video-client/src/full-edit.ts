/**
 * Full edit on top of an existing rough-cut CapCut project:
 * captions, eye-line punch-in zooms, J-cuts, flash transitions and SFX.
 *
 * Caption style, flash clip and SFX segments are cloned from a finished
 * project of the same client, so fonts, shadow and animations match the
 * editor's own work exactly. The rough project is never modified — the
 * result is written as a copy named "<rough>-EDITADO".
 *
 * Usage:
 *   npx tsx src/full-edit.ts <rough-project> <style-project> <eyeX> <eyeY>
 *
 * eyeX / eyeY: the speaker's eye line in CapCut canvas units
 * (-1..1, +y up, 0 = centre) — zooms are anchored there so the eyes
 * stay put when the frame punches in.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { CAPCUT_USER_DATA, findFfprobe, peakDb as filePeakDb } from "./ffmpeg.js";
import { inkWidth, inkMasks, clearShift, type PlacedText } from "./measure-text.js";

const DRAFTS = path.join(CAPCUT_USER_DATA, "Projects/com.lveditor.draft");
const TEMP_DIR = path.resolve(import.meta.dirname, "..", "temp");
const SFX_DIR = (process.env.MONATELA_SFX_DIR ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", "Desktop/MONATELA/SX")).replace(/\\/g, "/");

const SFX = {
  boom: { file: "ES_Designed, Boom, Impact, Dark, Cinematic, Low Long Rumble 01 - Epidemic Sound.mp3", vol: 0.296 },
  riser: { file: "ES_Designed, Riser, Bass, Sharp Detail Riser - Epidemic Sound.mp3", vol: 0.25 },
  lowRiser: { file: "ES_Designed, Riser, Low Risers - Epidemic Sound.mp3", vol: 0.168 },
  transition: { file: "Transition 2.mp3", vol: 0.153 },
  whoosh: { file: "ES_Swooshes, Whoosh, Fast, Close, Airy, Zoom 01 - Epidemic Sound.mp3", vol: 0.376 },
  // short accents on cuts (source windows hold a single hit each)
  mouseClick: { file: "ES_Computers, Keyboard & Mouse, Mouse, Apple Magic, Left Click, Various Single - Epidemic Sound.mp3", vol: 0.5 },
  buttonClick: { file: "ES_User Interface, Beep, Button Click, Plop, Short - Epidemic Sound.mp3", vol: 0.3 },
  softPop: { file: "ES_Cartoon, Pop, Small Lid - Epidemic Sound.mp3", vol: 0.2 },
  popUp: { file: "Pop up Sound effect ( 256kbps cbr ).mp3", vol: 0.35 },
  shortWhoosh: { file: "ES_Swooshes, Whoosh, Short, Low, Dry 02 - Epidemic Sound.mp3", vol: 0.25 },
};

const J_CUT_SEC = 4 / 30;       // audio of the next clip leads its picture by 4 frames
const MAX_PIECE_SEC = 6;        // longer clips get an internal zoom cut
const PUNCH_SCALES = [1.15, 1.22, 1.12, 1.25];
const SLOW_ZOOM_TO = 1.07;      // stays below every punch scale so the next cut still reads as a zoom
const CAPTION_MAX_WORDS = 6;
const CAPTION_MAX_SEC = 2.6;

type Json = any;
interface Word { text: string; start: number; end: number }
interface Piece { srcStart: number; srcEnd: number; rangeIdx: number; zoomCut: boolean }

const uuid = () => randomUUID().toUpperCase();
const micro = (s: number) => Math.round(s * 1_000_000);
const sec = (m: number) => m / 1_000_000;
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf-8"));

function indexMaterials(draft: Json): Map<string, { kind: string; mat: Json }> {
  const idx = new Map<string, { kind: string; mat: Json }>();
  for (const [kind, arr] of Object.entries(draft.materials)) {
    if (!Array.isArray(arr)) continue;
    for (const m of arr as Json[]) if (m && m.id) idx.set(m.id, { kind, mat: m });
  }
  return idx;
}

const UUID_RE = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;

/**
 * Deep-copy a segment plus its material and every referenced material into `target`, with fresh ids.
 * Materials that point at other materials (e.g. a caption template wrapping a text material)
 * are cloned recursively, and a material referenced twice keeps a single copy.
 */
function cloneSegment(seg: Json, sourceIdx: Map<string, { kind: string; mat: Json }>, target: Json): Json {
  const copy = structuredClone(seg);
  copy.id = uuid();
  const remap = new Map<string, string>();
  const cloneMat = (id: string): string => {
    const known = remap.get(id);
    if (known) return known;
    const hit = sourceIdx.get(id);
    if (!hit) return id;
    const newId = uuid();
    remap.set(id, newId);
    let json = JSON.stringify(hit.mat);
    for (const nested of new Set(json.match(UUID_RE) ?? [])) {
      if (nested !== id && sourceIdx.has(nested)) json = json.split(nested).join(cloneMat(nested));
    }
    const m = JSON.parse(json);
    m.id = newId;
    for (const r of m.text_info_resources ?? []) r.id = uuid();
    (target.materials[hit.kind] ??= []).push(m);
    return newId;
  };
  copy.material_id = cloneMat(seg.material_id);
  copy.extra_material_refs = (seg.extra_material_refs ?? []).map(cloneMat);
  return copy;
}

function findMat(draft: Json, id: string): Json {
  for (const arr of Object.values(draft.materials)) {
    if (!Array.isArray(arr)) continue;
    const m = (arr as Json[]).find((x) => x?.id === id);
    if (m) return m;
  }
  throw new Error(`material ${id} not found`);
}

function newTrack(type: string, flag: number, segments: Json[]): Json {
  return { attribute: 0, flag, id: uuid(), is_default_name: true, name: "", segments, type };
}

function audioDuration(file: string): number {
  return parseFloat(execSync(`"${findFfprobe(true)}" -v error -show_entries format=duration -of csv=p=0 "${file}"`).toString());
}

// ─── Inputs ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [roughName, styleName, eyeXArg, eyeYArg, fontArg] = args.filter((a) => !a.startsWith("--"));
if (!roughName || !styleName || eyeXArg === undefined || eyeYArg === undefined) {
  console.error(
    "Usage: npx tsx src/full-edit.ts <rough-project> <style-project> <eyeX> <eyeY> [caption-font.ttf]\n" +
    "       [--tail=0.3] [--max-pause=0.35] [--speaker=B]"
  );
  process.exit(1);
}
// optional: caption font override, for a client whose style is borrowed from another client's project
const captionFont = fontArg ? path.resolve(fontArg).replace(/\\/g, "/") : null;
if (captionFont && !fs.existsSync(captionFont)) throw new Error(`font not found: ${captionFont}`);
const eyeX = parseFloat(eyeXArg);
const eyeY = parseFloat(eyeYArg);

const roughDir = path.join(DRAFTS, roughName);
const rough: Json = readJson(path.join(roughDir, "draft_content.json"));
const style: Json = readJson(path.join(DRAFTS, styleName, "draft_content.json"));
const styleIdx = indexMaterials(style);
const roughIdx = indexMaterials(rough);

// Templates from the finished project
const styleTextTrack = style.tracks.find((t: Json) => t.type === "text");
const textTemplate = styleTextTrack.segments.find((s: Json) => Math.abs(s.clip.transform.y) < 0.2) ?? styleTextTrack.segments[0];
const flashTemplate = style.tracks
  .flatMap((t: Json) => t.segments)
  .find((s: Json) => /predefini/i.test(styleIdx.get(s.material_id)?.mat.material_name ?? ""));
// SFX segment template — from the style project, or --sfx-from=<project> when it has no SX clips
const findSfx = (draft: Json, idx: Map<string, { kind: string; mat: Json }>) => draft.tracks
  .filter((t: Json) => t.type === "audio")
  .flatMap((t: Json) => t.segments)
  .find((s: Json) => idx.get(s.material_id)?.mat.path?.includes("/SX/"));
let audioIdx = styleIdx;
let audioTemplate = findSfx(style, styleIdx);
const sfxFrom = flag("sfx-from");
if (!audioTemplate && sfxFrom) {
  const sfxDraft = readJson(path.join(DRAFTS, sfxFrom, "draft_content.json"));
  audioIdx = indexMaterials(sfxDraft);
  audioTemplate = findSfx(sfxDraft, audioIdx);
}
const kfTemplate = style.tracks
  .flatMap((t: Json) => t.segments)
  .find((s: Json) => s.common_keyframes?.length)?.common_keyframes;
if (!textTemplate || !flashTemplate || !audioTemplate || !kfTemplate) {
  throw new Error("style project is missing a caption, flash, SFX (use --sfx-from) or keyframe example");
}

// ─── Rough cut → kept source ranges ─────────────────────────────────────
const mainTrack = rough.tracks.find((t: Json) => t.type === "video");
const roughSegs: Json[] = [...mainTrack.segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start);
const videoMat = findMat(rough, roughSegs[0].material_id);
const videoBase = path.basename(videoMat.path, path.extname(videoMat.path));
const realVideoDur = audioDuration(videoMat.path); // ffprobe — the material's own value may be a stale placeholder
const videoDur = realVideoDur;
interface Range { srcStart: number; srcEnd: number; base: number } // base = rough segment it came from
let ranges: Range[] = roughSegs.map((s, base) => ({
  srcStart: sec(s.source_timerange.start),
  srcEnd: sec(s.source_timerange.start + s.source_timerange.duration),
  base,
}));

const transcript = readJson(path.join(TEMP_DIR, `transcript-words-${videoBase}.json`));
const words: Word[] = transcript.words.map((w: Word) => ({ ...w }));

// The transcriber sometimes collapses a phrase into ~20 ms per word when alignment fails.
// Spread such runs over the gap up to the next word so captions follow the actual speech.
for (let i = 0; i < words.length; ) {
  let j = i;
  // a run never crosses a sentence end — the next word may belong to another take
  while (j < words.length && words[j].end - words[j].start < 0.06 && (j === i || !/[.!?]$/.test(words[j - 1].text))) j++;
  if (j - i >= 3) {
    const from = words[i].start;
    const to = Math.min(words[j]?.start ?? from + 0.3 * (j - i), from + 0.4 * (j - i));
    const step = (to - from) / (j - i);
    for (let k = i; k < j; k++) {
      words[k].start = from + (k - i) * step;
      words[k].end = from + (k - i + 1) * step;
    }
  }
  i = Math.max(j, i + 1);
}
// Optional transcription fixes: temp/caption-fixes-<video>.json = [{ "from": "...", "to": "..." }].
// Applied to the word stream (case/punctuation-insensitive) so they hold wherever captions break.
const fixesPath = path.join(TEMP_DIR, `caption-fixes-${videoBase}.json`);
if (fs.existsSync(fixesPath)) {
  const norm = (t: string) => t.replace(/[.,!?;:"“”…—–()]/g, "").toLowerCase();
  for (const { from, to } of readJson(fixesPath) as { from: string; to: string }[]) {
    const target = from.split(" ").map(norm);
    for (let i = 0; i + target.length <= words.length; i++) {
      if (!target.every((t, k) => norm(words[i + k].text) === t)) continue;
      // the new wording has no measured timing — spread it evenly over the old span
      const span = words.slice(i, i + target.length);
      const parts = to.split(" ");
      const step = (span[span.length - 1].end - span[0].start) / parts.length;
      words.splice(i, target.length, ...parts.map((text, k) => ({
        text, start: span[0].start + k * step, end: span[0].start + (k + 1) * step,
      })));
      i += parts.length - 1;
    }
  }
}

const wavPath = path.join(TEMP_DIR, `audio-${videoBase}.wav`).replace(/\\/g, "/");
if (!fs.existsSync(wavPath)) throw new Error(`missing ${wavPath} — run analyze first`);

// ─── Tighten every cut to the waveform ──────────────────────────────────
// Calibrated on the editor's own fixes to a reel: the head starts ~40 ms before
// the voice rises; the tail keeps ~0.3 s of decay, or stops 0.25 s before the next take
// starts; a word clipped mid-way is recovered, the next take's first syllable is dropped.
const SPEECH_DB = -38;
const PAD_IN = 0.04;
const TAIL = parseFloat(flag("tail") ?? "0.3");                 // decay kept after a sentence
const MAX_PAUSE = parseFloat(flag("max-pause") ?? "Infinity");  // longer pauses inside a clip are cut out
// --keep-cuts: the editor already cut this project — use its clips exactly as they are
const KEEP_CUTS = args.includes("--keep-cuts");
const FRAME = 0.01;

function levelsDb(wav: string): Float32Array {
  const buf = fs.readFileSync(wav);
  let p = 12, ch = 1, rate = 48000, dataAt = 0, dataLen = 0;
  while (p < buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") { ch = buf.readUInt16LE(p + 10); rate = buf.readUInt32LE(p + 12); }
    if (id === "data") { dataAt = p + 8; dataLen = size; break; }
    p += 8 + size + (size & 1);
  }
  const perFrame = Math.round(rate * FRAME);
  const frames = Math.floor(dataLen / 2 / ch / perFrame);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < perFrame; i++) {
      const v = buf.readInt16LE(dataAt + (f * perFrame + i) * 2 * ch) / 32768;
      sum += v * v;
    }
    out[f] = 10 * Math.log10(sum / perFrame + 1e-12);
  }
  return out;
}

const level = levelsDb(wavPath);
// speech regions: frames above SPEECH_DB, bridging gaps < 150 ms, at least 80 ms long
const speech: [number, number][] = [];
{
  let start = -1, gap = 0;
  for (let f = 0; f < level.length; f++) {
    if (level[f] > SPEECH_DB) { if (start < 0) start = f; gap = 0; }
    else if (start >= 0 && ++gap > 15) { speech.push([start * FRAME, (f - gap + 1) * FRAME]); start = -1; gap = 0; }
  }
}
const regions = speech.filter(([a, b]) => b - a >= 0.08);
const regionAt = (t: number) => regions.find(([a, b]) => t >= a && t < b);
const tailFrom = (offset: number) => {
  const next = regions.find(([a]) => a > offset + 0.01);
  return Math.max(offset + 0.02, Math.min(offset + TAIL, next ? next[0] - 0.25 : Infinity));
};

function refineCut(s0: number, e0: number): { srcStart: number; srcEnd: number } {
  let s = s0;
  const head = regionAt(s0);
  if (head && head[0] >= s0 - 0.6) s = head[0] - PAD_IN;          // first word was clipped
  else if (!head) {
    const next = regions.find(([a]) => a > s0 && a <= s0 + 1);
    if (next) s = next[0] - PAD_IN;                                 // leading silence
  }

  let e = e0;
  const wordAtEnd = words.find((w) => w.start <= e0 && w.end > e0);
  const tail = regionAt(e0);
  if (wordAtEnd && /[—-]$/.test(wordAtEnd.text) && wordAtEnd.end - e0 > 0.3) {
    e = wordAtEnd.start - PAD_IN;                                   // cut-off / stretched word
  } else if (tail) {
    const before = [...regions].reverse().find(([, b]) => b <= tail[0]);
    const nextTake = tail[0] >= e0 - 0.3 && (!before || tail[0] - before[1] >= 0.15);
    if (nextTake) e = before ? tailFrom(before[1]) : e0;           // next take bleeding in
    else if (tail[1] <= e0 + 1) e = tailFrom(tail[1]);              // last word was clipped
  } else {
    const before = [...regions].reverse().find(([, b]) => b <= e0 && b >= e0 - 1);
    if (before) e = tailFrom(before[1]);                            // trailing silence
  }
  // softly spoken sentence endings sit below the speech threshold — never trim into the last word
  const lastWord = [...words].reverse().find((w) => w.start < e0 - 0.15 && w.start >= s0 && !/[—-]$/.test(w.text));
  if (lastWord) e = Math.max(e, Math.min(e0, lastWord.start + 0.3));

  return { srcStart: Math.max(0, s), srcEnd: Math.min(videoDur, Math.max(e, s + 0.3)) };
}

if (!KEEP_CUTS) for (const r of ranges) Object.assign(r, refineCut(r.srcStart, r.srcEnd));

// a word belongs to a clip if its midpoint is inside, it starts inside (a stretched last word),
// or it reaches > 100 ms into the clip (transcript timing running early on the first word)
const wordsIn = (a: number, b: number) =>
  words.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return (mid >= a && mid < b) || (w.start >= a && w.start < b - 0.15) || (w.start < a && w.end > a + 0.1 && w.end <= b);
  });

// ─── Keep only the on-camera speaker ────────────────────────────────────
// A director prompting lines is further from the mic, so their peaks sit a few dB lower.
// Diarization alone lumps prompt + repeat into one utterance, so a phrase is dropped only
// when diarization says "other speaker" AND its peak level matches the off-camera voice.
const frameAt = (t: number) => Math.max(0, Math.min(level.length - 1, Math.round(t / FRAME)));
function peakDb(a: number, b: number): number | null {
  const v: number[] = [];
  for (let f = frameAt(a); f < frameAt(b); f++) if (level[f] > SPEECH_DB) v.push(level[f]);
  if (v.length < 10) return null;
  v.sort((x, y) => x - y);
  return v[Math.floor(v.length * 0.9)];
}
const normWord = (t: string) => t.replace(/[.,!?;:"“”…—–()]/g, "").toLowerCase();

interface Utt { speaker: string; start: number; end: number }
let utts: Utt[] = [];
let onCam: string | null = null;
let offCamPeak = -Infinity; // typical peak level of the off-camera voice
const diarPath = path.join(TEMP_DIR, `diarized-${videoBase}.json`);
if (fs.existsSync(diarPath)) {
  const raw = readJson(diarPath);
  utts = (Array.isArray(raw) ? raw : Array.isArray(raw.utterances) ? raw.utterances : Object.values(raw))
    .filter((u: Json) => u?.speaker);
  const peaks = new Map<string, number[]>();
  for (const u of utts) {
    const p = peakDb(u.start, u.end);
    if (p !== null) peaks.set(u.speaker, [...(peaks.get(u.speaker) ?? []), p]);
  }
  const median = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
  const speakers = [...peaks.keys()].sort((x, y) => median(peaks.get(y)!) - median(peaks.get(x)!));
  onCam = flag("speaker") ?? speakers[0] ?? null;
  const off = speakers.filter((s) => s !== onCam).flatMap((s) => peaks.get(s)!);
  if (onCam && off.length) {
    const onMed = median(peaks.get(onCam)!);
    const offMed = median(off);
    console.error(`  on camera: speaker ${onCam} (peak ${onMed.toFixed(1)} dB vs ${offMed.toFixed(1)} dB off camera)`);
    if (onMed - offMed >= 1.5) offCamPeak = offMed;
    else console.error("  voices too close in level to separate — off-camera check skipped");
  }
}

/**
 * Is [a, b] the off-camera voice? Only phrases diarization gives to another speaker qualify, and then
 *  - the same words said ≥ 1 dB louder a few seconds away (director prompts, talent repeats) → swap, or
 *  - a phrase ≥ 0.6 s peaking at the off-camera level → drop.
 */
function offCameraVerdict(a: number, b: number, kept: Range[]): { off: boolean; retake?: { srcStart: number; srcEnd: number } } {
  if (!onCam || offCamPeak === -Infinity) return { off: false };
  const mid = (a + b) / 2;
  const u = utts.find((x) => mid >= x.start && mid < x.end);
  const p = peakDb(a, b);
  if (process.env.DEBUG_SPEAKER) {
    console.error(`  phrase ${a.toFixed(2)}-${b.toFixed(2)} speaker=${u?.speaker} peak=${p?.toFixed(1)} "${wordsIn(a, b).map((w) => w.text).join(" ")}"`);
  }
  if (!u || u.speaker === onCam || p === null) return { off: false };
  const retake = findRetake(a, b, kept, p + 1);
  if (retake) return { off: true, retake };
  return { off: p < offCamPeak + 1 && b - a >= 0.6 };
}

/** Speech phrases inside [s, e]: waveform regions joined across gaps < 250 ms. */
function phrasesIn(s: number, e: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of regions) {
    if (b <= s || a >= e) continue;
    const seg: [number, number] = [Math.max(a, s), Math.min(b, e)];
    const last = out[out.length - 1];
    if (last && seg[0] - last[1] < 0.25) last[1] = seg[1];
    else out.push(seg);
  }
  return out;
}

/** The on-camera speaker's own take of the same words, a few seconds either side. */
function findRetake(a: number, b: number, kept: Range[], minPeak: number): { srcStart: number; srcEnd: number } | null {
  const target = wordsIn(a, b).map((w) => normWord(w.text)).filter(Boolean);
  if (target.length < 3) return null;
  const hits: { srcStart: number; srcEnd: number }[] = [];
  for (let i = 0; i + target.length <= words.length; i++) {
    const span = words.slice(i, i + target.length);
    const s = span[0].start, e = span[span.length - 1].end;
    if (s < a - 8 || s > b + 8 || (e > a && s < b)) continue;
    if (!span.every((w, k) => normWord(w.text) === target[k])) continue;
    // already in the cut? (touching a neighbouring clip's boundary doesn't count)
    if (kept.some((r) => Math.min(e, r.srcEnd) - Math.max(s, r.srcStart) > 0.1)) continue;
    const p = peakDb(s, e);
    if (process.env.DEBUG_SPEAKER) console.error(`    retake candidate ${s.toFixed(2)}-${e.toFixed(2)} peak=${p?.toFixed(1)} need≥${minPeak.toFixed(1)}`);
    if (p !== null && p >= minPeak) hits.push(refineCut(s - PAD_IN, e + TAIL));
  }
  hits.sort((x, y) => Math.abs(x.srcStart - a) - Math.abs(y.srcStart - a));
  return hits[0] ?? null;
}

// ─── Rebuild clips: drop off-camera phrases (swap in the retake), cut long pauses ─
const removedOffCamera: string[] = [];
const retakes: string[] = [];
const pausesCut: number[] = [];
if (!KEEP_CUTS) {
  const original = ranges;
  const rebuilt: Range[] = [];
  for (const r of original) {
    const phrases = phrasesIn(r.srcStart, r.srcEnd);
    let open: number | null = r.srcStart;
    let lastEnd: number | null = null;
    const close = (end: number) => {
      if (open !== null && end - open > 0.25) rebuilt.push({ ...r, srcStart: open, srcEnd: end });
      open = null;
    };
    for (const [a, b] of phrases) {
      const verdict = offCameraVerdict(a, b, original);
      if (verdict.off) {
        close(lastEnd === null ? a - 0.05 : Math.min(tailFrom(lastEnd), a - 0.05));
        const said = wordsIn(a, b).map((w) => w.text).join(" ");
        removedOffCamera.push(`${a.toFixed(2)}s "${said}"`);
        const retake = verdict.retake;
        if (retake) {
          rebuilt.push({ ...r, ...retake });
          retakes.push(`${retake.srcStart.toFixed(2)}s`);
        }
        continue;
      }
      if (open === null) open = a - PAD_IN;
      else if (lastEnd !== null && a - lastEnd > MAX_PAUSE &&
               !words.some((w) => { const m = (w.start + w.end) / 2; return m > lastEnd! + 0.05 && m < a - 0.05; })) {
        close(tailFrom(lastEnd));
        pausesCut.push(+(a - lastEnd).toFixed(2));
        open = a - PAD_IN;
      }
      lastEnd = b;
    }
    if (open !== null) close(r.srcEnd);
  }
  // a swapped-in retake can start inside the previous clip's tail — never play audio twice
  for (let i = 1; i < rebuilt.length; i++) {
    const prev = rebuilt[i - 1], cur = rebuilt[i];
    if (cur.srcStart < prev.srcEnd && cur.srcStart > prev.srcStart) cur.srcStart = prev.srcEnd;
  }
  ranges = rebuilt;
}

// ─── Split long clips at a word gap so each piece gets its own zoom ─────
const pieces: Piece[] = [];
ranges.forEach((r, rangeIdx) => {
  let start = r.srcStart;
  let first = true;
  while (r.srcEnd - start > MAX_PIECE_SEC) {
    const inner = wordsIn(start, r.srcEnd);
    // candidate split = start of a word, preferring one after punctuation, near the middle of what's left
    const target = start + Math.min((r.srcEnd - start) / 2, MAX_PIECE_SEC - 1);
    let best: number | null = null;
    let bestScore = Infinity;
    for (let i = 1; i < inner.length; i++) {
      const t = inner[i].start;
      if (t - start < 2.5 || r.srcEnd - t < 2.5) continue;
      const punct = /[.,!?;:]$/.test(inner[i - 1].text) ? 0 : 1.5;
      const score = Math.abs(t - target) + punct;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best === null) break;
    pieces.push({ srcStart: start, srcEnd: best, rangeIdx, zoomCut: !first });
    start = best;
    first = false;
  }
  pieces.push({ srcStart: start, srcEnd: r.srcEnd, rangeIdx, zoomCut: !first });
});

// Timeline position of each piece (audio timing — J-cuts only move picture)
let cursor = 0;
const placed = pieces.map((p) => {
  const t = cursor;
  cursor += p.srcEnd - p.srcStart;
  return { ...p, tlStart: t, tlEnd: cursor };
});
const totalSec = cursor;

// ─── Zoom plan ──────────────────────────────────────────────────────────
// --center: frame the speaker horizontally centred. Shifting the picture sideways needs a small
// base zoom so no border shows: |shift| = |eyeX|·s must stay within s − 1.
const CENTER = args.includes("--center");
const BASE_SCALE = CENTER ? 1 / (1 - Math.abs(eyeX)) + 0.005 : 1;
const zoomOf = placed.map((_, i) => BASE_SCALE * (i % 2 === 0 ? 1 : PUNCH_SCALES[Math.floor(i / 2) % PUNCH_SCALES.length]));
// one slow push-in on the longest unzoomed piece
let slowIdx = -1;
placed.forEach((p, i) => {
  const d = p.tlEnd - p.tlStart;
  if (zoomOf[i] === BASE_SCALE && d >= 3 && d <= 7 && (slowIdx < 0 || d > placed[slowIdx].tlEnd - placed[slowIdx].tlStart)) slowIdx = i;
});
// eyes stay on the same line at every zoom; with --center they also sit on the vertical centre line
const anchor = (s: number) => ({ x: CENTER ? -eyeX * s : eyeX * (1 - s), y: eyeY * (1 - s) });

// ─── J-cuts at real cuts (not at internal zoom cuts) ────────────────────
const picShift = placed.map(() => 0); // seconds the picture start is delayed
for (let i = 1; i < placed.length; i++) {
  const prev = placed[i - 1];
  const cur = placed[i];
  if (cur.zoomCut) continue;
  // Rough cuts are trimmed tight, so the previous clip's tail usually holds the next take's first
  // syllable (muted). 4 frames of that reads as a hold, not as lip flap.
  if (prev.srcEnd + J_CUT_SEC <= videoDur && cur.srcEnd - cur.srcStart > J_CUT_SEC + 0.6) picShift[i] = J_CUT_SEC;
}

// ─── Build output draft ─────────────────────────────────────────────────
const out: Json = structuredClone(rough);
out.tracks = [];

// --grade=temperature:0.16,brightness:0.16,... — CapCut's basic adjustments (−1…1, the slider's ±50 / 50)
// on every speaker clip. Types: temperature, tone (tint), brightness, contrast, saturation, shadow,
// white, black, light_sensation, sharpen, clear.
const GRADE_EFFECT_ID = "7501974767453474064";
const GRADE_EFFECT_DIR = `${CAPCUT_USER_DATA.replace(/\\/g, "/")}/Cache/effect/${GRADE_EFFECT_ID}/20cd8db6531c21bf7e4053026d20e395`;
const grade: [string, number][] = (flag("grade") ?? "").split(",").filter(Boolean)
  .map((kv) => { const [k, v] = kv.split(":"); return [k.trim(), parseFloat(v)] as [string, number]; });
const adjustMaterial = (type: string, value: number): Json => ({
  id: uuid(), effect_id: GRADE_EFFECT_ID, resource_id: GRADE_EFFECT_ID, third_resource_id: "", name: "", report_name: "",
  type, sub_type: "none", path: GRADE_EFFECT_DIR, value, visible: true, item_effect_type: 0,
  category_id: "", category_name: "", category_key: "", sub_category_id: "", sub_category_name: "",
  platform: "all", apply_target_type: 0, source_platform: 1, version: "v3", adjust_params: [], time_range: null,
  formula_id: "", enable_skin_tone_correction: false, algorithm_artifact_path: "", intensity_key: "",
  face_adjust_params: [], exclusion_group: [], panel_id: "", bloom_params: null, request_id: "",
  color_match_info: { target_feature_path: "", source_feature_path: "", target_image_path: "" },
  multi_language_current: "", lumi_hub_path: `${GRADE_EFFECT_DIR}/lumi_hub_path`, covering_relation_change: 0,
  beauty_face_auto_preset_id: "", beauty_body_auto_preset_id: "",
  beauty_face_auto_retouch_info: { face_id: [], beauty_face_auto_retouch_id: "" },
  smart_color_mode: 0, is_from_intelligent_quality: false,
});

const usedBases = new Set<number>();
const videoSegs: Json[] = placed.map((p, i) => {
  const baseIdx = ranges[p.rangeIdx].base;
  const base = roughSegs[baseIdx];
  // the first piece reuses the rough segment; any further piece of it needs its own ids
  const seg = usedBases.has(baseIdx) ? cloneSegment(base, roughIdx, out) : structuredClone(base);
  usedBases.add(baseIdx);
  const lead = picShift[i];
  const tail = i + 1 < placed.length ? picShift[i + 1] : 0;
  const srcStart = p.srcStart + lead;
  const dur = p.tlEnd - p.tlStart - lead + tail;
  seg.source_timerange = { start: micro(srcStart), duration: micro(dur) };
  seg.target_timerange = { start: micro(p.tlStart + lead), duration: micro(dur) };
  seg.volume = 0; // voice lives on its own audio track so it can lead the picture
  if (grade.length) {
    out.materials.effects ??= [];
    for (const [type, value] of grade) {
      const m = adjustMaterial(type, value);
      out.materials.effects.push(m);
      seg.extra_material_refs.push(m.id);
    }
    seg.enable_adjust = true;
  }
  const s = zoomOf[i];
  const a = anchor(s);
  seg.clip = { ...seg.clip, scale: { x: s, y: s }, transform: { x: a.x, y: a.y } };
  seg.common_keyframes = [];
  if (i === slowIdx) {
    const b = anchor(BASE_SCALE * SLOW_ZOOM_TO);
    const t0 = micro(srcStart);
    const t1 = micro(srcStart + dur);
    const ctl = Math.round((t1 - t0) * 0.3);
    const values: Record<string, [number, number]> = {
      KFTypePositionX: [a.x, b.x], KFTypePositionY: [a.y, b.y], KFTypeScaleX: [BASE_SCALE, BASE_SCALE * SLOW_ZOOM_TO], KFTypeRotation: [0, 0],
    };
    seg.common_keyframes = kfTemplate.map((k: Json) => ({
      id: uuid(),
      property_type: k.property_type,
      keyframe_list: [0, 1].map((j) => ({
        ...structuredClone(k.keyframe_list[j]),
        id: uuid(),
        graphID: j === 1 ? uuid() : undefined,
        time_offset: j === 0 ? t0 : t1,
        left_control: { x: j === 0 ? 0 : -ctl, y: 0 },
        right_control: { x: j === 0 ? ctl : 0, y: 0 },
        values: [values[k.property_type][j]],
      })),
    }));
  }
  return seg;
});
out.tracks.push({ ...mainTrack, segments: videoSegs });

// Voice track — one segment per kept range, at true (audio) timing
const voiceMat = structuredClone(audioIdx.get(audioTemplate.material_id)!.mat);
Object.assign(voiceMat, {
  id: uuid(), path: wavPath, name: path.basename(wavPath), duration: micro(audioDuration(wavPath)),
  unique_id: randomBytes(16).toString("hex"), music_id: randomUUID(), local_material_id: randomUUID(),
});
out.materials.audios ??= [];
out.materials.audios.push(voiceMat);
const voiceSegs: Json[] = [];
ranges.forEach((r, ri) => {
  const first = placed.find((p) => p.rangeIdx === ri)!;
  const seg = cloneSegment(audioTemplate, audioIdx, out);
  out.materials.audios.pop(); // drop the cloned SFX material, point at the voice instead
  seg.material_id = voiceMat.id;
  seg.volume = 1;
  seg.source_timerange = { start: micro(r.srcStart), duration: micro(r.srcEnd - r.srcStart) };
  seg.target_timerange = { start: micro(first.tlStart), duration: micro(r.srcEnd - r.srcStart) };
  voiceSegs.push(seg);
});
out.tracks.push(newTrack("audio", 0, voiceSegs));

// ─── Captions ───────────────────────────────────────────────────────────
const clean = (t: string) => {
  const bare = t.replace(/[.,!?;:"“”…—–()]/g, "");
  return /^[A-ZÀ-Ú0-9]{2,}$/.test(bare) ? bare : bare.toLowerCase();
};
interface Cap { text: string; start: number; end: number; words: Word[] }
// ─── Highlighted titles (the editor's animated "small / BIG / small" preset) ─
// temp/titles-<video>.json = [{ "match": "pagando imposto mais caro", "top": "pagando", "big": "imposto", "bottom": "mais caro" }]
// The matched words leave the running captions and show as the preset instead.
interface TitleSpec { match: string; top: string; big: string; bottom: string }
interface TitleSpan { spec: TitleSpec; start: number; end: number }
const titleSpecs: TitleSpec[] = (() => {
  const p = flag("titles") ?? path.join(TEMP_DIR, `titles-${videoBase}.json`);
  return fs.existsSync(p) ? readJson(p) : [];
})();
const titleOf = new Map<Word, number>(); // word → index of the title it belongs to
titleSpecs.forEach((spec, k) => {
  const target = spec.match.split(" ").map(normWord);
  for (let i = 0; i + target.length <= words.length; i++) {
    const span = words.slice(i, i + target.length);
    if (!span.every((w, j) => normWord(w.text) === target[j])) continue;
    const mid = (span[0].start + span[span.length - 1].end) / 2;
    if (!ranges.some((r) => mid >= r.srcStart && mid < r.srcEnd)) continue; // only a take that's in the cut
    span.forEach((w) => titleOf.set(w, k));
    break;
  }
});
const titleSpans: TitleSpan[] = [];

const caps: Cap[] = [];
ranges.forEach((r, ri) => {
  const off = placed.find((p) => p.rangeIdx === ri)!.tlStart - r.srcStart;
  let cur: { words: Word[] } = { words: [] };
  const rangeFirst = caps.length;
  const flush = (final = false) => {
    if (!cur.words.length) return;
    // a stretched word can begin before the clip — keep every timing inside the clip
    const clamp = (t: number) => Math.min(Math.max(t, r.srcStart), r.srcEnd) + off;
    const capWords = cur.words
      .map((w) => ({ text: clean(w.text), start: clamp(w.start), end: clamp(w.end) }))
      .filter((w) => w.text);
    const text = capWords.map((w) => w.text).join(" ");
    const start = capWords[0]?.start ?? clamp(cur.words[0].start);
    const end = capWords[capWords.length - 1]?.end ?? clamp(cur.words[cur.words.length - 1].end);
    const prev = caps[caps.length - 1];
    // a lone word reads as a stray — fold it into the previous caption of the same clip
    const lone = text && !text.includes(" ");
    if (lone && prev && caps.length > rangeFirst && start - prev.end < 0.4 &&
        prev.text.split(" ").length < CAPTION_MAX_WORDS + 2) {
      prev.text += ` ${text}`;
      prev.end = end;
      prev.words.push(...capWords);
    } else if (lone && !final) {
      return; // keep it and let it open the next caption ("é | só saber" → "é só saber")
    } else if (text) caps.push({ text, start, end, words: capWords });
    cur = { words: [] };
  };
  for (const w of wordsIn(r.srcStart, r.srcEnd)) {
    const k = titleOf.get(w);
    if (k !== undefined) {
      flush(true);
      const t0 = Math.max(w.start, r.srcStart) + off;
      const t1 = Math.min(w.end, r.srcEnd) + off;
      const span = titleSpans.find((s) => s.spec === titleSpecs[k]);
      if (span) span.end = t1;
      else titleSpans.push({ spec: titleSpecs[k], start: t0, end: t1 });
      continue;
    }
    const last = cur.words[cur.words.length - 1];
    if (last && (cur.words.length >= CAPTION_MAX_WORDS || w.end - cur.words[0].start > CAPTION_MAX_SEC ||
        w.start - last.end > 0.5 || (/[.!?,;:]$/.test(last.text) && cur.words.length >= 2))) flush();
    cur.words.push(w);
  }
  flush(true);
});
/**
 * Per-word timing in the layout CapCut's own auto-captions write (ms from the caption start,
 * a zero-length space token after each word). The caption template uses it to reveal
 * one word at a time — without it the whole line pops in at once.
 */
function wordTimings(c: Cap, capStart: number, capEnd: number) {
  const ms = (t: number) => Math.round(Math.min(Math.max(t - capStart, 0), capEnd - capStart) * 1000);
  const timing = { start_time: [] as number[], end_time: [] as number[], text: [] as string[] };
  const push = (text: string, s: number, e: number) => {
    timing.text.push(text);
    timing.start_time.push(s);
    timing.end_time.push(e);
  };
  let prevEnd = 0;
  c.words.forEach((w, i) => {
    if (i > 0) push(" ", prevEnd, prevEnd);
    const s = Math.max(ms(w.start), prevEnd);
    const e = Math.max(s, ms(w.end));
    push(w.text, s, e);
    prevEnd = e;
  });
  return timing;
}

// Each title stays up for its phrase (+0.3 s) and at least 1.4 s so all three lines finish animating in.
// The running captions never share the screen with a title: they're trimmed around it, and one that
// would fall entirely inside it is dropped (reported in the summary).
const TITLE_MIN_SEC = 1.4;
const titleWindows = titleSpans.map((s) => {
  const start = Math.max(0, s.start - 0.05);
  return { start, end: Math.min(totalSec, Math.max(s.end + 0.3, start + TITLE_MIN_SEC)) };
});
const captionsHiddenByTitles: string[] = [];
const trimmedByTitle = new Set<Cap>();
for (const w of titleWindows) {
  for (const c of caps) {
    if (c.end <= w.start || c.start >= w.end) continue;
    trimmedByTitle.add(c);
    if (c.start >= w.start) {
      // began under the title → shows right after it leaves, long enough to read
      c.start = w.end;
      c.end = Math.max(c.end, w.end + 0.8);
    } else c.end = Math.min(c.end, w.start); // still up when the title arrives → leave first
  }
  // captions pushed to the same moment become one, so no words are lost
  for (let i = caps.length - 1; i > 0; i--) {
    if (Math.abs(caps[i].start - caps[i - 1].start) < 0.01 && caps[i].start === w.end) {
      caps[i - 1].text += ` ${caps[i].text}`;
      caps[i - 1].words.push(...caps[i].words);
      caps[i - 1].end = Math.max(caps[i - 1].end, caps[i].end);
      caps.splice(i, 1);
    }
  }
}
// only a caption a title squeezed to nothing is dropped — short captions elsewhere stay (min length is set later)
for (let i = caps.length - 1; i >= 0; i--) {
  if (trimmedByTitle.has(caps[i]) && caps[i].end - caps[i].start < 0.3) captionsHiddenByTitles.push(caps.splice(i, 1)[0].text);
}

const textSegs = caps.map((c, i) => {
  const next = caps[i + 1]?.start ?? totalSec;
  const start = Math.max(0, c.start);
  const end = Math.min(next, Math.max(start + 0.5, c.end + 0.15));
  const seg = cloneSegment(textTemplate, styleIdx, out);
  // captions are caption templates wrapping the styled text material
  const wrapper = findMat(out, seg.material_id);
  const info = wrapper.text_info_resources?.[0];
  const mat = info ? findMat(out, info.text_material_id) : wrapper;
  if (info) info.attach_info.duration = micro(end - start);
  const content = JSON.parse(mat.content);
  content.text = c.text;
  content.styles = [{ ...content.styles[0], range: [0, c.text.length] }];
  if (captionFont) {
    content.styles[0].font = { path: captionFont, id: "" };
    mat.font_path = captionFont;
  }
  mat.content = JSON.stringify(content);
  mat.recognize_text = c.text;
  mat.recognize_task_id = "";
  mat.words = wordTimings(c, start, end);
  mat.current_words = { start_time: [], end_time: [], text: [] };
  seg.target_timerange = { start: micro(start), duration: micro(end - start) };
  for (const ref of seg.extra_material_refs) {
    const m = findMat(out, ref);
    for (const an of m.animations ?? []) if (an.type === "caption") an.duration = micro(end - start);
  }
  return seg;
});
out.tracks.push(newTrack("text", 1, textSegs));

const titleClickTimes: number[] = []; // when each title line appears (gets a mouse click)
if (titleSpans.length) {
  const presetName = flag("title-preset") ?? "Minhas predefinições5";
  const presetDir = path.join(CAPCUT_USER_DATA, "Presets/Combination/Presets", presetName);
  const preset = readJson(path.join(presetDir, "preset_draft/draft_content.json"));
  const presetId = readJson(path.join(presetDir, `${presetName}.json`)).id;
  const presetIdx = indexMaterials(preset);
  const tpl = preset.tracks[0].segments[0];
  // Layout calibrated on the preset itself ("para / advogados / de todo Brasil"): the small top line is
  // left-aligned with the big word and the bottom line right-aligned. Ink widths are measured in the real
  // fonts; INK_TO_X turns px (at 200 px) × segment scale into CapCut x units (half the canvas width).
  const INK_TO_X = 0.000669;
  const MAX_HALF = 0.9; // keep the block inside the frame
  const fontCache = path.join(CAPCUT_USER_DATA, "Cache/effect");
  const findFont = (file: string): string => {
    if (fs.existsSync(file)) return file;
    // CapCut evicts cached fonts — look for the same file name elsewhere in its effect cache
    const name = path.basename(file) === "font.ttf" ? "Montserrat-ExtraBold.ttf" : path.basename(file);
    for (const dir of fs.readdirSync(fontCache)) {
      for (const sub of fs.existsSync(path.join(fontCache, dir)) ? fs.readdirSync(path.join(fontCache, dir)) : []) {
        const p = path.join(fontCache, dir, sub, name);
        if (fs.existsSync(p)) return p.replace(/\\/g, "/");
      }
    }
    return file;
  };
  const titleSegs = titleSpans.map((span, k) => {
    const seg = cloneSegment(tpl, presetIdx, out);
    const start = titleWindows[k].start;
    const dur = titleWindows[k].end - start;
    const lineStarts: number[] = [];
    seg.target_timerange = { start: micro(start), duration: micro(dur) };
    seg.source_timerange = { start: 0, duration: micro(dur) };
    const vmat = findMat(out, seg.material_id);
    vmat.duration = micro(dur);
    vmat.material_name = `${presetName}##${presetId}`;
    const dr = seg.extra_material_refs.map((id: string) => findMat(out, id)).find((m: Json) => m.type === "combination");
    // fresh ids inside the nested timeline so two titles never share objects
    const ids = new Map<string, string>();
    const nested = JSON.parse(JSON.stringify(dr.draft).replace(UUID_RE, (id) => {
      if (!ids.has(id)) ids.set(id, uuid());
      return ids.get(id)!;
    }));
    nested.duration = micro(dur);
    const textSegsN = nested.tracks.filter((t: Json) => t.type === "text").flatMap((t: Json) => t.segments);
    const big = textSegsN.reduce((a: Json, b: Json) => (b.clip.scale.x > a.clip.scale.x ? b : a));
    const smalls = textSegsN.filter((s: Json) => s !== big).sort((a: Json, b: Json) => a.clip.transform.x - b.clip.transform.x);
    const roles: [Json, string][] = [[smalls[0], span.spec.top], [big, span.spec.big], [smalls[1], span.spec.bottom]];
    // set the texts (and a font file that exists), then measure each line's real width on screen
    const width = new Map<Json, number>();
    for (const [s, text] of roles) {
      if (!s) continue;
      if (text) lineStarts.push(start + sec(s.target_timerange.start));
      const mat = nested.materials.texts.find((t: Json) => t.id === s.material_id);
      const content = JSON.parse(mat.content);
      const font = findFont(content.styles[0].font?.path ?? mat.font_path);
      content.text = text;
      content.styles = [{ ...content.styles[0], range: [0, text.length], font: { ...content.styles[0].font, path: font } }];
      mat.content = JSON.stringify(content);
      mat.font_path = font;
      width.set(s, inkWidth(text, font) * INK_TO_X);
      s.target_timerange.duration = micro(dur) - s.target_timerange.start; // stay up to the end; out-animations are end-relative
    }
    // a long big word is scaled down to fit the frame
    const bigHalf0 = (width.get(big)! * big.clip.scale.x) / 2;
    if (bigHalf0 > MAX_HALF) {
      const s = big.clip.scale.x * (MAX_HALF / bigHalf0);
      big.clip.scale = { x: s, y: s };
    }
    const bigHalf = (width.get(big)! * big.clip.scale.x) / 2;
    const topW = smalls[0] ? width.get(smalls[0])! * smalls[0].clip.scale.x : 0;
    const botW = smalls[1] ? width.get(smalls[1])! * smalls[1].clip.scale.x : 0;
    // like "para / advogados / de todo Brasil": the top line starts at the big word's left edge and the
    // bottom line ends at its right edge, even when they're wider than it (kept inside the frame)
    if (smalls[0]) smalls[0].clip.transform.x = Math.min(-bigHalf + topW / 2, MAX_HALF - topW / 2);
    if (smalls[1]) smalls[1].clip.transform.x = Math.max(bigHalf - botW / 2, -MAX_HALF + botW / 2);
    // centre the whole block on screen (it leans sideways when a small line is wider than the big word)
    const lines: [Json, number][] = [[big, bigHalf * 2], ...(smalls[0] ? [[smalls[0], topW]] : []), ...(smalls[1] ? [[smalls[1], botW]] : [])] as [Json, number][];
    const left = Math.min(...lines.map(([s, w]) => s.clip.transform.x - w / 2));
    const right = Math.max(...lines.map(([s, w]) => s.clip.transform.x + w / 2));
    for (const [s] of lines) s.clip.transform.x -= (left + right) / 2;

    // letters must not touch: draw each line where it lands and nudge the small ones away if they collide
    const PX = 540; // canvas px per x/y unit horizontally; vertical uses 960
    const place = (s: Json): PlacedText => {
      const m = nested.materials.texts.find((t: Json) => t.id === s.material_id);
      const c = JSON.parse(m.content);
      return { text: c.text, font: m.font_path, size: 200 * INK_TO_X * PX * s.clip.scale.x,
        cx: 540 + s.clip.transform.x * PX, cy: 960 - s.clip.transform.y * 960 - 560 };
    };
    const [W, H] = [1080, 800]; // band around the title (canvas rows 560–1360)
    const [bigMask] = inkMasks([place(big)], W, H);
    if (smalls[0] && span.spec.top) {
      const [m] = inkMasks([place(smalls[0])], W, H);
      smalls[0].clip.transform.y += clearShift(m, bigMask, W, H, -1) / 960; // move up
    }
    if (smalls[1] && span.spec.bottom) {
      const [m] = inkMasks([place(smalls[1])], W, H);
      smalls[1].clip.transform.y -= clearShift(m, bigMask, W, H, 1) / 960; // move down
    }
    dr.draft = nested;
    titleClickTimes.push(...lineStarts);
    return seg;
  });
  out.tracks.push(newTrack("video", 2, titleSegs));
}

// ─── Transitions: flash + riser at ~1/3 and ~2/3, boom at the open ──────
const realCuts = placed.filter((p, i) => i > 0 && !p.zoomCut).map((p) => p.tlStart);
const transitions: number[] = [];
for (const frac of totalSec > 40 ? [1 / 3, 2 / 3] : [1 / 2]) {
  const want = totalSec * frac;
  const pick = realCuts.filter((t) => t > 4 && totalSec - t > 4 && !transitions.includes(t))
    .sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
  if (pick !== undefined) transitions.push(pick);
}
transitions.sort((a, b) => a - b);

const flashDur = sec(flashTemplate.target_timerange.duration);
const flashSegs = transitions.map((t) => {
  const seg = cloneSegment(flashTemplate, styleIdx, out);
  seg.target_timerange = { start: micro(t - 0.1), duration: micro(flashDur) };
  return seg;
});
out.tracks.push(newTrack("video", 2, flashSegs));

// Every effect peaks at the same level, --sfx-peak (default −12 dBFS): the editor mixes the voice at
// −6 dB and the music at −12 dB, so effects never poke out above the bed. The clip volume is set from
// the measured peak of the exact source window used.
const SFX_PEAK_DB = parseFloat(flag("sfx-peak") ?? "-12");
const peakCache = new Map<string, number>();
function sfxGain(file: string, from: number, to: number): number {
  const key = `${file}|${from}|${to}`;
  let peak = peakCache.get(key);
  if (peak === undefined) {
    peak = filePeakDb(file, from, Math.max(0.02, to - from));
    peakCache.set(key, peak);
  }
  return Math.min(10, Math.pow(10, (SFX_PEAK_DB - peak) / 20)); // linear gain, capped at CapCut's +20 dB
}

function sfxSeg(key: keyof typeof SFX, at: number, srcStart = 0, srcEnd?: number): Json {
  const file = `${SFX_DIR}/${SFX[key].file}`;
  const fileDur = audioDuration(file);
  const end = Math.min(srcEnd ?? fileDur, fileDur, srcStart + (totalSec - at));
  const seg = cloneSegment(audioTemplate, audioIdx, out);
  const mat = findMat(out, seg.material_id);
  Object.assign(mat, {
    path: file, name: SFX[key].file, duration: micro(fileDur),
    unique_id: randomBytes(16).toString("hex"), music_id: randomUUID(), local_material_id: randomUUID(),
  });
  seg.volume = sfxGain(file, srcStart, end);
  seg.source_timerange = { start: micro(srcStart), duration: micro(end - srcStart) };
  seg.target_timerange = { start: micro(at), duration: micro(end - srcStart) };
  return seg;
}

out.tracks.push(newTrack("audio", 0, [sfxSeg("boom", 0)]));
out.tracks.push(newTrack("audio", 0, transitions.map((t) => sfxSeg("riser", t - 0.9))));
out.tracks.push(newTrack("audio", 0, transitions.map((t) => sfxSeg("lowRiser", t - 1.47, 2.87, 4.47))));
transitions.forEach((t) => out.tracks.push(newTrack("audio", 0, [sfxSeg("transition", t - 0.63)])));

// whoosh on up to two punch-in cuts away from the flash transitions
const punchCuts = placed
  .map((p, i) => ({ t: p.tlStart, i }))
  .filter(({ t, i }) => i > 0 && zoomOf[i] > BASE_SCALE && transitions.every((x) => Math.abs(x - t) > 4));
const whooshAt = [0.25, 0.75]
  .map((f) => punchCuts.sort((a, b) => Math.abs(a.t - totalSec * f) - Math.abs(b.t - totalSec * f))[0]?.t)
  .filter((t, k, arr): t is number => t !== undefined && arr.indexOf(t) === k);
if (whooshAt.length) out.tracks.push(newTrack("audio", 0, whooshAt.map((t) => sfxSeg("whoosh", t - 0.46, 0.37, 2.73))));

// Cut accents: a click on every punch-in, a soft pop on every zoom-out, a pop-up on the call to action
// and a short whoosh into the slow push-in — never within 1 s of a sound already placed.
// a mouse click on every line of a highlighted title, the moment that word appears
if (titleClickTimes.length) {
  out.tracks.push(newTrack("audio", 0, titleClickTimes.map((t) => sfxSeg("mouseClick", t - 0.02, 0.1, 0.28))));
}
const busy = [0, ...transitions, ...whooshAt, ...titleClickTimes];
const free = (t: number) => busy.every((x) => Math.abs(x - t) >= 1);
// the call-to-action pop-up and the slow-zoom whoosh are claimed first, so a cut accent can't crowd them out
const cta = caps.find((c) => /direct|link da bio|agende|me chama|fala comigo|me manda/i.test(c.text));
if (cta && free(cta.start)) {
  busy.push(cta.start);
  out.tracks.push(newTrack("audio", 0, [sfxSeg("popUp", cta.start - 0.03, 1.95, 2.12)]));
}
if (slowIdx > 0 && free(placed[slowIdx].tlStart)) {
  busy.push(placed[slowIdx].tlStart);
  out.tracks.push(newTrack("audio", 0, [sfxSeg("shortWhoosh", placed[slowIdx].tlStart - 0.25, 0.2, 0.85)]));
}
const clicks: Json[] = [];
const pops: Json[] = [];
let clickTurn = 0;
placed.forEach((p, i) => {
  if (i === 0) return;
  const cut = p.tlStart + picShift[i]; // where the picture actually cuts (after the J-cut lead)
  if (zoomOf[i] === zoomOf[i - 1] || !free(cut)) return;
  busy.push(cut);
  if (zoomOf[i] > zoomOf[i - 1]) {
    clicks.push(clickTurn++ % 2 === 0 ? sfxSeg("mouseClick", cut - 0.1, 0.1, 0.28) : sfxSeg("buttonClick", cut - 0.01, 0, 0.12));
  } else pops.push(sfxSeg("softPop", cut - 0.01, 0, 0.16));
});
if (clicks.length) out.tracks.push(newTrack("audio", 0, clicks));
if (pops.length) out.tracks.push(newTrack("audio", 0, pops));

// ─── Write the project ──────────────────────────────────────────────────
// Default: a copy named "<rough>-EDITADO". --in-place: into the editor's own project, after a backup.
const IN_PLACE = args.includes("--in-place");
const nowMicro = Date.now() * 1000;
let outName = roughName;
let outDir = roughDir;
let backupDir: string | null = null;
if (IN_PLACE) {
  if (rough.materials.audios?.some((a: Json) => a.path === wavPath)) {
    throw new Error(`${roughName} was already edited by this script — restore its backup (temp/backups) before running again`);
  }
  backupDir = path.join(TEMP_DIR, "backups", `${roughName}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.cpSync(roughDir, backupDir, { recursive: true });
} else {
  // --out=NAME picks the copy's name (e.g. when the rough cut was a temporary project)
  const wanted = flag("out") ?? `${roughName}-EDITADO`;
  outName = wanted;
  for (let n = 2; fs.existsSync(path.join(DRAFTS, outName)); n++) outName = `${wanted}-${n}`;
  outDir = path.join(DRAFTS, outName);
  fs.cpSync(roughDir, outDir, { recursive: true });
}

const project = readJson(path.join(outDir, "Timelines/project.json"));
const oldTl = project.main_timeline_id;
// a copy needs its own timeline id so CapCut doesn't confuse it with the original
const newTl = IN_PLACE ? oldTl : uuid();
if (!IN_PLACE) fs.renameSync(path.join(outDir, "Timelines", oldTl), path.join(outDir, "Timelines", newTl));
const tlDir = path.join(outDir, "Timelines", newTl);
// pending undo patches and autosave temp files describe the old timeline — drop them
fs.rmSync(path.join(tlDir, "attachment", "patch"), { recursive: true, force: true });
for (const f of fs.readdirSync(tlDir)) if (/\.(bak|tmp)$/.test(f)) fs.rmSync(path.join(tlDir, f));
for (const f of fs.readdirSync(outDir)) if (/\.(bak|tmp)$/.test(f)) fs.rmSync(path.join(outDir, f));

if (!IN_PLACE) {
  project.id = uuid();
  project.main_timeline_id = newTl;
  project.timelines = project.timelines.map((t: Json) => (t.id === oldTl ? { ...t, id: newTl, update_time: nowMicro } : t));
  fs.writeFileSync(path.join(outDir, "Timelines/project.json"), JSON.stringify(project));
  const layoutPath = path.join(outDir, "timeline_layout.json");
  if (fs.existsSync(layoutPath)) fs.writeFileSync(layoutPath, fs.readFileSync(layoutPath, "utf-8").split(oldTl).join(newTl));
}

// every material of the speaker video carries its true length (a 60 s value makes CapCut reset clips)
for (const m of out.materials.videos ?? []) if (m.path === videoMat.path) m.duration = micro(realVideoDur);

out.id = newTl;
out.name = outName;
out.duration = micro(totalSec);
// compound clips (flash, titles) keep their nested timeline in <project>/subdraft/<id>/ as well
for (const dr of out.materials.drafts ?? []) {
  if (dr.type !== "combination" || !dr.draft) continue;
  const subId = uuid();
  fs.mkdirSync(path.join(outDir, "subdraft", subId), { recursive: true });
  fs.writeFileSync(path.join(outDir, "subdraft", subId, "draft_content.json"), JSON.stringify(dr.draft));
  dr.draft_file_path = `##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##\\subdraft\\${subId}\\draft_content.json`;
}

const outJson = JSON.stringify(out);
fs.writeFileSync(path.join(outDir, "draft_content.json"), outJson);
fs.writeFileSync(path.join(tlDir, "draft_content.json"), outJson);

const meta = readJson(path.join(outDir, "draft_meta_info.json"));
// CapCut may re-sync a material's length from these entries on open and reset every clip starting
// past it to 0:00 — the rough builder used to write a 60 s placeholder here
for (const group of meta.draft_materials ?? []) {
  for (const m of group.value ?? []) {
    if ((m.file_Path ?? "").replace(/\\/g, "/") !== videoMat.path.replace(/\\/g, "/")) continue;
    m.duration = micro(realVideoDur);
    m.roughcut_time_range = { start: 0, duration: micro(realVideoDur) };
  }
}
Object.assign(meta, {
  ...(IN_PLACE ? {} : { draft_id: uuid(), draft_name: outName, draft_fold_path: outDir.replace(/\\/g, "/"), tm_draft_create: nowMicro }),
  tm_duration: micro(totalSec), tm_draft_modified: nowMicro,
  draft_timeline_materials_size_: Buffer.byteLength(outJson),
});
fs.writeFileSync(path.join(outDir, "draft_meta_info.json"), JSON.stringify(meta));
if (backupDir) console.error(`  backup of the original project: ${backupDir}`);

console.log(JSON.stringify({
  project: outName,
  durationSec: +totalSec.toFixed(2),
  clips: placed.length,
  zoomCuts: placed.filter((p) => p.zoomCut).length,
  jCuts: picShift.filter(Boolean).length,
  slowZoomAt: slowIdx >= 0 ? +placed[slowIdx].tlStart.toFixed(2) : null,
  captions: caps.length,
  transitions: transitions.map((t) => +t.toFixed(2)),
  whooshAt: whooshAt.map((t) => +t.toFixed(2)),
  titles: titleSpans.map((s, k) => `${titleWindows[k].start.toFixed(2)}s ${s.spec.big}`),
  captionsHiddenByTitles,
  removedOffCamera,
  retakesUsed: retakes,
  pausesCut,
}));
