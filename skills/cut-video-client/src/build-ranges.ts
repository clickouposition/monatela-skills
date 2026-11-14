/**
 * Build a rough-cut CapCut project from an explicit list of kept takes.
 *
 * Use when the cut was decided by reading the transcript take by take (e.g. against a script,
 * keeping only the on-camera speaker) — the keep list is the cut, nothing else is applied.
 * Each take's edges are snapped to the waveform: start ~40 ms before the voice rises,
 * end ~120 ms after it falls (stretched last words in the transcript don't leak silence).
 *
 * Usage:
 *   npx tsx src/build-ranges.ts <absolute-video-path> <PROJECT-NAME> <keeps.json>
 * keeps.json: [[firstWordStartSec, lastWordEndSec], ...] in timeline order, on the normalized video.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { buildRoughcutProject } from "./capcut-builder.js";

const DRAFTS = path.join(process.env.LOCALAPPDATA ?? "", "CapCut/User Data/Projects/com.lveditor.draft");
const TEMP_DIR = path.resolve(import.meta.dirname, "..", "temp");
const SPEECH_DB = -38;
const FRAME = 0.01;
const PAD_IN = 0.04;
const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
// --end-db / --pad-out tighten sentence endings: the voice's fading tail between −38 and −30 dB
// is dropped with --end-db=-30, and --pad-out sets the silence kept after it
const END_DB = parseFloat(flag("end-db") ?? String(SPEECH_DB));
const PAD_OUT = parseFloat(flag("pad-out") ?? "0.12");

const [videoArg, projectName, keepsArg] = args.filter((a) => !a.startsWith("--"));
if (!videoArg || !projectName || !keepsArg) {
  console.error("Usage: npx tsx src/build-ranges.ts <absolute-video-path> <PROJECT-NAME> <keeps.json> [--end-db=-30] [--pad-out=0.05]");
  process.exit(1);
}
const base = path.basename(videoArg, path.extname(videoArg));
const normalized = path.join(TEMP_DIR, `normalized-${base}.mp4`).replace(/\\/g, "/");
const wav = path.join(TEMP_DIR, `audio-normalized-${base}.wav`);
if (!fs.existsSync(normalized) || !fs.existsSync(wav)) throw new Error(`run analyze on ${videoArg} first`);
const keeps: [number, number][] = JSON.parse(fs.readFileSync(keepsArg, "utf-8"));

// 10 ms level frames of the voice track
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
const level = new Float32Array(Math.floor(dataLen / 2 / ch / perFrame));
for (let f = 0; f < level.length; f++) {
  let sum = 0;
  for (let i = 0; i < perFrame; i++) {
    const v = buf.readInt16LE(dataAt + (f * perFrame + i) * 2 * ch) / 32768;
    sum += v * v;
  }
  level[f] = 10 * Math.log10(sum / perFrame + 1e-12);
}
const videoDur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${normalized}"`).toString());
const frame = (t: number) => Math.max(0, Math.min(level.length - 1, Math.round(t / FRAME)));
const loud = (f: number) => level[f] > SPEECH_DB;

interface Word { text: string; start: number; end: number }
const words: Word[] = JSON.parse(fs.readFileSync(path.join(TEMP_DIR, `transcript-words-normalized-${base}.json`), "utf-8")).words;

const clips = keeps.map(([wordStart, wordEnd]) => {
  // the search for the voice edges never crosses into the neighbouring words (another take)
  // the previous word is one that has already ended — a keep that starts slightly late must not
  // treat its own first word as a neighbour
  const prevEnd = Math.max(0, ...words.filter((w) => w.end <= wordStart + 0.05).map((w) => w.end));
  const nextStart = Math.min(videoDur, ...words.filter((w) => w.start > wordEnd - 0.01).map((w) => w.start));
  const lastWord = [...words].reverse().find((w) => w.start < wordEnd - 0.01) ?? { start: wordEnd, end: wordEnd };

  // first loud frame from just before the first word; last loud frame up to just after the last word
  let s = frame(Math.max(wordStart - 0.3, prevEnd));
  while (s < frame(wordEnd) && !loud(s)) s++;
  let e = frame(Math.min(wordEnd + 0.3, nextStart - 0.02));
  while (e > s && !(level[e] > END_DB)) e--;
  // The transcript often stamps the next take a little late, so the window above can reach its
  // first syllable. Voice that comes back after a ≥150 ms pause past the last word is the next take.
  for (let f = frame(lastWord.start), quiet = 0, lastLoud = f; f <= e; f++) {
    if (loud(f)) {
      if (quiet >= 15) { e = lastLoud; break; }
      lastLoud = f;
      quiet = 0;
    } else quiet++;
  }
  const start = Math.max(prevEnd - 0.02, s * FRAME - PAD_IN, 0);
  // a softly spoken last word sits below the speech threshold — never cut into it
  const wordFloor = Math.min(lastWord.end, lastWord.start + 0.4) + 0.05;
  const end = Math.min(nextStart - 0.02, Math.max(e * FRAME + PAD_OUT, wordFloor));
  return { sourcePath: normalized, sourceStartSec: start, sourceDurationSec: end - start };
});

let name = projectName;
for (let n = 2; fs.existsSync(path.join(DRAFTS, name)); n++) name = `${projectName}-${n}`;
buildRoughcutProject({ projectName: name, draftsDir: DRAFTS, clips, hookText: "", sourceVideoDurationSec: videoDur });

// no hook on these projects — drop the empty text track the builder always adds
for (const file of [path.join(DRAFTS, name, "draft_content.json"), ...fs.readdirSync(path.join(DRAFTS, name, "Timelines"))
  .filter((d) => fs.existsSync(path.join(DRAFTS, name, "Timelines", d, "draft_content.json")))
  .map((d) => path.join(DRAFTS, name, "Timelines", d, "draft_content.json"))]) {
  const draft = JSON.parse(fs.readFileSync(file, "utf-8"));
  draft.tracks = draft.tracks.filter((t: any) => t.type !== "text");
  draft.materials.texts = [];
  fs.writeFileSync(file, JSON.stringify(draft));
}

const total = clips.reduce((s, c) => s + c.sourceDurationSec, 0);
console.log(JSON.stringify({ project: name, clips: clips.length, durationSec: +total.toFixed(2) }));
