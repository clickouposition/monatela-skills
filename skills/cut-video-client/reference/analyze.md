# Step 2 — Analyze (run in background)

**Before this step, delete `temp/ai-cuts.json` if it exists from a previous video.** Both `analyze` and `build` read that file as the "repeat source" whenever it's present — a leftover file from a different (usually longer or shorter) video applies nonsense cut times to this one. During `analyze` this only pollutes the printed stats (the cached transcript itself is unaffected). During `build` it actually mis-cuts the video. Never skip this, even when it feels redundant.

```bash
cd <skill-dir>
npx tsx src/roughcut.ts analyze "<absolute-video-path>"
```

Run with `run_in_background: true` and **wait for the completion notification — do not poll with sleep**. The first run on a new video takes 1–3 minutes (normalize + transcribe). Subsequent runs on the same video are instant (cached).

The output is a single JSON line: `original`, `kept`, `removed`, `sections`, `repeatsRemoved`, `transcript` (full text). Read it for a first impression of the footage, but don't treat `kept`/`removed` as final — [cut-review.md](cut-review.md) supersedes it with a word-level pass.

If the command fails with `ERR_MODULE_NOT_FOUND` for `@remotion/renderer`, or `FFmpeg not found`, go back to [setup-checks.md](setup-checks.md) — one of the two prerequisite checks was skipped or the install didn't finish.

Once analysis completes, move to [speaker-check.md](speaker-check.md).
