---
name: vocal-assistent
description: Install and configure VOCAL-ASSISTENT on a Mac — a customized Handy (open-source voice dictation) with one shortcut (Option+Space) that transcribes Portuguese or English, fixes it, and translates on request ("traduza para o inglês/português"), all local via Whisper + Ollama/Gemma. Use when someone asks to install, set up, update, or troubleshoot this dictation setup.
---

# VOCAL-ASSISTENT: install skill

Goal: leave the person's Mac with Handy working exactly like the reference setup, then hand over the two steps only a human can do.

## Rules

1. **macOS + Apple Silicon only.** On Windows/Linux or an Intel Mac, stop and say it is not supported yet.
2. **Never type passwords, API keys or approve system prompts.** Accessibility, Microphone and the Command Line Tools dialog are the person's to click.
3. **Do not change the AI provider or add API keys** unless the person asks.
4. **Downloads only from official sources** (already hard-coded in the script: rustup.rs, bun.sh, PyPI cmake, Ollama GitHub releases with signature check, cjpais/Handy, blob.handy.computer with SHA-256 check).
5. If an existing Handy is installed, the script moves it to the Trash and backs up its settings. Tell the person before running.

## Steps

| # | Do | Check |
|---|---|---|
| 1 | Confirm Mac with Apple Silicon, ~20 GB free; 16 GB RAM recommended | `uname -m` = `arm64` |
| 2 | From this folder run `bash install-macos.sh` (15–30 min; run it in the background and wait for it) | Ends with "Pronto!" |
| 3 | If it stops asking for **Command Line Tools**: ask the person to click *Install* in the macOS dialog, then run step 2 again | `xcode-select -p` succeeds |
| 4 | Ask the person to enable **Handy** in *System Settings → Privacy & Security → Accessibility* (add `/Applications/Handy.app` with **+** if missing) | `grep "Shortcuts initialized successfully" ~/Library/Logs/com.pais.handy/handy.log` |
| 5 | If shortcuts still are not registered after enabling, restart Handy: `osascript -e 'tell application id "com.pais.handy" to quit'; sleep 3; open /Applications/Handy.app` | Same log line, newer timestamp |
| 6 | Ask the person to dictate once with **Option+Space** and click *Allow* on the Microphone prompt | Log shows `Text pasted successfully` |

## Usage to explain to the person

- **Option+Space**: hold, speak, release (or tap, speak, tap again). Works in any app.
- Start with **"Traduza para o inglês"** / **"Traduza para o português"** / **"Traduz"** to translate; otherwise it just cleans up in the spoken language.
- Say **"formal"** for a formal tone. **Esc** cancels.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Pasted old clipboard text | Raise `paste_delay_after_ms` in `profile.json`, rerun the script |
| Text pasted without correction | Ollama not running: `open -g /Applications/Ollama.app`; check `curl localhost:11434/api/version` |
| Shortcut does nothing | Accessibility off, or `SecureInput` in the log (a password field or Terminal "Secure Keyboard Entry" is active) |
| Build fails with `cmake not installed` | Rerun the script (it installs CMake into `~/.local/cmake-venv`) |
| Build fails with stale paths after moving the folder | `rm -rf <handy-source>/src-tauri/target` and rerun |
| "Apple Intelligence ... stubs" warning | Expected without full Xcode; this setup uses Ollama instead |

Details on what was changed and why: [README.md](README.md).
