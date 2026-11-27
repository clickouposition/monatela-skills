/**
 * Client style profiles — clients/<CLIENT>.json — and the pre-flight check that
 * every asset a profile needs (font, flash clip, SFX, ffmpeg) is present on THIS
 * machine before an edit is written.
 *
 *   npx tsx src/client-profile.ts <CLIENT>      # prints the resolved profile + check
 *
 * Exit code 1 when anything is missing, with the exact fix for each item.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFfmpeg, findFfprobe } from "./ffmpeg.js";

export interface ClientProfile {
  client: string;
  /** CapCut project naming, e.g. "REEL-XX-FRANCIS-DHIENE-ADVOGADA". */
  projectPattern: string;
  trelloBoard?: string;
  captions: {
    /** Human font name as shown in CapCut ("Candara Light"). */
    font: string;
    /** File names to look for, in order (Windows/Mac/vendor spellings differ). */
    fontFiles: string[];
    size: number;
    /** CapCut "Caractere" slider value. */
    letterSpacing: number;
    color: string;
    case: "lower" | "upper" | "as-spoken";
    stripPunctuation: boolean;
    wordsPerCaption: number;
    /** CapCut canvas units, −1 (bottom) … 1 (top). */
    y: number;
    shadow: { opacity: number; blur: number; distance: number; angle: number; color: string };
  };
  zoom: { punch: number; splitClipsLongerThanSec: number };
  /** Transition clip over the cut nearest ⅓ and ⅔. Only `file` is required (white flash: whole clip, 2 frames before the cut). */
  flash: {
    file: string; count: "auto";
    /** In-point inside the clip, s. */ srcStart?: number;
    /** Length on the timeline, frames at 30 fps (default: rest of the clip). */ frames?: number;
    /** Frames the clip starts before the cut (default 2). */ leadFrames?: number;
    /** CapCut scale (a 16:9 clip needs > 3.16 to cover the 9:16 canvas). */ scale?: number;
    /** Clip's own audio, linear (default 0 = muted). */ volume?: number;
    /** CapCut track flag copied from the editor's project (default 0). */ trackFlag?: number;
  };
  /** CapCut volume slider (dB) for every SFX clip. */
  sfx: { volumeDb: number };
  /** CapCut volume slider (dB) for the voice track. */
  voice?: { volumeDb: number };
}

const SKILL_DIR = path.resolve(import.meta.dirname, "..");
const HOME = os.homedir();
/** Studio asset root: SX/, TRANSICTIONS/, FONTES/ live here. */
export const STUDIO_DIR = process.env.MONATELA_DIR ?? path.join(HOME, "Desktop", "MONATELA");

export function loadProfile(client: string): ClientProfile {
  const file = path.join(SKILL_DIR, "clients", `${client}.json`);
  if (!fs.existsSync(file)) {
    const known = fs.readdirSync(path.join(SKILL_DIR, "clients")).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => f.slice(0, -5));
    throw new Error(
      `No profile for "${client}" on this machine (clients/${client}.json). First edit for this client here: ` +
      `copy clients/_TEMPLATE.json to clients/${client}.json and fill in the client's identity (font, size, spacing, colour, shadow) — ` +
      `profiles are local, never committed. Profiles on this machine: ${known.join(", ") || "none"}. See clients/README.md.`);
  }
  const p: ClientProfile = JSON.parse(fs.readFileSync(file, "utf8"));
  if (p.client === "NOME-DO-CLIENTE" || p.captions.fontFiles.includes("ArquivoDaFonte.ttf"))
    throw new Error(`clients/${client}.json still has the template placeholders — fill in the real values first.`);
  return p;
}

