/**
 * igniting-roughcut — main pipeline orchestrator.
 *
 * Follows the exact same pipeline as video-editor/src/cli.ts:
 *   1. Detect silence (Remotion getSilentParts)
 *   2. Transcribe with Whisper (sentence-level, for repeat detection)
 *   3. Transcribe with AssemblyAI (word-level, for cut-point snapping)
 *   4. Fallback: derive silence from words if FFmpeg found none
 *   5. Detect repeats from Whisper segments
 *   6. Remove repeat ranges from audible parts
 *   7. Snap to word boundaries (AssemblyAI words)
 *   8. Preserve intentional pauses
 *   9. Calculate frame-accurate sections
 *  10. Build CapCut project
 */

import { resolve, basename, extname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { detectSilence, deriveSilenceFromWords } from "./detect-silence.js";
import {
  calculateSections,
  getTotalFrames,
  snapToWordBoundaries,
  preserveIntentionalPauses,
} from "./calculate-sections.js";
import { buildRoughcutProject, sectionsToClips } from "./capcut-builder.js";
import { transcribeWithGemini } from "./transcribe-gemini.js";
import { transcribeWords } from "./transcribe-words.js";
import { detectRepeats } from "./detect-repeats.js";
import { detectWordRepeats, detectWhisperGapRepeats, detectStretchedWordRepeats } from "./detect-repeats-words.js";
import { findFfmpeg } from "./ffmpeg.js";
import { normalizeVideo } from "./normalize-video.js";
import type { EditConfig } from "./types.js";

// ─── Config (matches video-editor/config.json defaults) ─────────────

const CONFIG: EditConfig = {
  silence: {
    noiseThresholdInDecibels: -30,
    minSilenceDurationSeconds: 0.8,
    paddingSeconds: 0.35,
    minAudibleDurationSeconds: 0.15,
    wordSnapPaddingSeconds: 0.4,
    keepPauseAfterSentenceSeconds: 0.4,
  },
  output: {
    codec: "h264",
    crf: 18,
    fps: 30,
    width: 1080,
    height: 1920,
    layout: "full-frame",
    cutoutDefault: true,
  },
  screenShare: {
    enabled: false,
    layout: "screen-main",
    cameraSize: 0.25,
    cameraPosition: "bottom-right",
    cameraPadding: 20,
    syncOffsetSeconds: 0,
  },
  captions: {
    minConfidence: 0.4,
  },
} as EditConfig;

const FPS = 30;

function defaultCapcutDraftsDir(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return `${home}/Movies/CapCut/User Data/Projects/com.lveditor.draft`;
  }
  // Windows (and any other) — CapCut on Windows uses LOCALAPPDATA
  const localAppData = process.env.LOCALAPPDATA || `${home}/AppData/Local`;
  return `${localAppData.replace(/\\/g, "/")}/CapCut/User Data/Projects/com.lveditor.draft`;
}

const DEFAULT_CAPCUT_DRAFTS = defaultCapcutDraftsDir();

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "analyze") {
    return runAnalyze(args.slice(1));
  } else if (command === "build") {
    return runBuild(args.slice(1));
  } else {
    console.error("Usage:");
    console.error("  tsx src/roughcut.ts analyze <video-path>");
    console.error("  tsx src/roughcut.ts build <video-path> <hook-text> [capcut-drafts-dir]");
    process.exit(1);
  }
}

/**
 * Group word-level timestamps into sentence-like segments by silence gaps.
 * This produces segments shaped like what the repeat detector expects:
 * split by natural pauses, not by fixed time windows.
 */
function wordsToSegments(
  words: Array<{ text: string; start: number; end: number }>,
  gapThreshold: number = 0.5
): Array<{ start: number; end: number; text: string }> {
  if (words.length === 0) return [];

  const segments: Array<{ start: number; end: number; text: string }> = [];
  let segStart = words[0].start;
  let segEnd = words[0].end;
  let segWords: string[] = [words[0].text];

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - segEnd;
    if (gap >= gapThreshold) {
      // Gap found — close current segment
      segments.push({
        start: Math.round(segStart * 1000),
        end: Math.round(segEnd * 1000),
        text: segWords.join(" "),
      });
      segStart = words[i].start;
      segEnd = words[i].end;
      segWords = [words[i].text];
    } else {
      segEnd = words[i].end;
      segWords.push(words[i].text);
    }
  }

  // Close last segment
  segments.push({
    start: Math.round(segStart * 1000),
    end: Math.round(segEnd * 1000),
    text: segWords.join(" "),
  });

  return segments;
}

