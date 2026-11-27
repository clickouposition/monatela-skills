/**
 * Swap the caption font of an existing CapCut project in place — every text material — without
 * touching anything else the editor changed. Used when a project was built with --font-pending
 * (CapCut's default font) and the client font arrived later.
 *
 *   npx tsx src/set-caption-font.ts <project> --client=<CLIENT>
 *
 * CapCut must be closed. The project is backed up to temp/backups/<project>-<timestamp> first.
 */
import fs from "node:fs";
import path from "node:path";
import { CAPCUT_USER_DATA } from "./ffmpeg.js";
import { loadProfile, resolveFont } from "./client-profile.js";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const client = args.find((a) => a.startsWith("--client="))?.slice(9);
if (!name || !client) { console.error("Usage: npx tsx src/set-caption-font.ts <project> --client=<CLIENT>"); process.exit(1); }
const profile = loadProfile(client);
const FONT = resolveFont(profile);
if (!FONT) { console.error(`${profile.captions.font} not found — copy it into the studio FONTES folder first.`); process.exit(1); }

const dir = path.join(CAPCUT_USER_DATA, "Projects/com.lveditor.draft", name);
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.resolve(import.meta.dirname, "..", "temp", "backups", `${name}-${ts}`);
fs.cpSync(dir, backup, { recursive: true });

const proj = JSON.parse(fs.readFileSync(path.join(dir, "Timelines", "project.json"), "utf8"));
const tl = path.join(dir, "Timelines", proj.main_timeline_id);
const src = fs.existsSync(path.join(dir, "draft_info.json")) ? path.join(dir, "draft_info.json") : path.join(dir, "draft_content.json");
const d = JSON.parse(fs.readFileSync(src, "utf8"));
let n = 0;
const fontName = path.basename(FONT, path.extname(FONT));
for (const m of d.materials.texts ?? []) {
  const c = JSON.parse(m.content);
  for (const st of c.styles ?? []) st.font = { id: "", path: FONT };
  m.content = JSON.stringify(c);
  Object.assign(m, { font_path: FONT, font_name: fontName, font_title: profile.captions.font, font_id: "", font_resource_id: "",
    font_third_resource_id: "", font_category_id: "", font_category_name: "", font_url: "", font_source_platform: 0, fonts: [] });
  n++;
}
const json = JSON.stringify(d);
for (const f of ["draft_info.json", "draft_content.json", "draft_info.json.bak"]) {
  for (const base of [dir, tl]) if (f !== "draft_info.json.bak" || fs.existsSync(path.join(base, f))) fs.writeFileSync(path.join(base, f), json);
}
console.log(`${name}: ${n} captions → ${profile.captions.font} (${FONT}). Backup: ${backup}`);
