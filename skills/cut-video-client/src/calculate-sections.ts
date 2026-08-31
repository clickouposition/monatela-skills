import type { VideoSection, EditConfig } from "./types.js";

interface TimePart {
  startInSeconds: number;
  endInSeconds: number;
}

/**
 * Snap audible section boundaries to word edges so cuts never clip mid-word.
 *
 * Direction matters:
 * - Section START snaps EARLIER (to include the first word fully)
 * - Section END snaps LATER (to include the last word fully)
 *
 * This ensures words at the edges are always fully included, never clipped.
 */
export function snapToWordBoundaries(
  audibleParts: TimePart[],
  words: { start: number; end: number }[],
  maxSnapDistance: number = 0.4,
  cutBoundaries?: Array<{ startSec: number; endSec: number }>
): TimePart[] {
  if (words.length === 0) return audibleParts;

  // A word is "in a cut" if its start sits at or inside any cut range.
  // 50ms tolerance because cut boundaries from Claude are placed by reading
  // the transcript and are usually within a few ms of the word boundary —
  // a too-tight check (e.g. 1ms) misses words that are barely outside the
  // cut and lets snap extend past the cut.
  const isInCut = (wordStart: number): boolean => {
    if (!cutBoundaries) return false;
    return cutBoundaries.some(c => wordStart >= c.startSec - 0.05 && wordStart < c.endSec - 0.001);
  };

  return audibleParts.map(part => {
    let bestStart = part.startInSeconds;
    let bestStartDist = Infinity;
    for (const w of words) {
      if (isInCut(w.start)) continue;
      if (Math.abs(w.start - part.startInSeconds) > maxSnapDistance &&
          Math.abs(w.end - part.startInSeconds) > maxSnapDistance) continue;
      const snapTarget = w.start;
      const dist = Math.abs(snapTarget - part.startInSeconds);
      if (dist < bestStartDist) {
        bestStart = Math.min(snapTarget, part.startInSeconds);
        bestStartDist = dist;
      }
    }

    const endSnapDistance = maxSnapDistance * 2;
    let bestEnd = part.endInSeconds;
    let lastWordInSection: { start: number; end: number } | null = null;

    for (const w of words) {
      if (isInCut(w.start)) continue;
      if (w.start <= part.endInSeconds + 0.1 && w.start >= bestStart) {
        if (!lastWordInSection || w.start > lastWordInSection.start) {
          lastWordInSection = w;
        }
      }
    }

    if (lastWordInSection && lastWordInSection.end > part.endInSeconds - endSnapDistance) {
      bestEnd = Math.max(lastWordInSection.end + 0.05, part.endInSeconds);
    }

    return {
      startInSeconds: Math.max(0, bestStart),
      endInSeconds: bestEnd,
    };
  }).filter(p => p.endInSeconds > p.startInSeconds);
}

/**
 * Preserve intentional breathing pauses after sentence-terminating words.
 *
 * Phase 3 SLNC-03 (Claude's Discretion). After silence removal + word-snap,
 * scan the gaps between consecutive audible parts. If the LAST word of the
 * left part ends with `.`, `?`, or `!` AND the silence gap is longer than
 * `keepSeconds`, extend the left part's end by `keepSeconds` so a natural
 * breathing pause is retained instead of cutting hard into the next sentence.
 *
 * The extension is clamped so the left part can never overrun the start of
 * the next part — `silenceLen` is the actual gap length and we add at most
 * `min(keepSeconds, silenceLen)`.
 *
 * Pure: returns a new array, does not mutate input.
 */
export function preserveIntentionalPauses(
  audibleParts: TimePart[],
  words: { text: string; start: number; end: number }[],
  silentParts: TimePart[],
  keepSeconds: number,
  cutBoundaries?: Array<{ startSec: number; endSec: number }>
): TimePart[] {
  if (keepSeconds <= 0 || audibleParts.length < 2 || words.length === 0) {
    return audibleParts.map((p) => ({ ...p }));
  }
  void silentParts;

  const SENTENCE_END = /[.?!]\s*$/;
  const result: TimePart[] = audibleParts.map((p) => ({ ...p }));
  let preserved = 0;

  for (let i = 0; i < result.length - 1; i++) {
    const part = result[i]!;
    const next = result[i + 1]!;

    let lastWord: { text: string; start: number; end: number } | null = null;
    for (const w of words) {
      if (w.end <= part.endInSeconds + 0.05 && w.start >= part.startInSeconds - 0.05) {
        if (!lastWord || w.end > lastWord.end) lastWord = w;
      }
    }
    if (!lastWord) continue;
    if (!SENTENCE_END.test(lastWord.text.trim())) continue;

    // Hard ceiling: never extend past the start of any cut that follows
    // this section (otherwise the breathing pause leaks removed content
    // and the bridging step then merges across the cut boundary).
    let maxEnd = next.startInSeconds - 0.001;
    if (cutBoundaries) {
      for (const c of cutBoundaries) {
        if (c.startSec >= part.endInSeconds && c.startSec < maxEnd) {
          maxEnd = c.startSec;
        }
      }
    }

    const extension = Math.min(keepSeconds, maxEnd - part.endInSeconds);
    if (extension <= 0) continue;
    part.endInSeconds += extension;
    preserved += 1;
  }

  if (preserved > 0) {
    console.log(`  Preserved ${preserved} intentional pause(s) after sentence-ending words`);
  }
  return result;
}

