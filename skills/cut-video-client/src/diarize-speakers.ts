/**
 * diarize-speakers — identifies which speaker in a video is the on-camera
 * subject vs an off-camera/background voice (director, assistant, phone call).
 *
 * Rationale: a single mic (camera mic or a room mic) picks up everyone in the
 * room. AssemblyAI's speaker diarization clusters the audio into speaker
 * labels, but doesn't know which cluster is "on camera". We disambiguate by
 * loudness: the person being filmed is almost always closest to the mic, so
 * their utterances measure louder (higher mean_volume) than a person further
 * away or off to the side. This script diarizes the audio, measures loudness
 * per speaker cluster via ffmpeg volumedetect, and recommends which speaker
 * label is the on-camera subject.
 *
 * This is a heuristic, not a certainty — always surface the numbers and the
 * recommendation to the user for confirmation rather than silently trusting it,
 * especially when speakers are close in volume (within ~3dB) or when only one
 * speaker is detected (nothing to disambiguate).
 */
import { resolve, join, basename, extname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { AssemblyAI } from "assemblyai";
import { findFfmpeg } from "./ffmpeg.js";

const TEMP_DIR = resolve(import.meta.dirname, "..", "temp");

function loadEnvKey(key: string): string | undefined {
  const envPath = resolve(import.meta.dirname, "..", ".env");
  if (!existsSync(envPath)) return process.env[key];
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k === key) return v;
  }
  return process.env[key];
}

interface Utterance {
  speaker: string;
  start: number; // seconds
  end: number; // seconds
  text: string;
}

function meanVolumeDb(videoPath: string, ffmpegPath: string, startSec: number, durSec: number): number | null {
  try {
    const cmd = `"${ffmpegPath}" -ss ${startSec} -i "${videoPath}" -t ${durSec} -af "volumedetect" -f null - 2>&1`;
    const out = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
    const match = out.match(/mean_volume:\s*(-?\d+(\.\d+)?)\s*dB/);
    return match ? parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: tsx src/diarize-speakers.ts <normalized-video-path>");
    process.exit(1);
  }

  const videoPath = resolve(args[0]);
  if (!existsSync(videoPath)) {
    console.error(`Video not found: ${videoPath}`);
    process.exit(1);
  }

  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

  const apiKey = loadEnvKey("ASSEMBLYAI_API_KEY");
  if (!apiKey) {
    console.error("ASSEMBLYAI_API_KEY not set in .env");
    process.exit(1);
  }

  const ffmpegPath = findFfmpeg(true);
  const videoName = basename(videoPath, extname(videoPath));
  const cachePath = join(TEMP_DIR, `diarized-${videoName}.json`);

  let utterances: Utterance[];
  if (existsSync(cachePath)) {
    console.log("  Using cached diarization...");
    utterances = JSON.parse(readFileSync(cachePath, "utf-8"));
  } else {
    // Reuse the audio already extracted for word-level transcription if present,
    // otherwise extract a fresh mono WAV.
    let audioPath = join(TEMP_DIR, `audio-${videoName}.wav`);
    if (!existsSync(audioPath)) {
      console.log("  Extracting audio...");
      execSync(`"${ffmpegPath}" -y -i "${videoPath}" -vn -ac 1 -c:a pcm_s16le "${audioPath}"`, {
        stdio: "pipe",
        timeout: 120000,
      });
    }

    console.log("  Diarizing with AssemblyAI (speaker labels)...");
    const client = new AssemblyAI({ apiKey });
    const transcript = await client.transcripts.transcribe({
      audio: resolve(audioPath),
      speech_models: ["universal-3-pro"] as any,
      speaker_labels: true,
    });

    if (transcript.status === "error") {
      throw new Error(`AssemblyAI diarization failed: ${transcript.error}`);
    }

    utterances = (transcript.utterances ?? []).map((u) => ({
      speaker: u.speaker,
      start: u.start / 1000,
      end: u.end / 1000,
      text: u.text,
    }));

    writeFileSync(cachePath, JSON.stringify(utterances, null, 2), "utf-8");
  }

  const speakerLabels = [...new Set(utterances.map((u) => u.speaker))];

  if (speakerLabels.length <= 1) {
    console.log(JSON.stringify({
      speakers: speakerLabels,
      onCameraSpeaker: speakerLabels[0] ?? null,
      confidence: "trivial",
      note: "Only one speaker detected — nothing to disambiguate.",
      utterances,
    }));
    return;
  }

  // Sample loudness for each speaker: take up to 5 of their longest utterances
  // (longer clips give a more stable mean_volume reading than tiny fragments).
  const loudness: Record<string, number[]> = {};
  for (const label of speakerLabels) {
    const samples = utterances
      .filter((u) => u.speaker === label && u.end - u.start >= 1.5)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))
      .slice(0, 5);
    loudness[label] = [];
    for (const s of samples) {
      const db = meanVolumeDb(videoPath, ffmpegPath, s.start, Math.min(s.end - s.start, 10));
      if (db !== null) loudness[label].push(db);
    }
  }

  const avgLoudness: Record<string, number | null> = {};
  for (const label of speakerLabels) {
    const vals = loudness[label];
    avgLoudness[label] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  const ranked = speakerLabels
    .filter((l) => avgLoudness[l] !== null)
    .sort((a, b) => (avgLoudness[b] as number) - (avgLoudness[a] as number));

  const loudest = ranked[0] ?? null;
  const secondLoudest = ranked[1];
  const gap = loudest && secondLoudest
    ? (avgLoudness[loudest] as number) - (avgLoudness[secondLoudest] as number)
    : null;

  const confidence = gap === null ? "unknown" : gap >= 5 ? "high" : gap >= 2 ? "medium" : "low";

  console.log(JSON.stringify({
    speakers: speakerLabels,
    avgLoudnessDb: avgLoudness,
    onCameraSpeaker: loudest,
    loudnessGapDb: gap,
    confidence,
    note: confidence === "low" || confidence === "unknown"
      ? "Loudness gap is small or missing — CONFIRM with the user before trusting this, don't assume."
      : "Loudest speaker is presumed on-camera (closest to mic). Still worth a quick confirmation with the user.",
    utterances,
  }, null, 2));
}

main();
