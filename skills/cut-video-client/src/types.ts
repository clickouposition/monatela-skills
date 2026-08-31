import { z } from "zod/v4";

// A section of video to keep (audible part with padding)
export interface VideoSection {
  startFrame: number;
  endFrame: number;
  durationInFrames: number;
}

// Sentence-level transcript segment from Gemini transcription.
export interface TranscriptSegment {
  start: number; // milliseconds
  end: number;   // milliseconds
  text: string;
}

export const ConfigSchema = z.object({
  // Phase 02.2-02 (D-05): nullable/optional. When null/unset,
  // buildCapcutProject takes the scratch path. When set, it takes the
  // clone path (legacy behavior).
  referenceTemplate: z.string().nullable().optional(),
  silence: z.object({
    noiseThresholdInDecibels: z.number().min(-100).max(0).default(-30),
    minSilenceDurationSeconds: z.number().min(0.1).max(10).default(0.5),
    paddingSeconds: z.number().min(0).max(1).default(0.08),
    minAudibleDurationSeconds: z.number().min(0).max(5).default(0.3),
    // Max distance (seconds) a candidate cut may move to land on a
    // transcript word boundary. See Phase 3 CONTEXT D-02. Default 0.4
    // matches the prior hardcoded value so existing runs are unchanged.
    // Distinct from `paddingSeconds`, which is the post-snap edge buffer
    // applied AFTER snapping.
    wordSnapPaddingSeconds: z.number().min(0).max(2).default(0.4),
    // Phase 3 SLNC-03: how much silence to preserve after a word ending in
    // sentence-terminating punctuation (`.`, `?`, `!`). When a silence gap
    // following such a word is longer than this value, we extend the prior
    // audible section by `keepPauseAfterSentenceSeconds` so a natural
    // breathing pause is retained instead of cutting flat into the next
    // sentence. Default 0.4s (Claude's Discretion baseline, Phase 3 CONTEXT).
    keepPauseAfterSentenceSeconds: z.number().min(0).max(5).default(0.4),
  }),
  // Phase 3 CAPT-02: caption hallucination filter knobs.
  captions: z
    .object({
      // Drop AssemblyAI words below this confidence threshold before they
      // reach the caption builder. Default 0.4 (Claude's Discretion baseline,
      // Phase 3 CONTEXT). Set to 0 to disable confidence-based filtering.
      minConfidence: z.number().min(0).max(1).default(0.4),
      // Phase 02.2-02: optional style overrides for scratch caption builder.
      fontSize: z.number().int().positive().optional(),
      color: z.string().optional(),
    })
    .default({ minConfidence: 0.4 }),
  // Phase 02.2-02: optional hook style overrides for scratch builder.
  hook: z
    .object({
      fontSize: z.number().int().positive().optional(),
      position: z.enum(["top", "center"]).optional(),
    })
    .default({}),
  output: z.object({
    // EXISTING keys — PRESERVED (Phase 02.2-02 B2).
    codec: z.enum(["h264", "h265", "vp8", "vp9"]).default("h264"),
    crf: z.number().min(0).max(51).default(18),
    fps: z.number().min(1).max(120).default(30),
    // NEW in Phase 02.2-02 (extend in place — do NOT redefine):
    width: z.number().int().positive().default(1080),
    height: z.number().int().positive().default(1920),
    // Phase 04-01 (BRAIN-01, D-04): target platform for safe-zone positioning.
    // Drives caption / hook transform.y and MG PIP corner via safe-zones.ts.
    platform: z
      .enum(["tiktok", "instagram-reels", "youtube-shorts"])
      .default("tiktok"),
    mgPip: z
      .object({
        widthPct: z.number().min(0.05).max(1).default(0.35),
        corner: z
          .enum(["top-right", "top-left", "bottom-right", "bottom-left"])
          .default("top-right"),
        marginPct: z.number().min(0).max(0.5).default(0.03),
      })
      .default({ widthPct: 0.35, corner: "top-right", marginPct: 0.03 }),
    // Phase 07-01 Task 3: CapCut native Cutout toggle. When true (default),
    // speaker clips emit `matting.flag=3` so Cutout is live in CapCut
    // without manual toggling. See capcut-scratch.ts applySpeakerMatting.
    cutoutDefault: z.boolean().default(true),
    // Phase 07-02 + Phase 08-01: composition layout selector.
    //   "full-frame"                        — legacy (default), no regression
    //   "speaker-top-screen-bottom"         — 9:16 split: speaker top half, screen recording bottom half
    //   "speaker-bottom-screen-top"         — mirror of the above
    //   "mg-background-speaker-foreground"  — MG full-frame background, speaker
    //                                         inset with per-sub-segment Cutout
    //                                         (restored in Phase 08-01, BLOG-10).
    // See capcut-defaults.ts SPLIT_SCREEN_GEOMETRY and MG_BACKGROUND_GEOMETRY.
    // Phase 08-01 added `mg-background-speaker-foreground` back after the
    // 07-02 revert: segment splitting at MG boundaries (splitClipByOverlapRanges)
    // now ensures Cutout + speaker inset only apply where an MG is actually
    // behind the speaker.
    layout: z
      .enum([
        "full-frame",
        "speaker-top-screen-bottom",
        "speaker-bottom-screen-top",
        "mg-background-speaker-foreground",
      ])
      .default("full-frame"),
  }),
  audio: z
    .object({
      enhance: z.boolean().default(true),
      noiseReduction: z.boolean().default(true),
      noiseReductionStrength: z.number().min(20).max(80).default(30),
      voiceBoost: z.boolean().default(true),
      loudnessNormalize: z.boolean().default(true),
    })
    .default({ enhance: true, noiseReduction: true, noiseReductionStrength: 30, voiceBoost: true, loudnessNormalize: true }),
  screenShare: z
    .object({
      enabled: z.boolean().default(false),
      layout: z
        .enum(["screen-main", "camera-main", "stacked"])
        .default("screen-main"),
      cameraSize: z.number().min(0.1).max(0.5).default(0.25),
      cameraPosition: z
        .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
        .default("bottom-right"),
      cameraPadding: z.number().min(0).max(100).default(20),
      cameraBorderRadius: z.number().min(0).max(100).default(12),
      syncOffsetSeconds: z.number().default(0),
    })
    .default({ enabled: false, layout: "screen-main" as const, cameraSize: 0.25, cameraPosition: "bottom-right" as const, cameraPadding: 20, cameraBorderRadius: 12, syncOffsetSeconds: 0 }),
});