/** Folders searched for fonts, studio folder first. */
export function fontDirs(): string[] {
  const dirs = [process.env.MONATELA_FONTS_DIR ?? path.join(STUDIO_DIR, "FONTES")];
  if (process.platform === "darwin") {
    dirs.push(path.join(HOME, "Library/Fonts"), "/Library/Fonts", "/System/Library/Fonts", "/System/Library/Fonts/Supplemental");
    // Microsoft Office for Mac ships Candara & co. inside the app bundles
    for (const app of ["Microsoft Word", "Microsoft PowerPoint", "Microsoft Excel", "Microsoft Outlook"]) dirs.push(`/Applications/${app}.app/Contents/Resources/DFonts`);
  }
  else if (process.platform === "win32") dirs.push(path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts"), path.join(process.env.LOCALAPPDATA ?? "", "Microsoft/Windows/Fonts"));
  else dirs.push(path.join(HOME, ".fonts"), path.join(HOME, ".local/share/fonts"), "/usr/share/fonts");
  return dirs.filter((d) => fs.existsSync(d));
}

/** Absolute path of the caption font, or null. Case-insensitive file-name match, one level of subfolders. */
export function resolveFont(p: ClientProfile): string | null {
  const wanted = p.captions.fontFiles.map((f) => f.toLowerCase());
  for (const dir of fontDirs()) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [
      ...entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name)),
      ...entries.filter((e) => e.isDirectory()).flatMap((e) => {
        try { return fs.readdirSync(path.join(dir, e.name)).map((f) => path.join(dir, e.name, f)); } catch { return []; }
      }),
    ];
    for (const w of wanted) {
      const hit = files.find((f) => path.basename(f).toLowerCase() === w);
      if (hit) return hit;
    }
  }
  return null;
}

export const resolveStudioPath = (rel: string) => (path.isAbsolute(rel) ? rel : path.join(STUDIO_DIR, rel));

export interface CheckItem { ok: boolean; what: string; detail: string }

export function checkProfile(p: ClientProfile, sfxFiles: string[] = []): CheckItem[] {
  const items: CheckItem[] = [];
  const font = resolveFont(p);
  items.push(font
    ? { ok: true, what: "caption font", detail: `${p.captions.font} → ${font}` }
    : { ok: false, what: "caption font", detail: `${p.captions.font} not found (looked for ${p.captions.fontFiles.join(" / ")} in ${fontDirs().join(", ")}). Copy the font file into ${path.join(STUDIO_DIR, "FONTES")} — CapCut needs the file itself, a font name alone renders as the default font.` });
  const flash = resolveStudioPath(p.flash.file);
  items.push({ ok: fs.existsSync(flash), what: "flash clip", detail: fs.existsSync(flash) ? flash : `${flash} missing — copy the studio TRANSICTIONS folder to ${STUDIO_DIR}` });
  const sfxDir = process.env.MONATELA_SFX_DIR ?? path.join(STUDIO_DIR, "SX");
  const missing = sfxFiles.filter((f) => !fs.existsSync(path.join(sfxDir, f)));
  items.push({ ok: missing.length === 0, what: "SFX", detail: missing.length ? `missing in ${sfxDir}: ${missing.join(" | ")}` : `${sfxFiles.length} files in ${sfxDir}` });
  try { items.push({ ok: true, what: "ffmpeg/ffprobe", detail: `${findFfmpeg(true)} / ${findFfprobe(true)}` }); }
  catch (e) { items.push({ ok: false, what: "ffmpeg/ffprobe", detail: (e as Error).message }); }
  return items;
}

export function printCheck(items: CheckItem[]): boolean {
  for (const i of items) console.log(`  ${i.ok ? "OK  " : "MISSING"}  ${i.what}: ${i.detail}`);
  return items.every((i) => i.ok);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const client = process.argv[2];
  if (!client) { console.error("Usage: npx tsx src/client-profile.ts <CLIENT>"); process.exit(1); }
  const p = loadProfile(client);
  const { SFX_FILES } = await import("./style-edit-sfx.js");
  console.log(`Profile ${p.client}:`);
  process.exit(printCheck(checkProfile(p, Object.values(SFX_FILES))) ? 0 : 1);
}
