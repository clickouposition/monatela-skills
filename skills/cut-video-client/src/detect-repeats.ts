import type { TranscriptSegment } from "./types.js";

/**
 * 7-type retake/repeat detection system.
 * Adapted from Ceeon/videocut-skills for English talking-head content.
 *
 * Core principle: "Delete earlier, keep later" (the later attempt is usually better).
 * Approach: Split transcript into sentences by silence gaps, then compare whole sentences.
 *
 * Detection types (in priority order):
 * 1. Repeated sentences (adjacent sentences sharing opening words)
 * 2. Skip-one repeats (repeat separated by a short fragment)
 * 3. Incomplete sentences (cut off mid-thought + silence)
 * 4. In-sentence repetition (says part of a sentence, restarts it)
 * 5. Stutter words (same word repeated 2-3 times)
 * 6. Self-corrections ("I mean", "no wait", partial repeat + correction)
 * 7. Filler-only segments (standalone "okay", "so", "alright")
 */

interface Removal {
  startSec: number;
  endSec: number;
  type: string;
  text: string;
}

const BUFFER_MS = 50; // Extend deletion 50ms each side (catches breath sounds)

/**
 * Distinguish rhetorical repetition from actual retakes.
 * Rhetorical: speaker intentionally repeats for emphasis (keep both).
 * Retake: speaker restarts after a mistake (cut the earlier one).
 */
function isLikelyRhetorical(
  first: TranscriptSegment,
  second: TranscriptSegment
): boolean {
  const gapMs = second.start - first.end;
  const firstWords = first.text.trim().split(/\s+/);
  const secondWords = second.text.trim().split(/\s+/);

  // Second occurrence elaborates (adds 3+ words) → rhetorical emphasis
  if (secondWords.length > firstWords.length + 2) return true;

  // No pause between (< 300ms) → continuous rhetorical flow
  if (gapMs < 300) return true;

  // Second is significantly shorter → likely a false start, not rhetorical
  // (rhetorical repetition usually matches or extends)
  if (secondWords.length < firstWords.length - 2) return false;

  return false;
}

export function detectRepeats(
  segments: TranscriptSegment[]
): Array<{ startSec: number; endSec: number }> {
  if (segments.length === 0) return [];

  const removals: Removal[] = [];

  // Run all detection types in priority order
  const used = new Set<number>(); // Track segments already marked for removal

  detectRetakeSignals(segments, removals, used);
  detectRepeatedSentences(segments, removals, used);
  detectSkipOneRepeats(segments, removals, used);
  detectFalseStarts(segments, removals, used);
  detectIncompleteSentences(segments, removals, used);
  detectInSentenceRepetition(segments, removals, used);
  detectStutterWords(segments, removals, used);
  detectSelfCorrections(segments, removals, used);
  detectFillerOnlySegments(segments, removals, used);
  detectStutterRepeats(segments, removals, used);
  detectTrailingEmpty(segments, removals, used);

  // Log results
  if (removals.length > 0) {
    for (const r of removals) {
      const preview = r.text.substring(0, 50);
      console.log(`    [${r.type}] "${preview}${r.text.length > 50 ? "..." : ""}"`);
    }
    console.log(`  Found ${removals.length} segment(s) to remove`);
  } else {
    console.log("  No repeated takes detected");
  }

  // Apply buffer expansion (50ms each side) and return
  return removals.map((r) => ({
    startSec: Math.max(0, r.startSec - BUFFER_MS / 1000),
    endSec: r.endSec + BUFFER_MS / 1000,
  }));
}