/**
 * Run all 4 layers of repeat detection — copied from cli.ts steps 2c/2d/2e.
 * 1. Sentence-level repeats (detectRepeats)
 * 2. Word-level stutters (detectWordRepeats)
 * 3. Repeats in word gaps (detectWhisperGapRepeats)
 * 4. False starts in stretched words (detectStretchedWordRepeats)
 */
/**
 * Snap AI cut boundaries to word edges so removeTimeRanges never splits
 * a section mid-word. If a cut start falls inside a word, move it to
 * that word's start (include the partial word in the cut). If a cut end
 * falls inside a word, move it to that word's end.
 */
function snapCutsToWords(
  cuts: Array<{ startSec: number; endSec: number }>,
  words: Array<{ start: number; end: number }>
): Array<{ startSec: number; endSec: number }> {
  return cuts.map(cut => {
    let snappedStart = cut.startSec;
    let snappedEnd = cut.endSec;

    for (const w of words) {
      // If cut start lands inside a word, snap to that word's start
      if (cut.startSec > w.start + 0.02 && cut.startSec < w.end - 0.02) {
        snappedStart = w.start;
      }
      // If cut end lands inside a word, snap to that word's end
      if (cut.endSec > w.start + 0.02 && cut.endSec < w.end - 0.02) {
        snappedEnd = w.end;
      }
    }

    return { startSec: snappedStart, endSec: snappedEnd };
  });
}

function runAllRepeatDetection(
  segments: Array<{ start: number; end: number; text: string }>,
  wordTimestamps: Array<{ text: string; start: number; end: number; confidence: number }>
): Array<{ startSec: number; endSec: number }> {
  const repeatRemovals: Array<{ startSec: number; endSec: number }> = [];

  // Layer 0: Load AI cuts from file if available (generated by Claude)
  const aiCutsPath = join(resolve(import.meta.dirname, ".."), "temp", "ai-cuts.json");
  let hasAiCuts = false;
  if (existsSync(aiCutsPath)) {
    try {
      const rawCuts = JSON.parse(readFileSync(aiCutsPath, "utf-8"));
      if (Array.isArray(rawCuts) && rawCuts.length > 0) {
        hasAiCuts = true;
        // Snap cut boundaries to word edges so cuts never split mid-word
        const aiCuts = wordTimestamps.length > 0
          ? snapCutsToWords(rawCuts, wordTimestamps)
          : rawCuts;
        for (let i = 0; i < aiCuts.length; i++) {
          const c = aiCuts[i];
          const raw = rawCuts[i];
          repeatRemovals.push({ startSec: c.startSec, endSec: c.endSec });
          const preview = raw.reason?.substring(0, 60) ?? "";
          const snapped = (c.startSec !== raw.startSec || c.endSec !== raw.endSec)
            ? ` (snapped from ${raw.startSec.toFixed(2)}-${raw.endSec.toFixed(2)})`
            : "";
          console.log(`    [ai-cut] ${c.startSec.toFixed(2)}s-${c.endSec.toFixed(2)}s${snapped}: ${preview}`);
        }
        console.log(`  Loaded ${aiCuts.length} AI cut decision(s) — using AI cuts as sole repeat source`);
      }
    } catch {
      console.log("  Failed to load ai-cuts.json");
    }
  }

  // When AI cuts exist, Claude has reviewed the transcript and made the
  // complete list of cuts. Skip all rule-based detectors — they add
  // false positives that the AI review already accounted for.
  // When NO AI cuts exist, run all detectors as fallback.
  if (!hasAiCuts) {
    // Layer 1: Sentence-level repeats
    const ngramRemovals = detectRepeats(segments);
    for (const nr of ngramRemovals) {
      const alreadyCovered = repeatRemovals.some(
        (r) => nr.startSec >= r.startSec - 0.5 && nr.endSec <= r.endSec + 0.5
      );
      if (!alreadyCovered) repeatRemovals.push(nr);
    }

  // Layers 2-4: Word-level detectors — exactly as cli.ts steps 2c/2d/2e
  if (wordTimestamps.length > 0) {
    const wordRemovals = detectWordRepeats(wordTimestamps);
    for (const wr of wordRemovals) {
      const alreadyCovered = repeatRemovals.some(
        (r) => wr.startSec >= r.startSec - 0.3 && wr.endSec <= r.endSec + 0.3
      );
      if (!alreadyCovered) {
        repeatRemovals.push({ startSec: wr.startSec, endSec: wr.endSec });
      }
    }

    const gapRemovals = detectWhisperGapRepeats(wordTimestamps, segments);
    for (const gr of gapRemovals) {
      const alreadyCovered = repeatRemovals.some(
        (r) => gr.startSec >= r.startSec - 0.3 && gr.endSec <= r.endSec + 0.3
      );
      if (!alreadyCovered) {
        repeatRemovals.push({ startSec: gr.startSec, endSec: gr.endSec });
      }
    }

    const stretchedRemovals = detectStretchedWordRepeats(wordTimestamps, segments);
    for (const sr of stretchedRemovals) {
      const alreadyCovered = repeatRemovals.some(
        (r) => sr.startSec >= r.startSec - 0.3 && sr.endSec <= r.endSec + 0.3
      );
      if (!alreadyCovered) {
        repeatRemovals.push({ startSec: sr.startSec, endSec: sr.endSec });
      }
    }
  }
  } // end if (!hasAiCuts)

  // Clamp: don't let removals bleed into kept transcript segments
  // Skip clamping when AI cuts are the source — they're precise and intentional
  if (!hasAiCuts) {
    const keptSegmentStarts = segments
      .filter(t => !repeatRemovals.some(r => t.start / 1000 >= r.startSec - 0.1 && t.end / 1000 <= r.endSec + 0.1))
      .map(t => t.start / 1000);
    for (const removal of repeatRemovals) {
      for (const keptStart of keptSegmentStarts) {
        if (removal.startSec < keptStart && removal.endSec > keptStart) {
          removal.endSec = keptStart - 0.05;
        }
      }
    }
  }

  return repeatRemovals;
}

