import type { WordTimestamp } from "./transcribe-words.js";
import type { TranscriptSegment } from "./types.js";

/**
 * Word-level repeat and stutter detection.
 * Uses precise word timestamps from Whisper to cut stutters
 * without clipping adjacent real speech.
 *
 * Detection types:
 * 1. Phrase repeats: "Three things Cloud Code. Three things Cloud Code can..."
 *    -> Cut the first occurrence of the repeated phrase
 * 2. Word stutters: "the the the" -> cut all but the last
 * 3. False starts: "So" (pause) "So if you..." -> cut the abandoned word
 */

interface WordRemoval {
  startSec: number;
  endSec: number;
  type: string;
  text: string;
}

const BUFFER_SEC = 0.03; // 30ms buffer on each side of a cut

export function detectWordRepeats(
  words: WordTimestamp[]
): Array<{ startSec: number; endSec: number; reason: string }> {
  if (words.length === 0) return [];

  // Filter out words with suspicious timestamps (word spanning > 3 seconds is likely a Whisper error)
  const cleanWords = words.map((w, i) => ({
    ...w,
    // If a single word spans > 3s, clamp its start to 0.5s before end
    start: (w.end - w.start > 3) ? Math.max(0, w.end - 0.5) : w.start,
    originalIndex: i,
  }));

  const removals: WordRemoval[] = [];
  const used = new Set<number>(); // word indices already marked for removal

  detectPhraseRepeats(cleanWords, removals, used);
  detectTwoWordRepeats(cleanWords, removals, used);
  detectWordStutters(cleanWords, removals, used);
  detectFalseStarts(cleanWords, removals, used);

  // Log results
  if (removals.length > 0) {
    for (const r of removals) {
      const preview = r.text.substring(0, 60);
      console.log(`    [word-${r.type}] ${r.startSec.toFixed(2)}s-${r.endSec.toFixed(2)}s "${preview}${r.text.length > 60 ? "..." : ""}"`);
    }
    console.log(`  Word-level: found ${removals.length} stutter(s) to remove`);
  } else {
    console.log("  Word-level: no stutters detected");
  }

  // Apply small buffer and return
  return removals.map((r) => ({
    startSec: Math.max(0, r.startSec - BUFFER_SEC),
    endSec: r.endSec + BUFFER_SEC,
    reason: `word-${r.type}`,
  }));
}

