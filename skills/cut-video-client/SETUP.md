# Setup

A guide for a **human** setting this up on a new machine: accounts, credentials, naming convention, checklist before running. For what the AI agent itself checks before executing, see `INSTALL_AND_TROUBLESHOOTING.md`.

## 1. Prerequisites

- Node.js 18 or newer
- FFmpeg (full/"essentials" build, not a minimal one — needs `libx264` and `volumedetect`)
- CapCut desktop installed (Windows or macOS)
- A free AssemblyAI account

## 2. Install Node dependencies

```bash
cd <skill-dir>
npm install
```

Confirm `node_modules/@remotion/renderer` exists afterward — a network interruption mid-install can leave `node_modules` present but incomplete, and `npx tsx` won't fail loudly until the pipeline actually reaches that import.

## 3. Install FFmpeg

- **Windows (winget available):** `winget install Gyan.FFmpeg`
- **Windows (no winget):** download the "essentials" build from `https://www.gyan.dev/ffmpeg/builds/`, extract it, and add its `bin` folder to your PATH (System Properties → Environment Variables → Path). Open a **new** terminal afterward — an already-open one won't see the change.
- **macOS:** `brew install ffmpeg`

Verify: `ffmpeg -version` and `ffprobe -version` both print a version string.

## 4. Get an AssemblyAI API key

1. Sign up free at `https://www.assemblyai.com/`.
2. Copy your API key from the dashboard.
3. Free tier covers roughly 5 hours of audio per month, and the same key is used for both transcription and speaker diarization — no separate signup needed for the speaker-check step.

## 5. (Optional) Get a Gemini API key

Only needed if you want a secondary fallback transcriber — the pipeline is fully functional on AssemblyAI alone, see `API_REFERENCE.md`. Skip this if `https://aistudio.google.com/app/apikey` isn't available in your region.

## 5b. (Optional) Trello access — only for batch mode

Only needed for the batch/Trello-match workflow (`reference/trello-match.md`), which matches a whole folder of unlabeled raw videos against the client's "Conteúdo" list on Trello. Skip this entirely for normal single-video runs.

- If the agent running this skill already has a Trello MCP connector available (e.g. inside Cowork), nothing to set up here — it uses that directly.
- Otherwise, get a personal API key + token at `https://trello.com/power-ups/admin` and add them to `.env` (see step 7) as `TRELLO_API_KEY` / `TRELLO_TOKEN`.

## 6. Naming convention — read before running anything

Every CapCut project this skill produces must be named:

```
REEL-XX-NOME-DO-CLIENTE
```

| Piece | Meaning | Example |
|---|---|---|
| `XX` | The reel number, from the studio's own content calendar — not auto-generated | `12` |
| `NOME-DO-CLIENTE` | The client the footage belongs to, in caps with hyphens | `JOAO-ADVOGADO` |

```
REEL-12-JOAO-ADVOGADO
```

The AI agent will ask you for both pieces if it can't infer them from context — have the reel number and client name ready before starting a run, so the conversation doesn't stall on it.

## 7. Configuration

Copy `.env.example` to `.env` in the skill directory and fill in your key(s):

```
ASSEMBLYAI_API_KEY=your-key-here
GEMINI_API_KEY=your-key-here-or-leave-blank
TRELLO_API_KEY=your-key-here-or-leave-blank
TRELLO_TOKEN=your-token-here-or-leave-blank
```

**Never commit `.env` or paste its contents into a chat with Claude** — it's already listed in `.gitignore`.

## 8. Validate before your first real run

- [ ] `ffmpeg -version` and `ffprobe -version` both work in a fresh terminal
- [ ] `node_modules/@remotion/renderer` exists
- [ ] `.env` has a real `ASSEMBLYAI_API_KEY` (not the placeholder)
- [ ] CapCut desktop has been opened at least once (creates the drafts folder)
- [ ] You know the reel number and client name for the footage you're about to cut
