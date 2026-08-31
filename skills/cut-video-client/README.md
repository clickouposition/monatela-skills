# Skill: cut-video-client (CapCut + AssemblyAI)

**Created by:** Igniting Studios.

**Purpose:** remove the manual, repetitive part of turning raw client video footage into a ready-to-open CapCut project, and make sure the wrong person's voice — a director, an assistant, whoever else was in the room — never ends up in the final cut by mistake.

**What it does:** takes a raw video (with multiple takes, false starts, and off-camera chatter), normalizes it, transcribes it word-by-word, identifies which voice belongs to the person actually on camera, compares the transcript against the client's script when one is given, removes everything that isn't a clean on-camera take, adds a hook text overlay, and writes a CapCut project named to the studio's `REEL-XX-NOME-DO-CLIENTE` convention.

**Skill name:** `cut-video-client`. Once saved to your Claude account, call it in any chat (including a new one) by typing `/cut-video-client`.

## Files in this package

| File | What it is for |
|---|---|
| `SKILL.md` + `reference/*.md` | The automation written as AI agent instructions, structured as a **router**: `SKILL.md` is short (named rules, mode, steps table), and each step has its own file in `reference/`, loaded only when that step is running. Use this if you are running it through Claude Code, or as an architecture reference for another framework. |
| `WORKFLOW.md` | The same process described as a framework-agnostic algorithm/pseudocode. Use it as a base if you are implementing this in another tool, language, or agent. |
| `API_REFERENCE.md` | The real FFmpeg commands and AssemblyAI (REST) endpoints that cover the whole flow, plus notes on the CapCut project file format the pipeline writes directly. |
| `SETUP.md` | A configuration guide for a brand new machine, meant for a **human** to follow: accounts, credentials, naming convention, checklist before running. |
| `INSTALL_AND_TROUBLESHOOTING.md` | A guide for the **AI agent** to read before executing: a pre-flight checklist (what to check before running) plus an error-to-cause-to-fix table with the real problems found while building this, so the agent already knows the fix without having to investigate from scratch. |
| `src/*.ts` | The actual pipeline scripts (`roughcut.ts` orchestrates `analyze`/`build`, `diarize-speakers.ts` does the on-camera speaker check). Called via `npx tsx`, not imported as a library. |

## Where to start on a new machine

1. A human reads `SETUP.md` and configures the credentials/naming convention.
2. Before running, the AI agent reads `INSTALL_AND_TROUBLESHOOTING.md` (pre-flight checklist plus known-error map).
3. If using an AI agent (Claude, or another one with tool-use capability): give it `SKILL.md` (with its `reference/` files) and `API_REFERENCE.md` as context.
4. If implementing as a direct script/bot instead of an agent: follow `WORKFLOW.md`, calling the FFmpeg commands and AssemblyAI endpoints from `API_REFERENCE.md` directly.

## Two ways to "install" this in Claude specifically

### 1. As a Claude account skill

Saved through the review screen (the proposal card) so it runs inside Claude/Cowork conversations, called with `/cut-video-client`.

**Important difference:** that review screen only accepts a single `SKILL.md`, with no sub-files. The version saved to a Claude account this way must be a **consolidated** version — same content (named rules, steps, everything currently split into `reference/*.md`), just merged into one file. The split version in this repository is the full architecture, meant for places where sub-files are supported (see item 2 below). To produce the consolidated version, paste `SKILL.md` plus the contents of every file it links to under `reference/`, in step order, into a single document, then save that through the review card.

Editing the files in this repository does **not** change the actual skill on your account. To update it, ask for the change in a conversation with Claude and save it again through the review card.

### 2. As a Claude Code project skill (if using Claude Code/CLI in a repository)

Claude Code reads the `SKILL.md` of a skill directory and follows the relative links it contains (the ones in the steps table pointing to `reference/*.md`), reading each one on demand when that step starts running. That's why the split structure works fully here, unlike item 1.

It automatically recognizes skills at:

```
<repo-root>/.claude/skills/cut-video-client/SKILL.md
```

Copy this entire folder — `SKILL.md`, the `reference/` subfolder, `src/`, `package.json`, `.env.example` — to that path and commit it (excluding your own `.env` and `temp/`, both already gitignored). In that case, the files themselves become the actual source Claude Code uses in that project, and the pipeline scripts run directly out of that same directory.

## Important note about this implementation

`SKILL.md` and `WORKFLOW.md` describe the same pipeline from two different angles, not two different versions of it — there's no browser-automation fallback here like in other skills in this family, because every dependency (FFmpeg, AssemblyAI) already has a real, direct API. If you're implementing this from scratch in another framework, `WORKFLOW.md` plus `API_REFERENCE.md` is the complete, minimal spec; `SKILL.md` is the same thing shaped for an agent that reads instructions and calls a CLI.