/**
 * Convert audible time ranges to frame-accurate video sections.
 * Adds padding to prevent clipped words and merges overlapping sections.
 */
export function calculateSections(
  audibleParts: TimePart[],
  fps: number,
  totalDurationSeconds: number,
  config: EditConfig,
  cutBoundaries?: Array<{ startSec: number; endSec: number }>
): VideoSection[] {
  const padding = config.silence.paddingSeconds;
  const minAudible = config.silence.minAudibleDurationSeconds;

  const filtered = audibleParts.filter((part) => {
    const duration = part.endInSeconds - part.startInSeconds;
    return duration >= minAudible;
  });

  const dropped = audibleParts.length - filtered.length;
  if (dropped > 0) {
    console.log(`  Filtered ${dropped} micro-segment(s) shorter than ${minAudible}s`);
  }

  // Bridge gaps, but NEVER bridge across a cut boundary
  // (otherwise removed content gets re-included).
  const gapContainsCut = (gapStart: number, gapEnd: number): boolean => {
    if (!cutBoundaries) return false;
    return cutBoundaries.some(c =>
      c.startSec >= gapStart - 0.01 && c.startSec <= gapEnd + 0.01
    );
  };
  const bridged: TimePart[] = [];
  for (const part of filtered) {
    const last = bridged[bridged.length - 1];
    if (last) {
      const gap = part.startInSeconds - last.endInSeconds;
      // -0.01 epsilon avoids false bridge when gap == minSilence due to float precision
      if (gap < config.silence.minSilenceDurationSeconds - 0.01 && !gapContainsCut(last.endInSeconds, part.startInSeconds)) {
        last.endInSeconds = part.endInSeconds;
        continue;
      }
    }
    bridged.push({ ...part });
  }
  const bridgeCount = filtered.length - bridged.length;
  if (bridgeCount > 0) {
    console.log(`  Bridged ${bridgeCount} small gap(s) between speech segments`);
  }

  // Add padding, but never extend padding INTO a cut region
  // (otherwise the listener hears the start/end of removed words).
  const padded = bridged.map((part) => {
    let paddedStart = Math.max(0, part.startInSeconds - padding);
    let paddedEnd = Math.min(totalDurationSeconds, part.endInSeconds + padding);
    if (cutBoundaries) {
      for (const c of cutBoundaries) {
        if (c.endSec <= part.startInSeconds + 0.05 && c.endSec > paddedStart) {
          paddedStart = c.endSec;
        }
        if (c.startSec >= part.endInSeconds - 0.05 && c.startSec < paddedEnd) {
          paddedEnd = c.startSec;
        }
      }
    }
    return { startInSeconds: paddedStart, endInSeconds: paddedEnd };
  });

  // Merge overlapping sections (padding can cause adjacent parts to overlap)
  const merged: TimePart[] = [];
  for (const part of padded) {
    const last = merged[merged.length - 1];
    if (last && part.startInSeconds <= last.endInSeconds) {
      // Overlap: extend the previous section
      last.endInSeconds = Math.max(last.endInSeconds, part.endInSeconds);
    } else {
      merged.push({ ...part });
    }
  }

  // Convert seconds to frame numbers
  const frameSections = merged.map((part) => {
    const startFrame = Math.floor(part.startInSeconds * fps);
    const endFrame = Math.ceil(part.endInSeconds * fps);
    return {
      startFrame,
      endFrame,
      durationInFrames: endFrame - startFrame,
    };
  });

  // Final safety: ensure no overlapping frame ranges after rounding.
  // If section N ends after section N+1 starts, clamp it.
  for (let i = 1; i < frameSections.length; i++) {
    const prev = frameSections[i - 1];
    const curr = frameSections[i];
    if (prev.endFrame > curr.startFrame) {
      prev.endFrame = curr.startFrame;
      prev.durationInFrames = prev.endFrame - prev.startFrame;
    }
  }

  // Remove any zero-duration sections created by clamping
  return frameSections.filter((s) => s.durationInFrames > 0);
}

/**
 * Calculate total duration in frames across all sections.
 */
export function getTotalFrames(sections: VideoSection[]): number {
  return sections.reduce((sum, s) => sum + s.durationInFrames, 0);
}
