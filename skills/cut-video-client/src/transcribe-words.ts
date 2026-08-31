import { resolve, join, basename, extname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { AssemblyAI } from "assemblyai";

const TEMP_DIR = resolve(import.meta.dirname, "..", "temp");

export interface WordTimestamp {
  text: string;
  start: number; // seconds
  end: number;   // seconds
  confidence: number; // 0-1, from transcription provider
}

export interface WordTranscriptResult {
  words: WordTimestamp[];
  fullText: string;
}

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

/**
 * Transcribe a video using AssemblyAI with word-level timestamps.
 * Caches results to temp/transcript-words-{video}.json.
 */
export async function transcribeWords(
  videoPath: string,
  ffmpegPath: string
): Promise<WordTranscriptResult> {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const WORD_MODEL = "assemblyai-wav-v2";
  const videoBaseName = basename(videoPath, extname(videoPath));
  const wordsPath = join(TEMP_DIR, `transcript-words-${videoBaseName}.json`);
  const wordModelMarkerPath = join(TEMP_DIR, `transcript-words-model-${videoBaseName}.txt`);

  // Cache check: if transcript-words.json is newer than the video AND same model, reuse it
  if (existsSync(wordsPath)) {
    const videoMtime = statSync(resolve(videoPath)).mtimeMs;
    const wordsMtime = statSync(wordsPath).mtimeMs;
    const cachedModel = existsSync(wordModelMarkerPath) ? readFileSync(wordModelMarkerPath, "utf-8").trim() : "";
    if (wordsMtime > videoMtime && cachedModel === WORD_MODEL) {
      console.log("  Using cached word-level transcript (same model)...");
      const cached: WordTranscriptResult = JSON.parse(readFileSync(wordsPath, "utf-8"));
      console.log(`  ${cached.words.length} words loaded`);
      return cached;
    } else if (cachedModel !== WORD_MODEL) {
      console.log(`  Word model changed (${cachedModel || "unknown"} -> ${WORD_MODEL}), re-transcribing...`);
    }
  }

  // Load API key
  const apiKey = loadEnvKey("ASSEMBLYAI_API_KEY");
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY not set in .env — get one at https://www.assemblyai.com/");
  }

  // Extract audio to a WAV file at the source sample rate.
  // Using WAV (not MP3) and skipping resampling avoids timing offsets that
  // would shift AssemblyAI's word timestamps relative to the original video
  // (MP3 encoder priming + libsamplerate latency can shift words by ~1s).
  const audioPath = join(TEMP_DIR, `audio-${videoBaseName}.wav`);
  if (!existsSync(audioPath)) {
    console.log("  Extracting audio for AssemblyAI upload...");
    const { execSync } = await import("node:child_process");
    const ffmpegPath = "ffmpeg";
    const cmd = `"${ffmpegPath}" -y -i "${resolve(videoPath)}" -vn -ac 1 -c:a pcm_s16le "${audioPath}"`;
    execSync(cmd, { stdio: "pipe", timeout: 120000 });
    const sizeMB = (statSync(audioPath).size / 1024 / 1024).toFixed(1);
    console.log(`  Audio extracted (WAV, source rate, no resample): ${sizeMB} MB`);
  }

  console.log("  Transcribing with AssemblyAI (word-level)...");

  const client = new AssemblyAI({ apiKey });
  const transcript = await client.transcripts.transcribe({
    audio: resolve(audioPath),
    speech_models: ["universal-3-pro"] as any,
  });

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI transcription failed: ${transcript.error}`);
  }

  // Map AssemblyAI response to WordTimestamp[] (AssemblyAI returns ms, we use seconds)
  const words: WordTimestamp[] = (transcript.words ?? []).map(w => ({
    text: w.text,
    start: w.start / 1000,
    end: w.end / 1000,
    confidence: w.confidence,
  }));

  const fullText = words.map(w => w.text).join(" ");
  const result: WordTranscriptResult = { words, fullText };

  // Save to cache with model marker
  writeFileSync(wordsPath, JSON.stringify(result, null, 2), "utf-8");
  writeFileSync(wordModelMarkerPath, WORD_MODEL, "utf-8");
  console.log(`  Word-level transcription complete: ${words.length} words`);

  // Save debug file
  const debugPath = join(TEMP_DIR, `transcript-words-debug-${videoBaseName}.txt`);
  const debugLines = words.map(
    (w) => `[${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s] (${(w.confidence * 100).toFixed(0)}%) "${w.text}"`
  );
  writeFileSync(debugPath, debugLines.join("\n"), "utf-8");
  console.log(`  Word transcript saved to: ${debugPath}`);

  return result;
}
