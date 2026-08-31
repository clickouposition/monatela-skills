/**
 * Transcribe video using Gemini 2.5 Flash with silence-stripped audio.
 *
 * KEY INSIGHT: Gemini timestamps on raw audio drift by 30-40+ seconds.
 * Solution: Strip silence first (same as old Whisper approach), send the
 * stripped audio to Gemini, then remap timestamps back to original video time
 * using the silence-gap time mapping.
 *
 * This gives us:
 * - Gemini's accurate text (no hallucinations)
 * - FFmpeg's accurate timing (frame-accurate via silence detection)
 * - Correct timestamps that actually match where speech is in the video
 */

import { resolve, join, basename, extname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const TEMP_DIR = resolve(import.meta.dirname, "..", "temp");

export interface TranscriptSegment {
  start: number; // milliseconds
  end: number;   // milliseconds
  text: string;
}

export interface WordTimestamp {
  text: string;
  start: number; // seconds
  end: number;   // seconds
  confidence: number; // 0-1, from transcription provider
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

interface TimeMapEntry {
  strippedStart: number; // seconds in stripped audio
  originalStart: number; // seconds in original video
  duration: number;      // seconds
}

export async function transcribeWithGemini(
  videoPath: string,
  ffmpegPath: string
): Promise<{ segments: TranscriptSegment[]; words: WordTimestamp[] }> {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

  const apiKey = loadEnvKey("GEMINI_API_KEY");
  if (!apiKey) {
    console.log("  GEMINI_API_KEY not set. Cannot transcribe.");
    return { segments: [], words: [] };
  }

  const videoBaseName = basename(videoPath, extname(videoPath));
  const segmentsPath = join(TEMP_DIR, `transcript-${videoBaseName}.json`);
  const wordsPath = join(TEMP_DIR, `transcript-words-${videoBaseName}.json`);
  const modelMarkerPath = join(TEMP_DIR, `transcript-model-${videoBaseName}.txt`);
  const MODEL_NAME = "gemini-2.5-flash-stripped";

  // Cache check
  if (existsSync(segmentsPath) && existsSync(wordsPath)) {
    const videoMtime = statSync(resolve(videoPath)).mtimeMs;
    const transcriptMtime = statSync(segmentsPath).mtimeMs;
    const cachedModel = existsSync(modelMarkerPath) ? readFileSync(modelMarkerPath, "utf-8").trim() : "";
    if (transcriptMtime > videoMtime && cachedModel === MODEL_NAME) {
      console.log("  Using cached Gemini transcript...");
      const segments = loadSegmentsFromCache(segmentsPath);
      const wordData = JSON.parse(readFileSync(wordsPath, "utf-8"));
      console.log(`  ${segments.length} segments, ${wordData.words?.length || 0} words`);
      return { segments, words: wordData.words || [] };
    }
  }

  // Step 1: Extract 16kHz mono WAV
  const wavPath = join(TEMP_DIR, `audio-16k-${videoBaseName}.wav`);
  if (!existsSync(wavPath)) {
    console.log("  Extracting audio...");
    execSync(
      `"${ffmpegPath}" -y -i "${resolve(videoPath)}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`,
      { stdio: "pipe", timeout: 120000 }
    );
  }
  const escapedInput = wavPath.replace(/\\/g, "/");

  // Step 2: Detect silence and build speech segments + time mapping
  console.log("  Detecting silence for audio pre-processing...");
  let silenceOutput = "";
  try {
    silenceOutput = execSync(
      `"${ffmpegPath}" -i "${escapedInput}" -af silencedetect=noise=-30dB:d=0.8 -f null - 2>&1`,
      { encoding: "utf-8", timeout: 60000, shell: true as any }
    );
  } catch (e: any) {
    silenceOutput = e.stdout || e.stderr || "";
  }

  const silenceStarts: number[] = [];
  const silenceEnds: number[] = [];
  for (const line of silenceOutput.split("\n")) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    if (startMatch) silenceStarts.push(parseFloat(startMatch[1]));
    if (endMatch) silenceEnds.push(parseFloat(endMatch[1]));
  }

  // Get total duration
  let totalDuration = 0;
  try {
    const durationOut = execSync(`"${ffmpegPath}" -i "${escapedInput}" 2>&1`, {
      encoding: "utf-8", timeout: 10000, shell: true as any
    }).toString();
    const durMatch = durationOut.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (durMatch) totalDuration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
  } catch (e: any) {
    const msg = (e.stdout || "") + (e.stderr || "");
    const durMatch = msg.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (durMatch) totalDuration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
  }

  // Build speech segments (inverse of silence)
  interface SpeechSeg { start: number; end: number; }
  const speechSegments: SpeechSeg[] = [];
  let cursor = 0;
  for (let i = 0; i < silenceStarts.length; i++) {
    if (silenceStarts[i] > cursor + 0.1) {
      speechSegments.push({ start: cursor, end: silenceStarts[i] });
    }
    if (i < silenceEnds.length) cursor = silenceEnds[i];
  }
  if (cursor < totalDuration - 0.1) {
    speechSegments.push({ start: cursor, end: totalDuration });
  }

  const speechDuration = speechSegments.reduce((s, seg) => s + seg.end - seg.start, 0);
  console.log(`  ${speechSegments.length} speech segments (${Math.round(speechDuration)}s speech in ${Math.round(totalDuration)}s total)`);

  // Build time mapping: stripped position → original position
  const timeMap: TimeMapEntry[] = [];
  let strippedCursor = 0;
  for (const seg of speechSegments) {
    const dur = seg.end - seg.start;
    timeMap.push({ strippedStart: strippedCursor, originalStart: seg.start, duration: dur });
    strippedCursor += dur;
  }

  // Step 3: Create silence-stripped audio
  const strippedPath = join(TEMP_DIR, `audio-stripped-${videoBaseName}.wav`);
  if (speechSegments.length > 0 && speechSegments.length < 500) {
    const filterParts = speechSegments.map((seg, i) =>
      `[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[s${i}]`
    );
    const concatInputs = speechSegments.map((_, i) => `[s${i}]`).join("");
    const filterStr = filterParts.join(";") + `;${concatInputs}concat=n=${speechSegments.length}:v=0:a=1[out]`;

    try {
      execSync(
        `"${ffmpegPath}" -y -i "${escapedInput}" -filter_complex "${filterStr}" -map "[out]" "${strippedPath.replace(/\\/g, "/")}"`,
        { stdio: "pipe", timeout: 120000, shell: true as any }
      );
      console.log(`  Created silence-stripped audio (~${Math.round(speechDuration)}s)`);
    } catch {
      console.log("  Failed to strip silence, using full audio");
    }
  }

  // Step 4: Upload to Gemini and transcribe
  const audioToSend = existsSync(strippedPath) ? strippedPath : wavPath;
  const audioBuffer = readFileSync(audioToSend);
  const sendDuration = existsSync(strippedPath) ? Math.round(speechDuration) : Math.round(totalDuration);

  console.log(`  Uploading ${existsSync(strippedPath) ? "stripped" : "full"} audio to Gemini (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB)...`);

  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Header-Content-Length": audioBuffer.length.toString(),
      "X-Goog-Upload-Header-Content-Type": "audio/wav",
      "Content-Type": "audio/wav",
    },
    body: audioBuffer,
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    console.log(`  Gemini upload error (${uploadResp.status}): ${errText.substring(0, 200)}`);
    return { segments: [], words: [] };
  }

  const uploadResult = await uploadResp.json() as any;
  const fileUri = uploadResult.file?.uri;
  if (!fileUri) {
    console.log("  Gemini upload returned no file URI.");
    return { segments: [], words: [] };
  }

  // Wait for processing
  const fileName = uploadResult.file?.name;
  if (fileName) {
    let fileState = uploadResult.file?.state || "PROCESSING";
    while (fileState === "PROCESSING") {
      await new Promise(r => setTimeout(r, 2000));
      const statusResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`);
      const statusData = await statusResp.json() as any;
      fileState = statusData.state || "ACTIVE";
    }
  }

  console.log("  Transcribing with Gemini 2.5 Flash...");

  const requestBody = {
    contents: [{
      parts: [
        { file_data: { mime_type: "audio/wav", file_uri: fileUri } },
        { text: `You are a professional transcriptionist. This audio is ${sendDuration} seconds long. It has had silence removed, so speech is continuous.

Transcribe ALL spoken words with PRECISE timestamps in seconds (decimal, e.g. 12.5).

Return ONLY valid JSON (no markdown fences). Format:
{"segments":[{"start":0.0,"end":3.5,"text":"First sentence."},{"start":3.8,"end":7.2,"text":"Second sentence."}],"words":[{"text":"First","start":0.0,"end":0.3},{"text":"sentence","start":0.4,"end":0.9}]}

Rules:
- Timestamps in seconds with one decimal place
- This audio is ${sendDuration}s long — timestamps must be within 0 to ${sendDuration}
- Each segment = one sentence or natural phrase
- words = every individual word with start/end
- Do NOT add *music*, [sounds], or any non-speech text
- Only transcribe actual spoken words` },
      ],
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 65536 },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.log(`  Gemini API error (${response.status}): ${errText.substring(0, 200)}`);
    return { segments: [], words: [] };
  }

  const result = await response.json() as any;
  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!responseText) {
    console.log("  Gemini returned empty response.");
    return { segments: [], words: [] };
  }

  let parsed: any;
  try {
    let jsonStr = responseText.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    console.log("  Failed to parse Gemini JSON: " + responseText.substring(0, 300));
    return { segments: [], words: [] };
  }

  // Step 5: Remap timestamps from stripped time back to original video time
  const useTimeMap = existsSync(strippedPath) && timeMap.length > 0;

  function remapTime(strippedSec: number): number {
    if (!useTimeMap) return strippedSec;
    for (const tm of timeMap) {
      if (strippedSec >= tm.strippedStart && strippedSec <= tm.strippedStart + tm.duration + 0.1) {
        return tm.originalStart + (strippedSec - tm.strippedStart);
      }
    }
    // Fallback: find closest entry
    let best = timeMap[0];
    let bestDist = Infinity;
    for (const tm of timeMap) {
      const dist = Math.abs(strippedSec - (tm.strippedStart + tm.duration / 2));
      if (dist < bestDist) { bestDist = dist; best = tm; }
    }
    return best.originalStart + Math.min(strippedSec - best.strippedStart, best.duration);
  }

  // Convert and remap segments
  const segments: TranscriptSegment[] = [];
  for (const seg of parsed.segments || []) {
    const text = (seg.text || "").trim();
    if (!text || text.length <= 1) continue;
    const origStart = remapTime(seg.start || 0);
    const origEnd = remapTime(seg.end || 0);
    segments.push({
      start: Math.round(origStart * 1000),
      end: Math.round(origEnd * 1000),
      text,
    });
  }

  // Convert and remap words
  const words: WordTimestamp[] = [];
  for (const w of parsed.words || []) {
    const text = (w.text || "").trim();
    if (!text) continue;
    words.push({
      text,
      start: remapTime(w.start || 0),
      end: remapTime(w.end || 0),
      confidence: 1, // Gemini doesn't provide per-word confidence
    });
  }

  console.log(`  Gemini transcribed: ${segments.length} segments, ${words.length} words`);
  if (segments.length > 0) {
    const first = segments[0];
    const last = segments[segments.length - 1];
    console.log(`  Time range: ${formatMs(first.start)} - ${formatMs(last.end)} (original video time)`);
  }

  // Save to cache
  const segmentLines = segments.map(s => JSON.stringify(s)).join("\n");
  writeFileSync(segmentsPath, segmentLines, "utf-8");
  writeFileSync(wordsPath, JSON.stringify({ words, fullText: words.map(w => w.text).join(" ") }, null, 2), "utf-8");
  writeFileSync(modelMarkerPath, MODEL_NAME, "utf-8");

  const debugPath = join(TEMP_DIR, "transcript-debug.txt");
  const debugLines = segments.map(s => `[${formatMs(s.start)} - ${formatMs(s.end)}] ${s.text}`);
  writeFileSync(debugPath, debugLines.join("\n"), "utf-8");

  return { segments, words };
}

function loadSegmentsFromCache(path: string): TranscriptSegment[] {
  const raw = readFileSync(path, "utf-8").trim();
  const segs: TranscriptSegment[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || !t.startsWith("{")) continue;
    try { segs.push(JSON.parse(t)); } catch {}
  }
  return segs;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function generateSRT(segments: TranscriptSegment[], outputPath: string): void {
  const lines: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    lines.push(`${i + 1}`);
    lines.push(`${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}`);
    lines.push(seg.text.trim());
    lines.push("");
  }
  writeFileSync(outputPath, lines.join("\n"), "utf-8");
}

function formatSrtTime(ms: number): string {
  const totalSec = ms / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const msR = Math.floor(ms % 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${msR.toString().padStart(3, "0")}`;
}
