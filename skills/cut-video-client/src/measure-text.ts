/**
 * Measure the rendered width of text in a font (ink bounding box), by drawing it with ffmpeg.
 * Used to lay out the highlighted titles so the small lines hug the big word like the editor's preset.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SIZE = 200; // render size in px — widths are returned relative to this

const cache = new Map<string, number>();

export interface PlacedText { text: string; font: string; size: number; cx: number; cy: number }

/**
 * Ink mask of each text drawn alone at its place on a W×H canvas (drawtext centring, same as CapCut's
 * text boxes closely enough to detect letters touching). Returns one gray buffer per text.
 */
export function inkMasks(items: PlacedText[], W: number, H: number): Buffer[] {
  return items.map((it) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mask-"));
    const textFile = path.join(tmp, "t.txt");
    fs.writeFileSync(textFile, it.text, "utf-8");
    const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
    const raw = execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", `color=black:s=${W}x${H}:d=0.04`,
      "-vf", `drawtext=fontfile='${esc(it.font)}':textfile='${esc(textFile)}':expansion=none:fontsize=${Math.round(it.size)}:fontcolor=white:x=${Math.round(it.cx)}-text_w/2:y=${Math.round(it.cy)}-text_h/2`,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ], { maxBuffer: W * H * 2 });
    fs.rmSync(tmp, { recursive: true, force: true });
    return raw;
  });
}

/** Smallest upward shift (px) of mask `a` so its ink no longer touches mask `b`, keeping `gap` px clear. */
export function clearShift(a: Buffer, b: Buffer, W: number, H: number, direction: -1 | 1, gap = 4, max = 120): number {
  const ink = (m: Buffer, x: number, y: number) => y >= 0 && y < H && m[y * W + x] > 60;
  const touches = (d: number) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!ink(a, x, y)) continue;
      const ty = y + direction * d; // where this pixel of `a` lands after the shift
      for (let g = -gap; g <= gap; g++) if (ink(b, x, ty + g)) return true;
    }
    return false;
  };
  if (!touches(0)) return 0;
  for (let d = 2; d <= max; d += 2) if (!touches(d)) return d;
  return max;
}

/** Ink width of `text` in `fontFile`, in pixels at a 200 px font size. */
export function inkWidth(text: string, fontFile: string): number {
  const key = `${fontFile}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "measure-"));
  const textFile = path.join(tmp, "t.txt");
  fs.writeFileSync(textFile, text, "utf-8");
  const W = Math.max(400, text.length * SIZE), H = SIZE * 2;
  const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
  const raw = execFileSync("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", `color=black:s=${W}x${H}:d=0.04`,
    // expansion=none: draw "%" literally (it starts a text expansion otherwise)
    "-vf", `drawtext=fontfile='${esc(fontFile)}':textfile='${esc(textFile)}':expansion=none:fontsize=${SIZE}:fontcolor=white:x=${SIZE / 2}:y=${SIZE / 2}`,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
  ], { maxBuffer: W * H * 2 });
  fs.rmSync(tmp, { recursive: true, force: true });
  let left = W, right = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (raw[y * W + x] > 60) { if (x < left) left = x; if (x > right) right = x; }
    }
  }
  const width = right >= left ? right - left + 1 : 0;
  cache.set(key, width);
  return width;
}