export type EditConfig = z.infer<typeof ConfigSchema>;

// Silence detection result
export interface SilenceResult {
  audibleParts: Array<{ startInSeconds: number; endInSeconds: number }>;
  silentParts: Array<{ startInSeconds: number; endInSeconds: number }>;
  durationInSeconds: number;
}

// Screen share layout types
export type PipLayout = "screen-main" | "camera-main" | "side-by-side";
export type PipPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

// Props passed to the Remotion JumpCut composition
export interface JumpCutProps {
  src: string;
  sections: VideoSection[];
}

// ---- Phase 2 Plan 02-02: builder inputs ----

/**
 * One contiguous take of source footage to land on the speaker timeline.
 * Times are in seconds at the source/timeline scale; mutators snap to the
 * 33333μs frame grid via toMicro().
 */
export interface ClipDecision {
  /** Absolute path to the source video file. */
  sourcePath: string;
  /** In-point on the source clip (seconds). */
  sourceStartSec: number;
  /** How long the clip plays (seconds). */
  sourceDurationSec: number;
  /** Where the clip lands on the timeline (seconds). */
  timelineStartSec: number;
}

/**
 * One motion-graphic overlay to drop on the MG track. Range 1–5 per D-07.
 */
export interface MgPlanItem {
  /** Absolute path to the rendered mg-N.mp4 (or compatible). */
  mgPath: string;
  /** Where the MG appears on the timeline (seconds). */
  timelineStartSec: number;
  /** How long the MG plays (seconds). */
  durationSec: number;
}

