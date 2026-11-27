/**
 * auto-grade — per-video colour correction values for CapCut's basic adjustments, measured from
 * the frames the edit actually uses. Goal: neutral white balance for Rec.709, skin that keeps its
 * own tone (never pale, never pushed orange), no blown highlights.
 *
 *   npx tsx src/auto-grade.ts <video-basename> <eyeX> <eyeY>     # prints the measurement + grade
 *   style-edit … --grade=auto                                    # same thing inside the edit
 *
 * What is measured (12 frames spread over the kept clips, 270×480):
 *   - neutrals: low-saturation mid-tone pixels (wall, posters, white/grey objects) → colour cast
 *   - skin: YCbCr skin pixels in a box under the eye line → hue, saturation, luma
 *   - exposure: luma p50 / p99 and the share of clipped pixels
 * Rules (CapCut value = slider ÷ 50; every correction is partial and capped, so a bad
 * measurement can't wreck the picture):
 *   - tone (tint): removes the green↔magenta cast of the neutrals
 *   - temperature: removes the blue↔amber cast of the neutrals, nudged so skin hue lands in
 *     the Rec.709 skin band (~18–24°) instead of going pale-pink or orange
 *   - brightness: only when skin luma is clearly off 0.45–0.58, at most ±3 on the slider
 *   - white / highlight: only pulled down if highlights clip; never pushed up
 *   - saturation: a light lift only when skin saturation is under 0.36 (pale), never over +4
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findFfmpeg } from "./ffmpeg.js";

const W = 270, H = 480;
export interface GradeReport {
  neutralRGB: number[]; skinRGB: number[]; skinHue: number; skinSat: number; skinLuma: number;
  p50: number; p99: number; clipPct: number; values: [string, number][];
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const r2 = (x: number) => Math.round(x * 100) / 100; // CapCut sliders move in steps of 1 (= 0.02)
const hueOf = ([r, g, b]: number[]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1e-6;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const satOf = ([r, g, b]: number[]) => (Math.max(r, g, b) - Math.min(r, g, b)) / (Math.max(r, g, b) || 1);
const lumaOf = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function autoGrade(video: string, eyeX: number, eyeY: number, times: number[]): GradeReport {
  const cx = ((eyeX + 1) / 2) * W, cy = ((1 - eyeY) / 2) * H;
  const skin: number[][] = [], neu: number[][] = [], lum: number[] = [];
  let clip = 0;
  for (const t of times) {
    const b = execFileSync(findFfmpeg(true), ["-v", "error", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1",
      "-vf", `scale=${W}:${H}`, "-f", "image2pipe", "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-"], { maxBuffer: 1 << 24 });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3, p = [b[i] / 255, b[i + 1] / 255, b[i + 2] / 255];
      const L = lumaOf(p); lum.push(L);
      if (Math.max(...p) > 0.98) clip++;
      const [r, g, bl] = p;
      const Y = 0.299 * r + 0.587 * g + 0.114 * bl;
      const Cb = 128 + (-0.169 * r - 0.331 * g + 0.5 * bl) * 255, Cr = 128 + (0.5 * r - 0.419 * g - 0.081 * bl) * 255;
      if (Math.abs(x - cx) < W * 0.12 && y > cy - H * 0.03 && y < cy + H * 0.09 && Cb > 77 && Cb < 127 && Cr > 135 && Cr < 175 && Y > 0.15) skin.push(p);
      else if (satOf(p) < 0.12 && L > 0.2 && L < 0.9) neu.push(p);
    }
  }
  const med = (a: number[][], k: number) => { const s = a.map((p) => p[k]).sort((x, y) => x - y); return s[s.length >> 1] ?? 0; };
  const sk = [0, 1, 2].map((k) => med(skin, k)), ne = [0, 1, 2].map((k) => med(neu, k));
  lum.sort((a, b) => a - b);
  const p50 = lum[lum.length >> 1], p99 = lum[Math.floor(lum.length * 0.99)], clipPct = (100 * clip) / lum.length;
  const skinHue = hueOf(sk), skinSat = satOf(sk), skinLuma = lumaOf(sk);

  const values: [string, number][] = [];
  const add = (k: string, v: number) => { const x = r2(v); if (Math.abs(x) >= 0.02) values.push([k, x]); };
  if (neu.length > 500) {
    const g = ne[1] || 1e-6;
    const magenta = ((ne[0] + ne[2]) / 2 - g) / g; // + = magenta cast, − = green
    const blue = (ne[2] - ne[0]) / g;              // + = cool cast, − = warm
    // fix ~⅔ of the measured cast; skin then tells whether to lean warmer or cooler
    let tone = clamp(-magenta * 1.6, -0.3, 0.3);
    let temp = clamp(blue * 1.5, -0.16, 0.16);
    if (skin.length > 500) {
      if (skinHue < 14) temp += 0.04;      // pink/pale skin: a touch warmer
      else if (skinHue > 26) temp -= 0.04; // orange skin: a touch cooler
    }
    add("tone", tone); add("temperature", clamp(temp, -0.16, 0.16));
  }
  if (skin.length > 500) {
    if (skinLuma < 0.45) add("brightness", clamp((0.5 - skinLuma) * 0.5, 0, 0.06));
    else if (skinLuma > 0.58) add("brightness", clamp((0.52 - skinLuma) * 0.5, -0.06, 0));
    if (skinSat < 0.36) add("saturation", clamp((0.38 - skinSat) * 1.5, 0.02, 0.08));
  }
  if (clipPct > 0.5) add("highlight", -clamp(clipPct / 10, 0.04, 0.2));
  return { neutralRGB: ne.map(r2), skinRGB: sk.map(r2), skinHue: +skinHue.toFixed(1), skinSat: r2(skinSat), skinLuma: r2(skinLuma), p50: r2(p50), p99: r2(p99), clipPct: r2(clipPct), values };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [v, ex, ey] = process.argv.slice(2);
  if (!v) { console.error("Usage: npx tsx src/auto-grade.ts <video-basename> <eyeX> <eyeY>"); process.exit(1); }
  const file = path.resolve(import.meta.dirname, "..", "temp", `normalized-${v}.mp4`);
  const dur = 40; // without the edit's clip list, sample the first 40 s evenly
  const times = Array.from({ length: 12 }, (_, i) => 2 + (i * dur) / 12);
  console.log(JSON.stringify(autoGrade(file, parseFloat(ex), parseFloat(ey), times), null, 1));
}
