/**
 * Regenerates temp/normalized-<name>.mp4 for one or more source videos
 * without touching transcripts, ai-cuts.json, or CapCut projects.
 *
 * Use when the normalized file was deleted but the CapCut project (and its
 * cuts) already exist — CapCut just needs the media file back at the same
 * path to relink.
 */

import { findFfmpeg } from "./ffmpeg.js";
import { normalizeVideo } from "./normalize-video.js";

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("Usage: tsx src/renormalize.ts <video-path> [video-path...]");
    process.exit(1);
  }

  const ffmpegPath = findFfmpeg();

  for (const p of paths) {
    console.log(`\n== ${p} ==`);
    try {
      const out = normalizeVideo(p, ffmpegPath);
      console.log(`  -> ${out}`);
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
