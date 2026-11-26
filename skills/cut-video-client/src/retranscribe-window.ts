/**
 * Re-transcribe one time window in a forced language and splice the words back
 * into temp/transcript-words-normalized-<video>.json (for takes the auto language
 * detection got wrong, e.g. Portuguese transcribed as English).
 *   npx tsx src/retranscribe-window.ts <video-basename> <startSec> <endSec> [lang=pt]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AssemblyAI } from "assemblyai";
import { findFfmpeg } from "./ffmpeg.js";

const [video, a, b, lang = "pt"] = process.argv.slice(2);
const TEMP = path.resolve(import.meta.dirname, "..", "temp");
const env = fs.readFileSync(path.resolve(import.meta.dirname, "..", ".env"), "utf8");
const apiKey = env.match(/^ASSEMBLYAI_API_KEY=(.*)$/m)?.[1]?.trim();
if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY missing");
const start = parseFloat(a), end = parseFloat(b);
const wav = path.join(TEMP, `window-${video}-${start}-${end}.wav`);
execFileSync(findFfmpeg(true), ["-v", "error", "-y", "-ss", String(start), "-t", String(end - start), "-i", path.join(TEMP, `audio-normalized-${video}.wav`), "-c:a", "pcm_s16le", wav]);
const t = await new AssemblyAI({ apiKey }).transcripts.transcribe({ audio: wav, language_code: lang as any, speech_models: ["universal-3-pro"] as any });
if (t.status === "error") throw new Error(t.error);
const fresh = (t.words ?? []).map((w) => ({ text: w.text, start: start + w.start / 1000, end: start + w.end / 1000, confidence: w.confidence }));
const file = path.join(TEMP, `transcript-words-normalized-${video}.json`);
const j = JSON.parse(fs.readFileSync(file, "utf8"));
fs.copyFileSync(file, file + `.bak-${Date.now()}`);
j.words = [...j.words.filter((w: any) => w.start < start || w.start >= end), ...fresh].sort((x: any, y: any) => x.start - y.start);
j.fullText = j.words.map((w: any) => w.text).join(" ");
fs.writeFileSync(file, JSON.stringify(j, null, 2));
fs.rmSync(wav);
console.log(fresh.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(" "));
