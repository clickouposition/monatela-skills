import { getSilentParts } from "@remotion/renderer";
import { resolve } from "node:path";
import type { SilenceResult, EditConfig } from "./types.js";

/**
 * Detect silent and audible parts in a video file.
 * Uses Remotion's built-in FFmpeg for audio analysis.
 */
export async function detectSilence(
  inputPath: string,
  config: EditConfig
): Promise<SilenceResult> {
  const absolutePath = resolve(inputPath);

  const result = await getSilentParts({
    src: absolutePath,
    noiseThresholdInDecibels: config.silence.noiseThresholdInDecibels,
    minDurationInSeconds: config.silence.minSilenceDurationSeconds,
    logLevel: "warn",
  });

  return {
    audibleParts: result.audibleParts,
    silentParts: result.silentParts,
    durationInSeconds: result.durationInSeconds,
  };
}

/**
 * Derive silence from word-level timestamps.
 * When FFmpeg silence detection finds nothing (noisy audio, room tone),
 * fall back to word gaps: any gap > minGapSeconds between words = silence.
 * This is more reliable because it uses actual speech boundaries, not audio thresholds.
 */
export function deriveSilenceFromWords(
  words: Array<{ start: number; end: number }>,
  totalDuration: number,
  minGapSeconds: number = 0.5
): SilenceResult {
  if (words.length === 0) {
    return {
      audibleParts: [{ startInSeconds: 0, endInSeconds: totalDuration }],
      silentParts: [],
      durationInSeconds: totalDuration,
    };
  }

  const silentParts: Array<{ startInSeconds: number; endInSeconds: number }> = [];
  const audibleParts: Array<{ startInSeconds: number; endInSeconds: number }> = [];

  // Gap before first word
  if (words[0].start > minGapSeconds) {
    silentParts.push({ startInSeconds: 0, endInSeconds: words[0].start });
  }

  // Build audible parts by merging consecutive words with small gaps
  let currentStart = words[0].start;
  let currentEnd = words[0].end;

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - currentEnd;
    if (gap >= minGapSeconds) {
      // Found a silence gap — close the current audible part
      audibleParts.push({ startInSeconds: currentStart, endInSeconds: currentEnd });
      silentParts.push({ startInSeconds: currentEnd, endInSeconds: words[i].start });
      currentStart = words[i].start;
    }
    currentEnd = Math.max(currentEnd, words[i].end);
  }

  // Close the last audible part
  audibleParts.push({ startInSeconds: currentStart, endInSeconds: currentEnd });

  // Gap after last word
  if (currentEnd < totalDuration - minGapSeconds) {
    silentParts.push({ startInSeconds: currentEnd, endInSeconds: totalDuration });
  }

  console.log(`  Word-based silence: ${audibleParts.length} audible, ${silentParts.length} silent (from ${words.length} words, gap threshold: ${minGapSeconds}s)`);

  return { audibleParts, silentParts, durationInSeconds: totalDuration };
}