// ── Pre-pass: Multi-Repeats ──────────────────────────────────────────
// When 3+ segments share the same opening (e.g. speaker says "AI first means..."
// three times), keep only the LAST one and cut all earlier occurrences.
function detectMultiRepeats(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  // Group segments by content similarity (normalized, filler removed)
  // Uses multiple key lengths (3 and 4 words) and also checks content-word overlap
  const groups = new Map<string, number[]>();
  const contentOf: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\b(so|and|now|okay|but|the|a|an|is|it|that|um|uh|well|like|just|basically|actually)\b/g, "")
      .trim();
    const words = text.split(/\s+/).filter(w => w.length > 1);
    contentOf.push(words.join(" "));
    if (words.length < 3) continue;

    // Key on first 3 content words
    const key = words.slice(0, 3).join(" ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  // Also group by high content-word overlap (>60% shared words)
  for (let i = 0; i < segments.length; i++) {
    const wordsI = contentOf[i].split(/\s+/).filter(w => w.length > 1);
    if (wordsI.length < 4) continue;
    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue;
      const wordsJ = contentOf[j].split(/\s+/).filter(w => w.length > 1);
      if (wordsJ.length < 4) continue;
      const setI = new Set(wordsI);
      let matches = 0;
      for (const w of wordsJ) { if (setI.has(w)) matches++; }
      const overlap = matches / Math.min(wordsI.length, wordsJ.length);
      if (overlap >= 0.6) {
        const key = "_overlap_" + i;
        if (!groups.has(key)) { groups.set(key, [i]); }
        if (!groups.get(key)!.includes(j)) groups.get(key)!.push(j);
      }
    }
  }

  for (const [key, indices] of groups) {
    if (indices.length < 2) continue;
    // Deduplicate indices
    const unique = [...new Set(indices)];
    if (unique.length < 2) continue;
    // Keep the last, cut all earlier
    const last = unique[unique.length - 1];
    for (let k = 0; k < unique.length - 1; k++) {
      const idx = unique[k];
      if (used.has(idx)) continue;
      used.add(idx);
      removals.push({
        startSec: segments[idx].start / 1000,
        endSec: segments[idx].end / 1000,
        type: "multi-repeat",
        text: segments[idx].text.trim(),
      });
    }
    used.add(last); // protect the last one
    console.log(`    [multi-repeat] "${key.substring(0, 30)}..." — kept last of ${unique.length} occurrences`);
  }
}

// ── Type 1: Repeated Sentences ──────────────────────────────────────────
// Adjacent (or near-adjacent) sentences where the opening words match.
// Delete the earlier one (shorter or first attempt), keep the later.
//
// Two modes:
// A) Exact opening match (3+ words): scans ALL segments (no time limit).
//    Catches retakes like "all right so it loaded" repeated minutes apart.
// B) Fuzzy overlap match: only within 15 seconds (catches in-take stumbles,
//    not cross-take topic similarities).
function detectRepeatedSentences(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  for (let i = 0; i < segments.length - 1; i++) {
    if (used.has(i)) continue;

    const textI = normalizeWithNumbers(segments[i].text);
    const allWordsI = textI.split(" ").filter((w) => w.length > 0);
    const contentWordsI = getContentWords(textI);
    if (allWordsI.length < 2) continue;

    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue;

      const textJ = normalizeWithNumbers(segments[j].text);
      const allWordsJ = textJ.split(" ").filter((w) => w.length > 0);
      if (allWordsJ.length < 2) continue;

      const gapSec = (segments[j].start - segments[i].end) / 1000;

      // Mode A: Exact opening match (3+ words in sequence)
      // Uses number normalization so "3 things" matches "three things"
      // Safety guards to avoid cutting unique sentences that just start similarly:
      // - The matching opening must be a significant portion of the shorter sentence,
      //   because "I myself have" matching in a 10-word unique sentence is NOT a repeat.
      //   If the overlap covers most of the shorter sentence, it's a real retake.
      //   If the overlap is a tiny fraction, they just happen to start the same way.
      // - Very long exact matches (5+ words) are always retakes regardless of sentence length.
      // - Sentences far apart in the video are unlikely to be retakes (more likely the
      //   speaker revisits a topic). Only flag retakes within a reasonable window.
      const fullOpening = getOpeningOverlap(allWordsI, allWordsJ);
      const minLen = Math.min(allWordsI.length, allWordsJ.length);
      const overlapIsSignificant = fullOpening / minLen >= 0.5;
      const overlapIsLong = fullOpening >= 5;
      const withinRetakeWindow = gapSec <= 30;
      if (fullOpening >= 3 && (overlapIsSignificant || overlapIsLong) && withinRetakeWindow) {
        // Check if this is rhetorical repetition (intentional emphasis) — don't cut those
        if (isLikelyRhetorical(segments[i], segments[j])) continue;

        used.add(i);   // cut the earlier (worse) take
        used.add(j);   // protect the later (better) take from being cut
        removals.push({
          startSec: segments[i].start / 1000,
          endSec: segments[i].end / 1000,
          type: "repeated-sentence",
          text: segments[i].text.trim(),
        });
        break;
      }

      // Mode B: Content-word opening overlap (within 10 seconds only)
      // Requires 3+ content words matching in sequence to avoid false positives
      // on short sentences that happen to share common words
      if (gapSec > 10) continue;

      if (contentWordsI.length >= 3) {
        const contentWordsJ = getContentWords(textJ);
        if (contentWordsJ.length >= 3) {
          const contentOpening = getOpeningOverlap(contentWordsI, contentWordsJ);
          if (contentOpening >= 3) {
            used.add(i);
            used.add(j);  // protect the later take
            removals.push({
              startSec: segments[i].start / 1000,
              endSec: segments[i].end / 1000,
              type: "repeated-sentence",
              text: segments[i].text.trim(),
            });
            break;
          }
        }
      }

      // Mode C: Near-identical sentences (70%+ of ALL words match, within 10s)
      // Also catches retakes where a shorter sentence is mostly contained in a longer one.
      if (allWordsI.length >= 4 && allWordsJ.length >= 4) {
        const setI = new Set(allWordsI);
        let matchCount = 0;
        for (const w of allWordsJ) {
          if (setI.has(w)) matchCount++;
        }
        const maxLen = Math.max(allWordsI.length, allWordsJ.length);
        const minLen = Math.min(allWordsI.length, allWordsJ.length);
        // Check both: 70% of the longer OR 75% of the shorter (if 6+ words, to avoid false positives on short filler-heavy sentences)
        if (matchCount / maxLen >= 0.7 || (minLen >= 6 && matchCount / minLen >= 0.75)) {
          used.add(i);
          used.add(j);  // protect the later take
          removals.push({
            startSec: segments[i].start / 1000,
            endSec: segments[i].end / 1000,
            type: "repeated-sentence",
            text: segments[i].text.trim(),
          });
          break;
        }
      }
    }
  }
}