// ── Type 1: Phrase Repeats ──────────────────────────────────────────────
// Finds sequences of N words (N >= 3) that appear twice nearby.
// "Three things Cloud Code. Three things Cloud Code can..."
// Cuts the first occurrence (earlier attempt).
//
// Guard against false positives from parallel constructions:
// "about your clients, about your folders" is intentional, not a stutter.
// We require the FULL phrase to match (not just the first 2 words),
// and we check what follows the second phrase is a continuation (not different content).
function detectPhraseRepeats(
  words: WordTimestamp[],
  removals: WordRemoval[],
  used: Set<number>
): void {
  const norm = words.map((w) => normalizeWord(w.text));

  // Try phrase lengths from 5 down to 3 (2-word matches are too noisy)
  for (let phraseLen = 5; phraseLen >= 3; phraseLen--) {
    for (let i = 0; i <= norm.length - phraseLen * 2; i++) {
      if (hasUsed(used, i, i + phraseLen)) continue;

      const phrase = norm.slice(i, i + phraseLen).join(" ");

      // Look for the same phrase starting within a reasonable window
      const searchEnd = Math.min(i + phraseLen + phraseLen + 5, norm.length - phraseLen + 1);
      for (let j = i + phraseLen; j < searchEnd; j++) {
        if (hasUsed(used, j, j + phraseLen)) continue;

        const candidate = norm.slice(j, j + phraseLen).join(" ");
        if (phrase !== candidate) continue;

        // Time check: the two phrases should be within 5 seconds of each other
        const timeBetween = words[j].start - words[i + phraseLen - 1].end;
        if (timeBetween > 5) continue;

        // Guard 1: too many words between the two phrases = different sentences.
        // Retakes have 0-2 filler words between them. If there are more words
        // than the phrase itself, it's two separate sentences that happen to
        // start the same way ("I have been so obsessed... I have been creating...").
        const gapWords = j - (i + phraseLen);
        if (gapWords > phraseLen) continue;

        // Guard 2: same continuation = parallel construction, not a stutter
        const wordAfterFirst = i + phraseLen < norm.length ? norm[i + phraseLen] : "";
        const wordAfterSecond = j + phraseLen < norm.length ? norm[j + phraseLen] : "";
        if (wordAfterFirst !== "" && wordAfterSecond !== "" && wordAfterFirst === wordAfterSecond) {
          continue;
        }

        // Guard 3: sentence boundary between the two phrases = different sentences, not a stutter.
        // "What is even an AI-first business?" + "An AI-first business basically means..."
        // The last word of the first phrase or any word between them ends with sentence punctuation.
        const lastWordOfFirst = words[i + phraseLen - 1].text.trim();
        const endsWithSentencePunct = /[.?!]["']?$/.test(lastWordOfFirst);
        if (endsWithSentencePunct) continue;
        // Also check gap words for sentence boundaries
        let hasSentenceBoundaryInGap = false;
        for (let g = i + phraseLen; g < j; g++) {
          if (/[.?!]["']?$/.test(words[g].text.trim())) {
            hasSentenceBoundaryInGap = true;
            break;
          }
        }
        if (hasSentenceBoundaryInGap) continue;

        // Cut the first occurrence + any gap words between them
        let actualCutEnd = words[i + phraseLen - 1].end;
        if (j > i + phraseLen) {
          actualCutEnd = words[j - 1].end;
          for (let k = i + phraseLen; k < j; k++) {
            markUsed(used, k);
          }
        }

        for (let k = i; k < i + phraseLen; k++) {
          markUsed(used, k);
        }

        const cutText = words.slice(i, j).map((w) => w.text.trim()).join(" ");
        removals.push({
          startSec: words[i].start,
          endSec: actualCutEnd,
          type: "phrase-repeat",
          text: cutText,
        });
        break; // Move to next starting position
      }
    }
  }
}

// ── Type 1b: Two-Word Phrase Repeats ────────────────────────────────────
// Catches "Number 2. Number 2..." or "I mean. I mean, the thing is..."
// Tighter guards than 3+ word matches to avoid false positives:
// - Max 2 words gap between the two phrases
// - Max 3 seconds between them (retake, not two separate thoughts)
function detectTwoWordRepeats(
  words: WordTimestamp[],
  removals: WordRemoval[],
  used: Set<number>
): void {
  const norm = words.map((w) => normalizeWord(w.text));

  for (let i = 0; i <= norm.length - 4; i++) {
    if (used.has(i) || used.has(i + 1)) continue;
    if (norm[i].length === 0 || norm[i + 1].length === 0) continue;

    const phrase = norm[i] + " " + norm[i + 1];

    // Search for the same 2-word phrase starting within a tight window
    const searchEnd = Math.min(i + 6, norm.length - 1);
    for (let j = i + 2; j < searchEnd; j++) {
      if (used.has(j) || used.has(j + 1)) continue;

      const candidate = norm[j] + " " + norm[j + 1];
      if (phrase !== candidate) continue;

      // Time check: must be within 3 seconds (tight for 2-word to avoid false positives)
      const timeBetween = words[j].start - words[i + 1].end;
      if (timeBetween > 3) continue;

      // Gap words between the two phrases: max 2 (filler words like "uh", "um")
      const gapWords = j - (i + 2);
      if (gapWords > 2) continue;

      // Cut the first occurrence + gap words
      let cutEnd = words[i + 1].end;
      if (j > i + 2) {
        cutEnd = words[j - 1].end;
        for (let k = i + 2; k < j; k++) {
          markUsed(used, k);
        }
      }

      markUsed(used, i);
      markUsed(used, i + 1);

      const cutText = words.slice(i, j).map((w) => w.text.trim()).join(" ");
      removals.push({
        startSec: words[i].start,
        endSec: cutEnd,
        type: "two-word-repeat",
        text: cutText,
      });
      break;
    }
  }
}

// ── Type 2: Word Stutters ───────────────────────────────────────────────
// Same word repeated 2+ times consecutively: "the the" or "I I I want"
// Cuts all but the last occurrence.
function detectWordStutters(
  words: WordTimestamp[],
  removals: WordRemoval[],
  used: Set<number>
): void {
  const norm = words.map((w) => normalizeWord(w.text));

  for (let i = 0; i < norm.length - 1; i++) {
    if (used.has(i)) continue;
    if (norm[i].length === 0) continue; // skip empty words

    // Count consecutive repeats
    let repeatEnd = i + 1;
    while (repeatEnd < norm.length && norm[repeatEnd] === norm[i]) {
      repeatEnd++;
    }

    if (repeatEnd - i < 2) continue; // no repeat

    // Time check: all repeats should be within 3 seconds
    const timeSpan = words[repeatEnd - 1].end - words[i].start;
    if (timeSpan > 3) continue;

    // Cut all but the last (keep the final word)
    const cutStart = words[i].start;
    const cutEnd = words[repeatEnd - 2].end;

    for (let k = i; k < repeatEnd - 1; k++) {
      markUsed(used, k);
    }

    removals.push({
      startSec: cutStart,
      endSec: cutEnd,
      type: "stutter",
      text: `"${words[i].text.trim()}" repeated ${repeatEnd - i}x`,
    });
  }
}

// ── Type 3: False Starts ────────────────────────────────────────────────
// Single word followed by a pause (>0.3s) then the same word again.
// "So" (pause) "So if you..." -> cut the first "So"
function detectFalseStarts(
  words: WordTimestamp[],
  removals: WordRemoval[],
  used: Set<number>
): void {
  const norm = words.map((w) => normalizeWord(w.text));

  for (let i = 0; i < norm.length - 2; i++) {
    if (used.has(i)) continue;

    // Look for a gap after this word (pause > 0.3s)
    const gapAfter = words[i + 1].start - words[i].end;
    if (gapAfter < 0.3) continue;

    // Check if the next word after the gap is the same as this word
    if (norm[i] === norm[i + 1] && !used.has(i + 1)) {
      markUsed(used, i);
      removals.push({
        startSec: words[i].start,
        endSec: words[i].end,
        type: "false-start",
        text: `"${words[i].text.trim()}" before restart`,
      });
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^\w']/g, "").trim();
}

function hasUsed(used: Set<number>, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (used.has(i)) return true;
  }
  return false;
}

function markUsed(used: Set<number>, index: number): void {
  used.add(index);
}

// ── Whisper Gap Detection ───────────────────────────────────────────────
// Whisper sometimes merges duplicate phrases into one, leaving a gap in
// word-level timestamps where speech actually exists. This function
// cross-references sentence-level timestamps (which capture the audio
// more broadly) with word-level gaps to find these hidden repeats.
//
// Example: speaker says "Number two. Number two is skills..."
// Whisper word-level: "to." at 61.86s, then "Number" at 63.12s (1.26s gap)
// Whisper sentence-level: sentence starts at 62.7s covering the gap
// The gap contains the first "Number two" that Whisper dropped.

export function detectWhisperGapRepeats(
  words: WordTimestamp[],
  sentences: TranscriptSegment[]
): Array<{ startSec: number; endSec: number; reason: string }> {
  const removals: Array<{ startSec: number; endSec: number; reason: string }> = [];
  if (words.length < 2 || sentences.length === 0) return removals;

  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i].end;
    const gapEnd = words[i + 1].start;
    const gapDuration = gapEnd - gapStart;

    // Only care about gaps > 0.5s and < 4s (short enough to be a retake, not a real pause)
    if (gapDuration < 0.5 || gapDuration > 4) continue;

    // Check if any sentence-level segment covers this gap (meaning Whisper heard speech there)
    const sentenceCoversGap = sentences.some((s) => {
      const sSec = s.start / 1000; // sentence timestamps are in milliseconds
      const eSec = s.end / 1000;
      // Sentence must start during or before the gap and extend into/past it
      return sSec < gapEnd && eSec > gapStart && sSec >= gapStart - 1;
    });

    if (!sentenceCoversGap) continue;

    // Now check: do the words right after the gap repeat words from before the gap?
    // Grab up to 4 words after the gap and up to 4 words before the gap
    const wordsAfter = [];
    for (let j = i + 1; j < Math.min(i + 5, words.length); j++) {
      wordsAfter.push(normalizeWord(words[j].text));
    }

    const wordsBefore = [];
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      wordsBefore.push(normalizeWord(words[j].text));
    }

    // Check if the first 2+ words after the gap match any 2+ word sequence before the gap
    // OR if they match each other (the gap contains a false start of what follows)
    let isRepeat = false;

    // Strategy 1: Words after gap appear in sentence text that covers the gap,
    // suggesting Whisper heard them there but dropped them from word-level
    const afterPhrase = wordsAfter.slice(0, 2).join(" ");
    for (const s of sentences) {
      const sSec = s.start / 1000;
      const eSec = s.end / 1000;
      if (sSec >= gapEnd || eSec <= gapStart) continue;

      const sentWords = s.text.toLowerCase().replace(/[^\w'\s]/g, "").split(/\s+/);
      const sentText = sentWords.join(" ");
      // If the sentence text contains the same phrase that appears right after the gap,
      // and the sentence starts during the gap, the gap likely contains a first attempt
      if (sentText.includes(afterPhrase) && sSec >= gapStart - 0.5) {
        isRepeat = true;
        break;
      }
    }

    // Strategy 2: Last word before gap matches first word after gap
    // (like "to. Number" with gap containing abandoned "Number two")
    if (!isRepeat && wordsBefore.length > 0 && wordsAfter.length >= 2) {
      // Check if the words after the gap form a phrase that could have been started in the gap
      // by looking at whether a sentence segment starts in the gap with similar words
      for (const s of sentences) {
        const sSec = s.start / 1000;
        const eSec = s.end / 1000;
        if (sSec < gapStart || sSec > gapEnd) continue;
        // Sentence starts inside the gap. Its first words should match words after the gap
        const sentWords = s.text.toLowerCase().replace(/[^\w'\s]/g, "").split(/\s+/).filter(w => w.length > 0);
        if (sentWords.length >= 2) {
          const sentPhrase = sentWords.slice(0, 2).join(" ");
          if (sentPhrase === afterPhrase) {
            isRepeat = true;
            break;
          }
        }
      }
    }

    if (!isRepeat) continue;

    // The gap contains a dropped repeat. Cut it.
    const cutStart = gapStart;
    const cutEnd = gapEnd;

    console.log(`    [whisper-gap] ${cutStart.toFixed(2)}s-${cutEnd.toFixed(2)}s: gap contains dropped repeat of "${wordsAfter.slice(0, 3).join(" ")}"`);

    removals.push({
      startSec: Math.max(0, cutStart - BUFFER_SEC),
      endSec: cutEnd + BUFFER_SEC,
      reason: "word-whisper-gap-repeat",
    });
  }

  if (removals.length > 0) {
    console.log(`  Whisper gap detection: found ${removals.length} hidden repeat(s)`);
  }

  return removals;
}

// ── Stretched Word Detection ────────────────────────────────────────────
// Whisper sometimes hides a false start inside a stretched word duration.
// Example: speaker says "and see the di- and see the information"
// Whisper outputs: "and"(0.36s) "see"(0.36s) "the"(0.24s) "information"(1.18s)
// "information" is 1.18s but the word itself is ~0.4s. The extra ~0.8s at the
// start contains "di- and see the" which Whisper absorbed into the word.
//
// Detection: find words with duration > 0.8s where the preceding 2-3 words
// also appear earlier OR where the word duration is more than 2x the expected
// length. Cut the excess from the start of the stretched word.
//
// We also check if the words BEFORE the stretched word could be a repeated
// run-up (false start) by checking for the same word sequence earlier.

export function detectStretchedWordRepeats(
  words: WordTimestamp[],
  sentences: TranscriptSegment[] = []
): Array<{ startSec: number; endSec: number; reason: string }> {
  const removals: Array<{ startSec: number; endSec: number; reason: string }> = [];
  if (words.length < 4) return removals;

  // Compute median word duration to establish what's "normal"
  const durations = words.map((w) => w.end - w.start).filter((d) => d > 0.05 && d < 2);
  durations.sort((a, b) => a - b);
  const medianDuration = durations[Math.floor(durations.length / 2)] || 0.3;

  for (let i = 0; i < words.length; i++) {
    const wordDuration = words[i].end - words[i].start;

    // Only check words that are abnormally long: > 0.8s AND > 2.5x the median
    if (wordDuration < 0.8 || wordDuration < medianDuration * 2.5) continue;

    // The estimated real duration of this word (use median + a bit for longer words)
    const syllableCount = words[i].text.replace(/[^aeiouy]/gi, "").length || 1;
    const expectedDuration = Math.min(medianDuration * syllableCount * 0.7, 0.6);
    const excessDuration = wordDuration - expectedDuration;

    if (excessDuration < 0.4) continue;

    // Check if the preceding 2-3 words also appear in a sentence that starts
    // partway through the stretched word (confirming a restart happened)
    let confirmedFalseStart = false;

    // Strategy 1: sentence-level confirms speech restart in the stretched region
    if (sentences.length > 0 && i >= 2) {
      const prevWords = [words[i - 2], words[i - 1]].map((w) => normalizeWord(w.text)).join(" ");
      for (const s of sentences) {
        const sSec = s.start / 1000;
        // Sentence starts inside the stretched word's time range
        if (sSec > words[i].start && sSec < words[i].end) {
          const sentStart = s.text.toLowerCase().replace(/[^\w'\s]/g, "").trim().split(/\s+/).slice(0, 2).join(" ");
          // And the sentence starts with the same words as what precedes the stretched word
          if (sentStart.includes(prevWords) || prevWords.includes(sentStart)) {
            confirmedFalseStart = true;
            break;
          }
        }
      }
    }

    // Strategy 2: no sentence data, but the word is > 3x median with 2+ words before it
    // that form a common phrase pattern (high confidence it's a restart)
    if (!confirmedFalseStart && wordDuration > medianDuration * 3.5 && i >= 2) {
      confirmedFalseStart = true;
    }

    if (!confirmedFalseStart) continue;

    // Cut the excess from the beginning of the stretched word
    // Keep the last ~expectedDuration of the word (the real pronunciation)
    const cutStart = words[i].start;
    const cutEnd = words[i].end - expectedDuration;

    if (cutEnd - cutStart < 0.3) continue;

    console.log(`    [stretched-word] ${cutStart.toFixed(2)}s-${cutEnd.toFixed(2)}s: "${words[i].text.trim()}" is ${wordDuration.toFixed(2)}s (expected ~${expectedDuration.toFixed(2)}s), trimming ${(cutEnd - cutStart).toFixed(2)}s from start`);

    removals.push({
      startSec: Math.max(0, cutStart - BUFFER_SEC),
      endSec: cutEnd + BUFFER_SEC,
      reason: "word-stretched-false-start",
    });
  }

  if (removals.length > 0) {
    console.log(`  Stretched word detection: found ${removals.length} hidden false start(s)`);
  }

  return removals;
}
