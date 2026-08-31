# Step 1 (default) — Match raw footage to the Trello content queue

This is the **default** Step 1 — use it whether the user hands over one video or a whole folder downloaded from Drive into `Downloads`. Filenames almost never map to a script or reel number on their own, so don't ask the user to eyeball a folder and guess — read the footage, then read Trello, then match the two. Use [find-and-name.md](find-and-name.md) instead only when the user already told you which script/reel this exact footage belongs to, or Trello isn't reachable at all (see SKILL.md's Step 1 rule).

## Named rule this step adds

**The Trello Match Confidence Rule.** A video's REEL number and client are never assigned from a weak, partial, or "best of a bad bunch" text match. A clear leading match gets proposed to the user for a quick confirm (per the existing Confirm Before Building Rule); anything ambiguous — close scores between two+ cards, or no candidate that plausibly overlaps — means STOP and ask, quoting the video's transcript excerpt next to each candidate card's script excerpt so the user can eyeball it. Misfiling a video under the wrong client/reel is exactly the failure the naming convention exists to prevent (see [find-and-name.md](find-and-name.md)), and it's a worse mistake here than in the single-video flow because nothing else will catch it before `build` writes a CapCut project under the wrong name.

## 1. Identify the client board (once per batch, not per video)

Ask the user which client's board this batch belongs to, unless it's already unambiguous from the conversation. The studio's boards follow the pattern `<CLIENTE> | LINHA EDITORIAL`; the content queue lives in a list called **Conteúdo** on that board. Don't guess the board from filenames or folder names alone — confirm it, the same way [find-and-name.md](find-and-name.md) insists on confirming the client name.

## 2. Pull the content queue

Read every card in the client board's **Conteúdo** list. For each card, capture:

- `name` — usually contains or implies the REEL number (e.g. "REEL 12", "REEL-12")
- `desc` — the roteiro/script text
- any checklist items — sometimes the script is split into lines here instead of the description

If a Trello MCP connector is available in the current environment, use it directly (list the board's lists, then the Conteúdo list's cards). If not (e.g. running inside a plain local Claude Code session with no Trello connector configured), fall back to the Trello REST API with a personal API key + token:

```bash
curl -s "https://api.trello.com/1/lists/<LIST_ID>/cards?fields=name,desc&checklists=all&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN"
```

`TRELLO_API_KEY` / `TRELLO_TOKEN` come from `<skill-dir>/.env` exactly like the AssemblyAI key — see [setup-checks.md](setup-checks.md) — never pasted into chat. If neither a connector nor these keys are available, stop and ask the user for one of the two rather than trying to scrape the Trello web UI.

## 3. Transcribe every video first

Run [analyze.md](analyze.md)'s `analyze` command for **every** raw video you were handed (one file or a whole folder) before matching anything — this step is safe to run in parallel/in the background across all of them (it never touches `temp/ai-cuts.json`, per the One Video At A Time Rule's own carve-out in [find-and-name.md](find-and-name.md)). Collect each video's `transcript` field from the JSON output.

## 4. Match transcript to card

For each video's transcript, compare it against every candidate card's script text (description + checklist lines). This is a fuzzy match, not exact — an actual take deviates from the written script (that's the whole reason [cut-review.md](cut-review.md) exists) — so look for shared distinctive phrases, topic/keyword overlap, and rough length agreement, not verbatim equality.

- **One clear leading candidate** (noticeably higher overlap than the rest, shares wording no other card has): propose it to the user — "Video `X.mp4` looks like it matches `REEL-12-JOAO-ADVOGADO`'s card, based on `[quoted phrase]`" — and wait for a quick confirm before moving on. Skip asking only if the user has already said to auto-confirm clear matches for this batch.
- **Two or more cards score close together, or nothing scores meaningfully above noise**: stop and ask, per the Trello Match Confidence Rule above. Never pick the higher-scoring one "since it has to be something."
- **A video doesn't match any open card in the list at all**: say so plainly and ask the user what to do with it (new card? wrong board? skip it, or fall back to [find-and-name.md](find-and-name.md) for this one?) rather than forcing a match.

## 5. Hand off

Once a video is matched and confirmed:

- The REEL number and client name come from the matched card's name → this is the project name for [build.md](build.md), same format as [find-and-name.md](find-and-name.md) (`REEL-XX-NOME-DO-CLIENTE`), confirmed with the user exactly like the manual flow does.
- The matched card's script text becomes "the script" for [cut-review.md](cut-review.md)'s "With a script" path.
- Continue through [speaker-check.md](speaker-check.md) → [cut-review.md](cut-review.md) → [hooks.md](hooks.md) → [build.md](build.md) **one video at a time**, per the One Video At A Time Rule — matching all videos to cards up front (step 4) is fine since it doesn't touch shared scratch state, but the review-and-build portion is still strictly sequential.

Once every video you were handed is either matched-and-confirmed or explicitly set aside by the user, process the confirmed queue in order.