// ── Type 2: Skip-One Repeats ────────────────────────────────────────────
// Catches: "I want to show you" -> "okay" -> "I want to show you how"
// The middle fragment is short, and segments i and i+2 are similar.
function detectSkipOneRepeats(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  for (let i = 0; i < segments.length - 2; i++) {
    if (used.has(i)) continue;

    const textI = normalize(segments[i].text);
    const allWordsI = textI.split(" ").filter((w) => w.length > 0);
    if (allWordsI.length < 2) continue;

    // Middle segment should be short (filler/false start)
    const midText = normalize(segments[i + 1].text);
    const midWords = midText.split(" ");
    if (midWords.length > 4) continue;

    const j = i + 2;
    if (used.has(j) || j >= segments.length) continue;
    const gap = (segments[j].start - segments[i].end) / 1000;
    if (gap > 20) continue;

    const textJ = normalize(segments[j].text);
    const allWordsJ = textJ.split(" ").filter((w) => w.length > 0);
    if (allWordsJ.length < 2) continue;

    // Check full-word or content-word opening overlap
    const fullOpening = getOpeningOverlap(allWordsI, allWordsJ);
    const contentOpening = getOpeningOverlap(getContentWords(textI), getContentWords(textJ));
    if (fullOpening >= 2 || contentOpening >= 2) {
      // Delete the earlier attempt AND the filler between them
      used.add(i);
      if (!used.has(i + 1)) {
        used.add(i + 1);
        removals.push({
          startSec: segments[i + 1].start / 1000,
          endSec: segments[i + 1].end / 1000,
          type: "skip-one-filler",
          text: segments[i + 1].text.trim(),
        });
      }
      removals.push({
        startSec: segments[i].start / 1000,
        endSec: segments[i].end / 1000,
        type: "skip-one-repeat",
        text: segments[i].text.trim(),
      });
    }
  }
}

