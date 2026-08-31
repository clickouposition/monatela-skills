# Step 1 (fallback) — Find the video(s) + script(s), decide the project name

Use this only when [trello-match.md](trello-match.md) — the default Step 1 — doesn't apply: the user already stated the exact script + reel number for this footage, or Trello isn't reachable at all.

## Finding the footage

Look for `.mp4 / .mov / .mkv / .webm / .avi` files. If several and it's unclear which is which, ask. If none are visible, ask for an absolute path. **Always pass absolute paths to the pipeline scripts** — never a relative one, since the scripts and the working directory can diverge once a background task is involved.

## Getting the script

Ask the user for the **script** each video is meant to follow, if they haven't already pasted one. A script is optional but changes how reliable Step 4 (cut review) can be:

- **With a script:** match the on-camera speaker's actual words against it, line by line. Deviations get reported, not hidden.
- **Without a script:** proceed on judgment alone — repeats, false starts, filler (see [cut-review.md](cut-review.md)).

## Multiple videos in one request

If the user hands you several videos at once, process them **one at a time, start to finish** (through [build.md](build.md)) before starting the next. `temp/ai-cuts.json` is shared scratch space that gets overwritten every run — two videos can never be "in progress" at the same time. [analyze.md](analyze.md) itself is safe to kick off in parallel across videos (it never touches `ai-cuts.json`); only the review-and-build portion is strictly sequential.

## Deciding the CapCut project name

The studio's naming convention is fixed:

```
REEL-XX-NOME-DO-CLIENTE
```

- **XX** — the reel number. This comes from the studio's own content calendar, not something you can derive from the file — **always ask the user** what number this reel is, unless they already told you in the same message.
- **NOME-DO-CLIENTE** — the client this footage belongs to. Try to infer it first from context you already have (the active project/workspace name, the working directory, something said earlier in the conversation). If it's still unclear, **ask** — don't guess. A wrong client name silently misfiles a client's work into the wrong folder, which is exactly the kind of mistake this convention exists to prevent.

Confirm the exact final name with the user before moving on (e.g. `REEL-12-JOAO-ADVOGADO`) — it gets passed as the 4th argument to `build` in [build.md](build.md), so CapCut gets the right name on the first write instead of a rename afterward.

Once the video, script (if any), and project name are settled, move to [analyze.md](analyze.md).