/**
 * removeTimeRanges — copied from video-editor/src/cli.ts
 */
function removeTimeRanges(
  audibleParts: Array<{ startInSeconds: number; endInSeconds: number }>,
  removals: Array<{ startSec: number; endSec: number }>
): Array<{ startInSeconds: number; endInSeconds: number }> {
  let result = [...audibleParts];

  for (const removal of removals) {
    const newResult: typeof result = [];
    for (const part of result) {
      // No overlap: keep as is
      if (part.endInSeconds <= removal.startSec || part.startInSeconds >= removal.endSec) {
        newResult.push(part);
        continue;
      }

      // Partial overlap: keep the non-overlapping portions
      if (part.startInSeconds < removal.startSec) {
        newResult.push({
          startInSeconds: part.startInSeconds,
          endInSeconds: removal.startSec,
        });
      }
      if (part.endInSeconds > removal.endSec) {
        newResult.push({
          startInSeconds: removal.endSec,
          endInSeconds: part.endInSeconds,
        });
      }
    }
    result = newResult;
  }

  return result;
}

/**
 * Run the pipeline exactly as cli.ts does, output JSON stats.
 */
async function runAnalyze(args: string[]) {
  if (args.length < 1) {
    console.error("Usage: tsx src/roughcut.ts analyze <video-path>");
    process.exit(1);
  }

  const sourcePath = resolve(args[0]);
  if (!existsSync(sourcePath)) {
    console.error(`Video not found: ${sourcePath}`);
    process.exit(1);
  }

  const ffmpegPath = findFfmpeg(true);

  // Step 0: Normalize source video — single canonical timeline for ffmpeg,
  // AssemblyAI, and CapCut. Eliminates timing drift from VFR/H.265/rotation.
  const videoPath = normalizeVideo(sourcePath, ffmpegPath);

  // Step 1: Detect silence (Remotion)
  let silenceResult = await detectSilence(videoPath, CONFIG);

  // Step 2: Transcribe with Whisper (sentence-level → repeat detection)
  const geminiResult = await transcribeWithGemini(videoPath, ffmpegPath);
  const geminiSegments = geminiResult.segments;

  // Step 3: Transcribe with AssemblyAI (word-level → cut-point snapping)
  const assemblyResult = await transcribeWords(videoPath, ffmpegPath);

  // Step 4: Use word-based silence when we have words — always more accurate
  // than FFmpeg's audio-level detection (catches camera noise, room tone, etc.)
  if (assemblyResult.words.length > 0) {
    const wordBased = deriveSilenceFromWords(
      assemblyResult.words,
      silenceResult.durationInSeconds,
      CONFIG.silence.minSilenceDurationSeconds
    );
    // Use whichever removes more total silence
    const ffmpegSilenceDur = silenceResult.silentParts.reduce((s, p) => s + p.endInSeconds - p.startInSeconds, 0);
    const wordSilenceDur = wordBased.silentParts.reduce((s, p) => s + p.endInSeconds - p.startInSeconds, 0);
    if (wordSilenceDur > ffmpegSilenceDur) {
      silenceResult = wordBased;
    }
  }

  // Step 5: Detect repeats — prefer AssemblyAI words grouped into segments
  // (Whisper segments can be fixed 3s chunks when silence-stripped, which breaks repeat detection)
  // Use a 0.3s gap to split into shorter segments (closer to natural sentences).
  // The original video-editor uses Gemini for sentence-level segmentation;
  // we approximate by grouping words with short pauses between them.
  const repeatSegments = assemblyResult.words.length > 0
    ? wordsToSegments(assemblyResult.words, 0.3)
    : geminiSegments;
  const repeatRemovals = runAllRepeatDetection(repeatSegments, assemblyResult.words);

  // Step 6: Remove repeat ranges from audible parts
  let audibleParts = silenceResult.audibleParts;
  if (repeatRemovals.length > 0) {
    audibleParts = removeTimeRanges(audibleParts, repeatRemovals);
  }

  // Step 6b: Drop empty sections — when adjacent cuts leave a tiny gap
  // with no words inside, that gap becomes a clip of pure silence.
  if (assemblyResult.words.length > 0) {
    const isInRemoval = (t: number) =>
      repeatRemovals.some(r => t >= r.startSec - 0.05 && t <= r.endSec + 0.05);
    audibleParts = audibleParts.filter(p =>
      assemblyResult.words.some(w =>
        w.start >= p.startInSeconds - 0.05 &&
        w.end <= p.endInSeconds + 0.05 &&
        !isInRemoval(w.start)
      )
    );
  }

  // Step 7: Snap to word boundaries, respecting cut boundaries
  if (assemblyResult.words.length > 0) {
    audibleParts = snapToWordBoundaries(
      audibleParts,
      assemblyResult.words,
      CONFIG.silence.wordSnapPaddingSeconds,
      repeatRemovals
    );

    audibleParts = preserveIntentionalPauses(
      audibleParts,
      assemblyResult.words,
      silenceResult.silentParts,
      CONFIG.silence.keepPauseAfterSentenceSeconds,
      repeatRemovals
    );
  }

  // Step 9: Calculate sections
  const sections = calculateSections(audibleParts, FPS, silenceResult.durationInSeconds, CONFIG, repeatRemovals);
  const totalKeptFrames = getTotalFrames(sections);
  const keptDuration = totalKeptFrames / FPS;
  const removedDuration = Math.max(0, silenceResult.durationInSeconds - keptDuration);

  const fullText = assemblyResult.fullText || geminiSegments.map(s => s.text).join(" ");

  // Output JSON for Claude
  console.log(JSON.stringify({
    original: Math.round(silenceResult.durationInSeconds * 10) / 10,
    kept: Math.round(keptDuration * 10) / 10,
    removed: Math.round(removedDuration * 10) / 10,
    sections: sections.length,
    silentParts: silenceResult.silentParts.length,
    repeatsRemoved: repeatRemovals.length,
    hasTranscript: geminiSegments.length > 0 || assemblyResult.words.length > 0,
    originalFormatted: formatTime(silenceResult.durationInSeconds),
    keptFormatted: formatTime(keptDuration),
    removedFormatted: formatTime(removedDuration),
    transcript: fullText,
  }));
}