// ── Type 3: Incomplete Sentences ────────────────────────────────────────
// Short fragments that trail off (speaker abandoned the thought).
// Detected by: short segment + silence gap or text ending with "..."
function detectIncompleteSentences(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  for (let i = 0; i < segments.length - 1; i++) {
    if (used.has(i)) continue;

    const rawText = segments[i].text.trim();
    const text = normalize(rawText);
    const words = text.split(" ");

    // Explicit trail-off: text ends with "..." (Whisper marks these)
    if (rawText.endsWith("...") && words.length <= 5) {
      used.add(i);
      removals.push({
        startSec: segments[i].start / 1000,
        endSec: segments[i].end / 1000,
        type: "incomplete-sentence",
        text: rawText,
      });
      continue;
    }

    // Very short fragment (1-2 words, under 2 seconds) is almost always junk
    // BUT: if it immediately follows the previous segment (< 0.3s gap), it may
    // be a natural sentence continuation (e.g. "and more" completing a list).
    // Don't cut those.
    const duration = (segments[i].end - segments[i].start) / 1000;
    if (words.length <= 2 && duration < 2) {
      const cw = getContentWords(text);
      const gapBefore = i > 0 ? (segments[i].start - segments[i - 1].end) / 1000 : 999;
      // Single content word or no content words = fragment, BUT only if preceded by a gap
      if (cw.length <= 1 && gapBefore >= 0.3) {
        used.add(i);
        removals.push({
          startSec: segments[i].start / 1000,
          endSec: segments[i].end / 1000,
          type: "incomplete-sentence",
          text: segments[i].text.trim(),
        });
        continue;
      }
    }

    // Short fragment (1-4 words)
    if (words.length > 4 || words.length < 1) continue;

    // Gap after it (>= 0.3 seconds - lowered for sentence-level segments)
    const gapAfter = (segments[i + 1].start - segments[i].end) / 1000;
    if (gapAfter < 0.3) continue;

    // Next segment starts differently (not a continuation)
    const nextText = normalize(segments[i + 1].text);
    const nextWords = getContentWords(nextText);
    const currentWords = getContentWords(text);

    if (currentWords.length === 0) continue;

    // If first content word is different, this was likely abandoned
    if (nextWords.length > 0 && currentWords[0] !== nextWords[0]) {
      // Don't cut if the fragment is meaningful on its own
      if (words.length >= 3 && !isFillerPhrase(text)) continue;

      used.add(i);
      removals.push({
        startSec: segments[i].start / 1000,
        endSec: segments[i].end / 1000,
        type: "incomplete-sentence",
        text: segments[i].text.trim(),
      });
    }
  }
}

// ── Type 4: In-Sentence Repetition ──────────────────────────────────────
// Within one segment: "I want to I want to show you"
// Pattern: A + filler/pause + A (same phrase repeated within one segment)
// Estimates word-level timestamps proportionally and cuts the first occurrence.
function detectInSentenceRepetition(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const text = normalize(segments[i].text);
    const words = text.split(" ");
    if (words.length < 6) continue;

    // Look for repeated 3-word sequences within the segment.
    // Only cut the DUPLICATE portion — not everything from the start of the line.
    // Example: "get the API key then it will then it can scrape"
    //   → cut the first "then it will" portion only, keep everything before and after
    for (let a = 0; a < words.length - 5; a++) {
      const phrase = `${words[a]} ${words[a + 1]} ${words[a + 2]}`;
      // Search for the same phrase later in the segment
      for (let b = a + 3; b <= words.length - 3; b++) {
        const candidate = `${words[b]} ${words[b + 1]} ${words[b + 2]}`;
        if (phrase === candidate) {
          // Estimate cut point by word position in segment (proportional).
          // Cut from the START of the first occurrence (word index a)
          // to just before the SECOND occurrence (word index b).
          // This removes ONLY the duplicate phrase, keeping content before and after.
          const segStart = segments[i].start / 1000;
          const segEnd = segments[i].end / 1000;
          const segDuration = segEnd - segStart;
          const cutStartSec = segStart + (a / words.length) * segDuration;
          const cutEndSec = segStart + (b / words.length) * segDuration;

          // Only add removal if it's a meaningful duration (>0.2s)
          // Very short cuts get handled by word-level stutter detection instead
          if (cutEndSec - cutStartSec > 0.2) {
            removals.push({
              startSec: cutStartSec,
              endSec: cutEndSec,
              type: "in-sentence-repeat",
              text: segments[i].text.trim(),
            });
          }
          // Don't mark the whole segment as used — it has kept content before/after
          break;
        }
      }
    }
  }
}

