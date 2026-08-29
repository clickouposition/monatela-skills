# Skill: client-content-approval (Drive + Trello)

**Created by:** Monatela Communication.

**Purpose:** remove the manual, repetitive part of getting a finished content piece in front of a client for approval, and make sure files or cards from different clients never get mixed up in the process.

**What it does:** takes a finished piece of content (carousel, reel, or static post) sitting in a client's local folder, uploads it to the right monthly folder inside that client's Google Drive folder, finds the matching card on that client's Trello board, attaches the Drive link to it (renamed to the content folder's name), and moves the card into the "With Client" list in the right position, ready for the client to review and approve.

**Skill name:** `client-content-approval`. Once saved to your Claude account, call it in any chat (including a new one) by typing `/client-content-approval`.

## Files in this package

| File | What it is for |
|---|---|
| `SKILL.md` + `reference/*.md` | The automation written as AI agent instructions, structured as a **router**: `SKILL.md` is short (named rules, mode, steps table), and each step has its own file in `reference/`, loaded only when that step is running. Use this if you are running it through Claude Code, or as an architecture reference for another framework. |
| `WORKFLOW.md` | The same process described as a framework-agnostic algorithm/pseudocode. Use it as a base if you are implementing this in another tool, language, or agent. |
| `API_REFERENCE.md` | The real Google Drive and Trello (REST) endpoints that cover 100% of the flow natively, with no need for browser automation. |
| `SETUP.md` | A configuration guide for a brand new machine, meant for a **human** to follow: accounts, credentials, naming convention, checklist before running. |
| `INSTALL_AND_TROUBLESHOOTING.md` | A guide for the **AI agent** to read before executing: a pre-flight checklist (what to check/install before running) plus an error-to-cause-to-fix table with the real problems found while building this, so the agent already knows the fix without having to investigate from scratch. |

## Where to start on a new machine

1. A human reads `SETUP.md` and configures the credentials/conventions.
2. Before running, the AI agent reads `INSTALL_AND_TROUBLESHOOTING.md` (pre-flight checklist plus known-error map).
3. If using an AI agent (Claude, or another one with tool-use capability): give it `SKILL.md` (or adapt it to your framework's skill/tool format) and `API_REFERENCE.md` as context.
4. If implementing as a direct script/bot: follow `WORKFLOW.md`, calling the endpoints from `API_REFERENCE.md`.

## Two ways to "install" this in Claude specifically

### 1. As a Claude account skill (what is already active today)

The skill that runs inside Claude/Cowork conversations (called with `/client-content-approval`) was saved through the review screen (the proposal card). It lives on the Claude account, not in this repository.

**Important difference:** that review screen only accepts a single `SKILL.md`, with no sub-files. That is why the version saved on your Claude account is a **consolidated** version (same content: named rules, steps, and verification, just in one file, without the split into `reference/`). The version split into `reference/*.md` in this repository is the full architecture, meant for places where sub-files are supported (see item 2 below).

Editing the files here does **not** change the actual skill on your account. To update it, ask for the change in a conversation with Claude and save it again through the review card.

### 2. As a Claude Code project skill (if using Claude Code/CLI in a repository)

Claude Code reads the `SKILL.md` of a skill directory and follows the relative links it contains (like the ones in the steps table pointing to `reference/*.md`), reading each one on demand when that step starts running. That is why the split structure works fully here, unlike item 1.

It automatically recognizes skills at:

```
<repo-root>/.claude/skills/client-content-approval/SKILL.md
```

Copy this entire folder (including the `reference/` subfolder) to that path and commit it. In that case, the files themselves become the actual source Claude Code uses in that project.

## Important note about the two implementation modes

- **`SKILL.md`** documents the version that ran inside an agent session with limited tools (no direct binary upload to Drive, no attachment/comment endpoint in Trello, no numeric position exposed on cards). That is why it uses browser automation and a repositioning trick.
- **`WORKFLOW.md` + `API_REFERENCE.md`** document the recommended approach for a new implementation: calling the Drive and Trello REST APIs directly, with none of those workarounds.

If you are building this from scratch for another framework, start with `WORKFLOW.md`. It is simpler and more robust than replicating the browser automation.
