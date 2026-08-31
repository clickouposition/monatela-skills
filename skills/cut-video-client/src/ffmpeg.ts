/**
 * FFmpeg binary discovery — finds the best available FFmpeg on the system.
 * Prefers system FFmpeg over winget-installed versions.
 */

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

let cachedPath: string | null = null;

export function findFfmpeg(silent = false): string {
  if (cachedPath) return cachedPath;

  // Check system PATH via cmd.exe
  const cmdResult = spawnSync("cmd", ["/c", "where", "ffmpeg"], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (cmdResult.status === 0 && cmdResult.stdout?.trim()) {
    const systemFfmpeg = cmdResult.stdout.trim().split("\r\n")[0].trim();
    if (!silent) console.log(`  Using system FFmpeg: ${systemFfmpeg}`);
    cachedPath = systemFfmpeg;
    return systemFfmpeg;
  }

  // Check common winget install location
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (home) {
    const wingetBase = join(
      home, "AppData", "Local", "Microsoft", "WinGet", "Packages"
    );
    if (existsSync(wingetBase)) {
      try {
        const dirs = readdirSync(wingetBase);
        const ffmpegDir = dirs.find((d) => d.startsWith("Gyan.FFmpeg"));
        if (ffmpegDir) {
          const pkgDir = join(wingetBase, ffmpegDir);
          const subDirs = readdirSync(pkgDir);
          for (const sub of subDirs) {
            const candidate = join(pkgDir, sub, "bin", "ffmpeg.exe");
            if (existsSync(candidate)) {
              if (!silent) console.log(`  Using system FFmpeg: ${candidate}`);
              cachedPath = candidate;
              return candidate;
            }
          }
        }
      } catch {}
    }
  }

  throw new Error(
    "FFmpeg not found. Install FFmpeg via `winget install Gyan.FFmpeg` or add it to PATH."
  );
}

/**
 * Find ffprobe binary — same logic as ffmpeg but for ffprobe.
 */
export function findFfprobe(silent = false): string {
  const ffmpegPath = findFfmpeg(silent);
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  if (existsSync(ffprobePath)) return ffprobePath;
  // Fallback: try system PATH
  const cmdResult = spawnSync("cmd", ["/c", "where", "ffprobe"], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (cmdResult.status === 0 && cmdResult.stdout?.trim()) {
    return cmdResult.stdout.trim().split("\r\n")[0].trim();
  }
  throw new Error("ffprobe not found.");
}