// ── Type 5: Stutter Words ───────────────────────────────────────────────
// Same word repeated 2-3 times: "the the the" or "I I want"
// Estimates word-level timestamps proportionally and cuts the repeated words.
function detectStutterWords(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const text = normalize(segments[i].text);
    const words = text.split(" ");

    for (let w = 0; w < words.length - 1; w++) {
      if (words[w] === words[w + 1] && words[w].length > 1) {
        // Count how many times the word repeats
        let repeatEnd = w + 1;
        while (repeatEnd < words.length && words[repeatEnd] === words[w]) {
          repeatEnd++;
        }
        // Cut the repeated words (keep only the last one)
        const segStart = segments[i].start / 1000;
        const segEnd = segments[i].end / 1000;
        const segDuration = segEnd - segStart;
        const cutStart = segStart + (w / words.length) * segDuration;
        const cutEnd = segStart + ((repeatEnd - 1) / words.length) * segDuration;

        if (cutEnd - cutStart > 0.1) {
          removals.push({
            startSec: cutStart,
            endSec: cutEnd,
            type: "stutter-word",
            text: `"${words[w]}" repeated ${repeatEnd - w}x`,
          });
        }
        break; // Only handle first stutter per segment
      }
    }
  }
}

// ── Type 6: Self-Corrections ────────────────────────────────────────────
// "I mean", "no wait", "sorry", "actually no" followed by a restart.
// Delete the segment before the correction marker.
function detectSelfCorrections(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  const correctionMarkers = [
    "i mean", "no wait", "wait no", "sorry", "actually no",
    "let me start over", "let me try again", "no no no",
    "thats not right", "thats wrong", "no thats",
  ];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const text = normalize(segments[i].text);

    for (const marker of correctionMarkers) {
      if (text.startsWith(marker) || text.includes(` ${marker}`)) {
        // The correction marker itself might be removable if the previous segment
        // is what's being corrected
        if (i > 0 && !used.has(i - 1)) {
          const prevText = normalize(segments[i - 1].text);
          const prevWords = getContentWords(prevText);
          // Check if the segment after the correction restarts the same idea
          if (i + 1 < segments.length) {
            const nextText = normalize(segments[i + 1].text);
            const nextWords = getContentWords(nextText);
            const prevOverlap = getContentWordOverlap(prevWords, nextWords);
            if (prevWords.length >= 2 && prevOverlap >= 1) {
              // Remove the bad take (before the correction)
              used.add(i - 1);
              removals.push({
                startSec: segments[i - 1].start / 1000,
                endSec: segments[i - 1].end / 1000,
                type: "self-correction",
                text: segments[i - 1].text.trim(),
              });
              // Also remove the correction marker itself
              used.add(i);
              removals.push({
                startSec: segments[i].start / 1000,
                endSec: segments[i].end / 1000,
                type: "correction-marker",
                text: segments[i].text.trim(),
              });
            }
          }
        }
        break;
      }
    }
  }
}

// ── Type 7: Filler-Only Segments ────────────────────────────────────────
// Standalone segments that are pure filler: "okay", "so", "alright", "um"
// Also catches setup phrases like "okay so let's see now", "okay great"
function detectFillerOnlySegments(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  const fillerPhrases = new Set([
    "okay", "ok", "so", "alright", "all right", "um", "uh",
    "right", "yeah", "well", "okay so", "alright so", "so yeah",
    "okay okay", "right right", "yeah yeah", "oh", "ah",
    "you know", "like", "anyway", "anyways",
    "okay great", "okay good", "great", "good",
    "lets see", "okay lets see", "okay so lets see",
    "okay so lets see now", "lets go", "here we go",
    "so yeah", "okay cool",
  ]);

  // Regex patterns for filler-like sentences (all filler words, no real content)
  const fillerPattern = /^(okay|ok|so|alright|all right|um|uh|right|yeah|well|oh|ah|great|good|let'?s|see|now|go|here|we|and|cool|,|\s)+$/i;

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const text = normalize(segments[i].text);
    const duration = (segments[i].end - segments[i].start) / 1000;

    // Exact match on known fillers
    if (duration < 4 && fillerPhrases.has(text)) {
      used.add(i);
      removals.push({
        startSec: segments[i].start / 1000,
        endSec: segments[i].end / 1000,
        type: "filler-only",
        text: segments[i].text.trim(),
      });
      continue;
    }

    // Pattern match: sentence made entirely of filler words (<= 4 seconds)
    if (duration <= 4 && fillerPattern.test(text) && text.length < 35) {
      used.add(i);
      removals.push({
        startSec: segments[i].start / 1000,
        endSec: segments[i].end / 1000,
        type: "filler-only",
        text: segments[i].text.trim(),
      });
      continue;
    }

    // Short trailing fragment at the very start of the video (first 10 seconds)
    // These are always setup/warmup: "Okay, so let's see now. Okay, great."
    if (segments[i].start < 10000 && duration < 4) {
      const contentWords = getContentWords(text);
      if (contentWords.length <= 1) {
        used.add(i);
        removals.push({
          startSec: segments[i].start / 1000,
          endSec: segments[i].end / 1000,
          type: "filler-only",
          text: segments[i].text.trim(),
        });
      }
    }
  }
}

