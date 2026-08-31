# monatela-skills

AI agent skills built for real production workflows. Each skill lives in its own folder under `skills/`, fully self-contained (its own `SKILL.md`, docs, and source), so any one of them can be installed, updated, or handed to another framework independently of the rest.

## Skills

| Skill | Created by | What it does | Folder |
|---|---|---|---|
| `client-content-approval` | Monatela Communication | Uploads a finished content piece (carousel, reel, static post) to the right client folder in Google Drive and prepares the matching Trello card for client approval — without ever mixing up files or cards between clients. | [`skills/client-content-approval/`](skills/client-content-approval/) |
| `cut-video-client` | Igniting Studios | Turns raw client video footage into a ready-to-open CapCut project — silences and repeated takes removed, only the on-camera speaker's audio kept (verified, not assumed), hook text overlay added, project named to a `REEL-XX-NOME-DO-CLIENTE` convention. | [`skills/cut-video-client/`](skills/cut-video-client/) |

More skills get added here over time, each following the same internal layout — see "Adding a new skill" below.

## Repository layout

```
.
├── README.md                 ← you are here
├── .gitignore                ← shared patterns (node_modules, .env, temp/, raw media, IDE junk)
└── skills/
    └── <skill-name>/
        ├── README.md          ← skill-specific overview, files table, install instructions
        ├── SKILL.md           ← router: named rules, mode, steps table pointing into reference/
        ├── reference/         ← one file per step, loaded on demand
        ├── WORKFLOW.md        ← the same process as framework-agnostic pseudocode
        ├── API_REFERENCE.md   ← real endpoints/CLI commands behind each step
        ├── SETUP.md           ← human setup guide (accounts, credentials, checklist)
        ├── INSTALL_AND_TROUBLESHOOTING.md  ← agent pre-flight checklist + known-error table
        └── (src/, package.json, etc. — whatever runtime that particular skill needs, if any)
```

Every skill folder is meant to be readable on its own — start at its `README.md`, not this one, once you know which skill you're working with.

## Installing a skill in Claude

Each skill's own `README.md` has the exact steps, but in short, there are two paths:

1. **Claude account skill** — consolidate that skill's `SKILL.md` + everything under its `reference/` into a single file (the account-level skill review card doesn't support sub-files), save it through the review card, call it with `/skill-name`.
2. **Claude Code project skill** — copy the whole skill folder to `<some-repo>/.claude/skills/<skill-name>/`, sub-files and all. Claude Code reads `SKILL.md` and follows its relative links to `reference/*.md` on demand.

## Adding a new skill

1. Create `skills/<new-skill-name>/`.
2. Follow the same internal layout as the existing skills — `SKILL.md` as a short router, one `reference/*.md` per step, `WORKFLOW.md` + `API_REFERENCE.md` for a framework-agnostic version, `SETUP.md` + `INSTALL_AND_TROUBLESHOOTING.md` for the human/agent split.
3. Add a row to the table at the top of this file.
4. Keep secrets (`.env`), generated artifacts (`temp/`, `node_modules/`), and raw client media out of git — the root `.gitignore` already covers the common patterns at any depth; extend it here rather than adding a per-skill `.gitignore` if a new pattern comes up.