/**
 * One AssemblyAI transcript word. `start`/`end` are in SECONDS
 * (verified empirically against `temp/transcript-words-*.json` —
 * values like 26.481 = 26.481s, NOT ms).
 */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

/**
 * One caption phrase: a span of joined transcript words rendered as a
 * single native CapCut text segment. Times in seconds.
 */
export interface CaptionPhrase {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Inputs to buildCapcutProject. Captions added in plan 02-03.
 */
export interface BuildCapcutOpts {
  /**
   * Absolute path to the reference CapCut project folder to clone.
   * Phase 02.2-02 (D-05): when null/undefined, buildCapcutProject takes
   * the scratch path instead of the clone path.
   */
  referenceTemplate: string | null | undefined;
  /** Scratch-path knobs (Phase 02.2-02). Only used when referenceTemplate is null/undefined. */
  canvasWidth?: number;
  canvasHeight?: number;
  captionOverrides?: { fontSize?: number; color?: string };
  hookOverrides?: { fontSize?: number; position?: "top" | "center" };
  /** Phase 04-01 (BRAIN-01, D-04): target platform for safe-zone positioning. */
  platform?: "tiktok" | "instagram-reels" | "youtube-shorts";
  /** Phase 04-01: optional MG PIP corner override (else picked by pickMgPipCorner). */
  mgPipCorner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Name for the cloned project (becomes the output folder name). */
  projectName: string;
  /** Override for CapCut drafts directory. Defaults inside cloner. */
  draftsDir?: string;
  /** Speaker-track clip decisions, in timeline order. */
  clips: ClipDecision[];
  /** Hook text string (replaces reference hook content verbatim style-wise). */
  hookText: string;
  /** 1–5 motion graphics. */
  mgs: MgPlanItem[];
  /** AssemblyAI word-level transcript (Phase 1 output). */
  transcriptWords: TranscriptWord[];
  /**
   * Phase 07-01 Task 2: CapCut native Cutout toggle. When true (default),
   * speaker clips export with `matting.flag=3` so Cutout is live in CapCut
   * without manual toggling. Threaded from `config.output.cutoutDefault`.
   */
  cutoutDefault?: boolean;
  /**
   * Phase 07-02: composition layout. Threaded from `config.output.layout`.
   * Defaults to "full-frame" (no regression from 07-01).
   */
  layout?:
    | "full-frame"
    | "speaker-top-screen-bottom"
    | "speaker-bottom-screen-top"
    | "mg-background-speaker-foreground";

  // ─── Phase 14: v2.0 chatbot toggle keys (TOGL-02) ──────────────────────
  /** Caption display style. Defaults to "bold-bg" (current behavior, per D-04). */
  captionStyle?: "bold-bg" | "clean" | "subtitle-bar" | "word-highlight";
  /** Hook text display style. Defaults to "big-bold" (current behavior, per D-04). */
  hookStyle?: "big-bold" | "typed" | "minimal" | "animated";
  /** Motion graphic kind. */
  mgKind?: "visual-metaphor" | "text-stats" | "lists" | "mix";
  /** Motion graphic placement. */
  mgPlacement?: "behind-speaker" | "corner-pip" | "full-replace" | "auto";
  /** Whether AI b-roll generation is enabled. Defaults to false (per D-04). */
  broll?: boolean;
  /** B-roll placement mode. */
  brollPlacement?: "behind-speaker" | "full-replace" | "auto";
  /** Screen share layout mode. */
  screenLayout?: "split-screen" | "full-screen" | "speaker-pip" | "screen-pip";
  /** Whether greenscreen background removal is enabled. Defaults to false (per D-04). */
  greenscreen?: boolean;
  /** Transition mode between cuts. Defaults to "none" (per D-04). */
  transitions?: "smooth" | "none" | "auto";
  /** Whether sound effects at cuts are enabled. Defaults to false (per D-04). */
  soundEffects?: boolean;
  /** Target video duration range. Defaults to "full" (per D-04). */
  targetDuration?: "0-15" | "15-30" | "30-60" | "60-180" | "full";
}
