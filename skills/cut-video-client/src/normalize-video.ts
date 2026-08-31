/**
 * Normalize the source video into a clean format that ffmpeg, AssemblyAI,
 * and CapCut all interpret identically.
 *
 * Why this exists: input videos can be H.265 with variable frame rate,
 * rotation metadata, AAC priming delays, etc. Each downstream tool seeks
 * and decodes those subtly differently — three tools, three timelines.
 * Normalizing once at the start eliminates the entire class of timing bugs.
 *
 * Output is constant 30fps H.264, rotation baked into pixels, AAC at 48kHz.
 * Cached in temp/ — skipped if newer than source.
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, basename, extname, join } from "node:path";

const TEMP_DIR = resolve(import.meta.dirname, "..", "temp");

export function normalizeVideo(
  sourcePath: string,
  ffmpegPath: string
): string {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

  const absSource = resolve(sourcePath);
  const baseName = basename(absSource, extname(absSource));
  const normalizedPath = join(TEMP_DIR, `normalized-${baseName}.mp4`);

  if (existsSync(normalizedPath)) {
    const sourceMtime = statSync(absSource).mtimeMs;
    const normMtime = statSync(normalizedPath).mtimeMs;
    if (normMtime > sourceMtime) {
      console.log(`  Using cached normalized video: ${normalizedPath}`);
      return normalizedPath;
    }
  }

  console.log("  Normalizing source video (one-time, ~1-3 min)...");
  console.log("    -> CFR 30fps, H.264, rotation baked, AAC 48kHz, scaled to 1080x1920");

  // Decode (auto-rotates per metadata) -> scale to 1080x1920 portrait ->
  // force 30fps -> re-encode H.264 + AAC. The result has identical
  // timestamps for ffmpeg seeking and CapCut playback.
  const cmd = [
    `"${ffmpegPath}"`,
    `-y`,
    `-i "${absSource}"`,
    `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30"`,
    `-c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p`,
    `-c:a aac -b:a 192k -ar 48000 -ac 2`,
    `-movflags +faststart`,
    `"${normalizedPath}"`,
  ].join(" ");

  try {
    execSync(cmd, { stdio: "pipe", timeout: 3600000, maxBuffer: 1024 * 1024 * 64 });
  } catch (err) {
    const e = err as Error & { stderr?: Buffer };
    const stderr = e.stderr?.toString() ?? "";
    throw new Error(
      `Failed to normalize video.\nCommand: ${cmd}\nStderr (last 800 chars): ${stderr.slice(-800)}`
    );
  }

  const sizeMB = (statSync(normalizedPath).size / 1024 / 1024).toFixed(1);
  console.log(`  Normalized video ready: ${sizeMB} MB`);
  return normalizedPath;
}