// ── Type 8: Stutter Repeats ────────────────────────────────────────────
// "I switched. I switched." - same short phrase said twice within one sentence
// Different from Type 4 (in-sentence repetition) because this catches exact
// phrase doubling detected via Whisper's sentence boundaries.
// Cuts the first occurrence, keeps the second (usually better delivery).
function detectStutterRepeats(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const text = normalize(segments[i].text);
    // Check if the sentence contains itself repeated: "X. X." or "X X"
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 2);
    if (sentences.length >= 2) {
      for (let a = 0; a < sentences.length - 1; a++) {
        for (let b = a + 1; b < sentences.length; b++) {
          if (sentences[a] === sentences[b] ||
              (sentences[a].length > 5 && sentences[b].startsWith(sentences[a]))) {
            // Cut the first occurrence proportionally
            const segStart = segments[i].start / 1000;
            const segEnd = segments[i].end / 1000;
            const segDuration = segEnd - segStart;
            // Estimate where the second sentence starts based on character position
            const rawText = normalize(segments[i].text);
            const firstEnd = rawText.indexOf(sentences[b]);
            const proportion = firstEnd > 0 ? firstEnd / rawText.length : 0.5;
            const cutEnd = segStart + proportion * segDuration;

            removals.push({
              startSec: segStart,
              endSec: cutEnd,
              type: "stutter-repeat",
              text: segments[i].text.trim(),
            });
            // Don't mark as fully used since we're keeping the second half
            break;
          }
        }
      }
    }
  }
}

// ── Type 9: Retake Signals ──────────────────────────────────────────────
// Detects segments where the speaker explicitly says they're retaking:
// "starting again", "start again", "one more time", "let me redo", etc.
// These phrases can appear anywhere in the segment (often at the end).
// When found, cut that segment AND all kept segments before it back to the
// previous silence gap (the entire failed attempt).
function detectRetakeSignals(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  const retakePhrases = [
    "starting again", "start again", "again from", "one more time",
    "let me redo", "redo that", "try again", "do that again",
    "take two", "take 2", "from the top", "from the beginning",
  ];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const text = normalize(segments[i].text);

    let isRetake = false;
    for (const phrase of retakePhrases) {
      if (text.includes(phrase)) {
        isRetake = true;
        break;
      }
    }
    // Also catch segments ending with just "again" (like "...into starting again")
    if (!isRetake && text.endsWith(" again") && text.split(" ").length <= 10) {
      isRetake = true;
    }

    if (!isRetake) continue;

    // Cut this segment
    used.add(i);
    removals.push({
      startSec: segments[i].start / 1000,
      endSec: segments[i].end / 1000,
      type: "retake-signal",
      text: segments[i].text.trim(),
    });

    // Walk backwards and cut all preceding kept segments until we hit a silence gap (> 1s)
    // or another already-used segment. This removes the whole failed attempt.
    for (let j = i - 1; j >= 0; j--) {
      if (used.has(j)) break;
      const gapAfter = (segments[j + 1].start - segments[j].end) / 1000;
      used.add(j);
      removals.push({
        startSec: segments[j].start / 1000,
        endSec: segments[j].end / 1000,
        type: "retake-signal-predecessor",
        text: segments[j].text.trim(),
      });
      // Stop if there was a significant gap before this segment (it was a separate attempt)
      if (gapAfter > 1.5) break;
    }
  }
}

