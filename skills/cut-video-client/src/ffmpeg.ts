/**
 * FFmpeg binary discovery — finds the best available FFmpeg on the system.
 * Prefers system FFmpeg over winget-installed versions.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

let cachedPath: string | null = null;

export function findFfmpeg(silent = false): string {
  if (cachedPath) return cachedPath;

  // macOS / Linux: system PATH first, then the bundled Remotion wrapper in ./bin
  if (process.platform !== "win32") {
    const which = spawnSync("which", ["ffmpeg"], { encoding: "utf-8", stdio: "pipe" });
    if (which.status === 0 && which.stdout?.trim()) {
      cachedPath = which.stdout.trim().split("\n")[0];
    } else {
      const local = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "ffmpeg");
      if (existsSync(local)) cachedPath = local;
    }
    if (cachedPath) {
      if (!silent) console.log(`  Using FFmpeg: ${cachedPath}`);
      return cachedPath;
    }
    throw new Error("FFmpeg not found. Run `brew install ffmpeg` or keep bin/ffmpeg wrapper.");
  }

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

/** CapCut "User Data" folder: %LOCALAPPDATA%\CapCut\User Data on Windows, ~/Movies/CapCut/User Data on macOS. */
export const CAPCUT_USER_DATA =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? "", "CapCut", "User Data")
    : join(process.env.HOME ?? "", "Movies", "CapCut", "User Data");

/** Peak level (dBFS) of a file window, computed from decoded PCM — works on minimal ffmpeg builds without volumedetect. */
export function peakDb(file: string, from: number, dur: number): number {
  const r = spawnSync(findFfmpeg(true), ["-v", "error", "-ss", String(from), "-t", String(dur), "-i", file, "-ac", "1", "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"], { maxBuffer: 1 << 28 });
  const b = r.stdout as Buffer;
  let max = 0;
  for (let i = 0; i + 1 < b.length; i += 2) { const v = Math.abs(b.readInt16LE(i)); if (v > max) max = v; }
  return max ? 20 * Math.log10(max / 32768) : -91;
}