/**
 * Run the full pipeline and build a CapCut project.
 */
async function runBuild(args: string[]) {
  if (args.length < 2) {
    console.error("Usage: tsx src/roughcut.ts build <video-path> <hook-text> [capcut-drafts-dir] [project-name]");
    process.exit(1);
  }

  const sourcePath = resolve(args[0]);
  const hookText = args[1];
  const draftsDir = args[2] || DEFAULT_CAPCUT_DRAFTS;
  const customProjectName = args[3];

  if (!existsSync(sourcePath)) {
    console.error(`Video not found: ${sourcePath}`);
    process.exit(1);
  }

  if (!existsSync(draftsDir)) {
    console.error(`CapCut drafts directory not found: ${draftsDir}`);
    process.exit(1);
  }

  const ffmpegPath = findFfmpeg(true);

  // Step 0: Normalize source video — single canonical timeline for ffmpeg,
  // AssemblyAI, and CapCut. Eliminates timing drift from VFR/H.265/rotation.
  const videoPath = normalizeVideo(sourcePath, ffmpegPath);

  // Use the SOURCE basename for the project name (not the normalized temp file)
  const videoName = basename(sourcePath, extname(sourcePath));
  let projectName = customProjectName || `${videoName}-roughcut`;

  // Auto-increment if project exists
  if (existsSync(`${draftsDir}/${projectName}`)) {
    let suffix = 2;
    while (existsSync(`${draftsDir}/${projectName}-${suffix}`)) suffix++;
    projectName = `${projectName}-${suffix}`;
  }

  console.log(`\n  igniting-roughcut`);
  console.log(`  Video: ${videoPath}`);
  console.log(`  Hook: "${hookText}"`);
  console.log("");

  // Step 1: Detect silence
  console.log("  [1/4] Detecting silences...");
  let silenceResult = await detectSilence(videoPath, CONFIG);
  console.log(`  Found ${silenceResult.silentParts.length} silent segment(s)`);

  // Step 2: Transcribe (Whisper + AssemblyAI)
  console.log("  [2/4] Transcribing...");
  const geminiResult = await transcribeWithGemini(videoPath, ffmpegPath);
  const geminiSegments = geminiResult.segments;
  const assemblyResult = await transcribeWords(videoPath, ffmpegPath);
  console.log(`  ${geminiSegments.length} Gemini segments, ${assemblyResult.words.length} AssemblyAI words`);

  // Use word-based silence when we have words — always more accurate
  if (assemblyResult.words.length > 0) {
    const wordBased = deriveSilenceFromWords(
      assemblyResult.words,
      silenceResult.durationInSeconds,
      CONFIG.silence.minSilenceDurationSeconds
    );
    const ffmpegSilenceDur = silenceResult.silentParts.reduce((s, p) => s + p.endInSeconds - p.startInSeconds, 0);
    const wordSilenceDur = wordBased.silentParts.reduce((s, p) => s + p.endInSeconds - p.startInSeconds, 0);
    if (wordSilenceDur > ffmpegSilenceDur) {
      console.log("  Using word-based silence detection (more accurate)");
      silenceResult = wordBased;
    }
  }

  // Step 3: Detect repeats + apply all processing
  console.log("  [3/4] Processing cuts...");
  const repeatSegments = assemblyResult.words.length > 0
    ? wordsToSegments(assemblyResult.words, 0.3)
    : geminiSegments;
  const repeatRemovals = runAllRepeatDetection(repeatSegments, assemblyResult.words);

  let audibleParts = silenceResult.audibleParts;
  if (repeatRemovals.length > 0) {
    audibleParts = removeTimeRanges(audibleParts, repeatRemovals);
  }

  // Drop empty sections (no words inside) created when adjacent cuts
  // leave a tiny silence-only gap between them.
  if (assemblyResult.words.length > 0) {
    const isInRemoval = (t: number) =>
      repeatRemovals.some(r => t >= r.startSec - 0.05 && t <= r.endSec + 0.05);
    const before = audibleParts.length;
    audibleParts = audibleParts.filter(p =>
      assemblyResult.words.some(w =>
        w.start >= p.startInSeconds - 0.05 &&
        w.end <= p.endInSeconds + 0.05 &&
        !isInRemoval(w.start)
      )
    );
    if (audibleParts.length < before) {
      console.log(`  Dropped ${before - audibleParts.length} empty silence section(s) between adjacent cuts`);
    }
  }

  if (assemblyResult.words.length > 0) {
    audibleParts = snapToWordBoundaries(
      audibleParts,
      assemblyResult.words,
      CONFIG.silence.wordSnapPaddingSeconds,
      repeatRemovals
    );

    audibleParts = preserveIntentionalPauses(
      audibleParts,
      assemblyResult.words,
      silenceResult.silentParts,
      CONFIG.silence.keepPauseAfterSentenceSeconds,
      repeatRemovals
    );
  }

  const sections = calculateSections(audibleParts, FPS, silenceResult.durationInSeconds, CONFIG, repeatRemovals);
  const totalKeptFrames = getTotalFrames(sections);
  const keptDuration = totalKeptFrames / FPS;
  const removedDuration = Math.max(0, silenceResult.durationInSeconds - keptDuration);

  console.log(`  Keeping ${sections.length} sections (${formatTime(keptDuration)} of ${formatTime(silenceResult.durationInSeconds)}, removing ${formatTime(removedDuration)})`);
  if (repeatRemovals.length > 0) {
    console.log(`  Removed ${repeatRemovals.length} repeated takes`);
  }

  // Step 4: Build CapCut project
  console.log("  [4/4] Building CapCut project...");
  const clips = sectionsToClips(sections, FPS, videoPath);

  const result = buildRoughcutProject({
    projectName,
    draftsDir,
    clips,
    hookText,
    sourceVideoDurationSec: silenceResult.durationInSeconds,
  });

  console.log("");
  console.log(`  Done! Project "${projectName}" is ready in CapCut.`);
  console.log(`  Location: ${result.projectDir}`);
  console.log("");
}

function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

main();
