/**
 * Re-stamp generated CapCut projects with the installed CapCut's own draft format.
 *
 * Symptom it fixes: projects show up in CapCut's list but won't open. This happens when they
 * were built before any CapCut-made draft existed on the machine, so they carry the builder's
 * generic Windows/9.5 stamp, or when CapCut was updated to a build that expects a newer format.
 * CapCut ≥ 9.9 on macOS also reads `draft_info.json` instead of `draft_content.json`.
 *
 *   npx tsx src/fix-draft-format.ts <project> [<project> …]
 *
 * Needs one draft created by CapCut itself in the drafts folder (open CapCut → new project →
 * close). CapCut must be closed while this runs. Each project is backed up to
 * temp/backups/<project>-<timestamp> first.
 */
import fs from "node:fs";
import path from "node:path";
import { CAPCUT_USER_DATA } from "./ffmpeg.js";

const DRAFTS = path.join(CAPCUT_USER_DATA, "Projects/com.lveditor.draft");
const TEMP = path.resolve(import.meta.dirname, "..", "temp");
const names = process.argv.slice(2);
if (!names.length) { console.error("Usage: npx tsx src/fix-draft-format.ts <project> [<project> …]"); process.exit(1); }

// newest draft made by CapCut itself = has draft_info.json and was not written by this skill
let ref: { platform: any; newVersion: string; mtime: number; name: string } | null = null;
for (const name of fs.readdirSync(DRAFTS)) {
  if (names.includes(name)) continue;
  const f = path.join(DRAFTS, name, "draft_info.json");
  if (!fs.existsSync(f)) continue;
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    if (d?.platform?.app_source !== "cc" || !d.new_version || d.platform.os === "windows" && d.platform.device_id?.startsWith("0000")) continue;
    const mtime = fs.statSync(f).mtimeMs;
    if (!ref || mtime > ref.mtime) ref = { platform: d.platform, newVersion: d.new_version, mtime, name };
  } catch { /* partial draft */ }
}
if (!ref) {
  console.error("No draft created by the installed CapCut found. Open CapCut, create one empty project, close CapCut, re-run.");
  process.exit(1);
}
console.log(`Reference: "${ref.name}" — CapCut ${ref.platform.app_version} (${ref.platform.os}), format ${ref.newVersion}`);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
for (const name of names) {
  const dir = path.join(DRAFTS, name);
  const src = ["draft_content.json", "draft_info.json"].map((f) => path.join(dir, f)).find((p) => fs.existsSync(p));
  if (!src) { console.error(`  ${name}: no draft_content.json / draft_info.json — skipped`); continue; }
  fs.mkdirSync(path.join(TEMP, "backups"), { recursive: true });
  fs.cpSync(dir, path.join(TEMP, "backups", `${name}-${ts}`), { recursive: true });

  const d = JSON.parse(fs.readFileSync(src, "utf8"));
  d.platform = { ...ref.platform };
  d.last_modified_platform = { ...ref.platform };
  d.new_version = ref.newVersion;
  d.materials.ai_generate_holders ??= [];
  const json = JSON.stringify(d);
  for (const f of ["draft_content.json", "draft_info.json"]) fs.writeFileSync(path.join(dir, f), json);

  const proj = JSON.parse(fs.readFileSync(path.join(dir, "Timelines", "project.json"), "utf8"));
  const tl = path.join(dir, "Timelines", proj.main_timeline_id);
  fs.mkdirSync(tl, { recursive: true });
  for (const f of ["draft_content.json", "draft_info.json"]) fs.writeFileSync(path.join(tl, f), json);

  // auxiliary default files CapCut 9.9 writes for every draft (no project data in them) —
  // copied from the reference draft when missing. draft_agency_config.json is skipped: it holds a user session.
  const refDir = path.join(DRAFTS, ref.name);
  const refTl = path.join(refDir, "Timelines", JSON.parse(fs.readFileSync(path.join(refDir, "Timelines", "project.json"), "utf8")).main_timeline_id);
  const copyIfMissing = (from: string, to: string) => {
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
  };
  for (const f of ["attachment_pc_common.json", "performance_opt_info.json"]) copyIfMissing(path.join(refDir, f), path.join(dir, f));
  for (const f of ["attachment_pc_common.json", "attachment_editing.json", "common_attachment"]) copyIfMissing(path.join(refTl, f), path.join(tl, f));

  const settings = path.join(dir, "draft_settings");
  if (fs.existsSync(settings)) {
    fs.writeFileSync(settings, fs.readFileSync(settings, "utf8").replace(/cloud_last_modify_platform=\w+/, `cloud_last_modify_platform=${ref.platform.os}`));
  }
  console.log(`  ${name}: re-stamped (${ref.platform.app_version}/${ref.newVersion}), draft_info.json written`);
}