// ── Type 10: False Starts ──────────────────────────────────────────────
// Catches segments that share key content words with a later segment but
// don't match the strict 3-word-opening requirement. If a shorter segment
// shares 2+ content words with a longer segment within 30s, and the shorter
// one comes first, it's likely a false start.
function detectFalseStarts(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  for (let i = 0; i < segments.length - 1; i++) {
    if (used.has(i)) continue;

    const textI = normalize(segments[i].text);
    const wordsI = textI.split(" ").filter((w) => w.length > 0);
    const contentI = getContentWords(textI);
    if (contentI.length < 1 || wordsI.length > 8) continue; // Only short segments are false starts

    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j)) continue;

      const gapSec = (segments[j].start - segments[i].end) / 1000;
      if (gapSec > 30) break;

      const textJ = normalize(segments[j].text);
      const wordsJ = textJ.split(" ").filter((w) => w.length > 0);
      if (wordsJ.length <= wordsI.length) continue; // Later segment should be longer (the real take)

      const contentJ = getContentWords(textJ);
      const overlap = getContentWordOverlap(contentI, contentJ);

      // If the shorter segment shares 2+ content words with a longer later segment, cut it
      if (overlap >= 2 && overlap >= contentI.length * 0.5) {
        used.add(i);
        removals.push({
          startSec: segments[i].start / 1000,
          endSec: segments[i].end / 1000,
          type: "false-start",
          text: segments[i].text.trim(),
        });
        break;
      }
    }
  }
}

// ── Type 11: Trailing Empty ────────────────────────────────────────────
// Segments at the very end with no text should be cut (dead air after filming).
function detectTrailingEmpty(
  segments: TranscriptSegment[],
  removals: Removal[],
  used: Set<number>
): void {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (used.has(i)) continue;
    const text = normalize(segments[i].text);
    if (text.length === 0) {
      used.add(i);
      removals.push({
        startSec: segments[i].start / 1000,
        endSec: segments[i].end / 1000,
        type: "trailing-empty",
        text: "(empty)",
      });
    } else {
      break; // Stop once we hit a segment with text
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize with number-to-word conversion for better matching
function normalizeWithNumbers(text: string): string {
  const numWords: Record<string, string> = {
    "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
  };
  let t = normalize(text);
  // Replace standalone digits with words
  t = t.replace(/\b(\d+)\b/g, (_, d) => numWords[d] || d);
  return t;
}

const FILLER_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "so", "um", "uh", "like",
  "just", "okay", "ok", "oh", "well", "right", "yeah", "yes", "no",
  "i", "me", "my", "we", "our", "you", "your", "it", "its",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "to", "of", "in",
  "on", "at", "for", "with", "that", "this", "very", "all",
  "alright", "gonna", "wanna", "really", "actually", "basically",
  "here", "there", "then", "now", "can", "will", "would", "could",
  "should", "let's", "lets", "see", "go", "get", "got", "going",
  "know", "said", "say", "look", "looking", "come", "put", "take",
  "want", "need", "think", "about", "more", "also", "too",
]);

function getContentWords(text: string): string[] {
  return text.split(" ").filter((w) => w.length > 1 && !FILLER_WORDS.has(w));
}

/** Count how many opening content words match between two texts */
function getOpeningOverlap(wordsA: string[], wordsB: string[]): number {
  let count = 0;
  const limit = Math.min(wordsA.length, wordsB.length, 5);
  for (let i = 0; i < limit; i++) {
    if (wordsA[i] === wordsB[i]) count++;
    else break;
  }
  return count;
}

/** Count shared content words between two word arrays */
function getContentWordOverlap(wordsA: string[], wordsB: string[]): number {
  const setA = new Set(wordsA);
  let count = 0;
  for (const w of wordsB) {
    if (setA.has(w)) count++;
  }
  return count;
}

function isFillerPhrase(text: string): boolean {
  const fillers = new Set([
    "okay", "ok", "so", "alright", "all right", "um", "uh",
    "right", "yeah", "well", "oh", "ah",
  ]);
  return fillers.has(text.trim());
}
