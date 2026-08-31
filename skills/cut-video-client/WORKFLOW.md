# Workflow: raw footage → client-ready CapCut cut

The same process as `SKILL.md`, described as framework-agnostic pseudocode. Use this as the base if you're implementing the pipeline in another tool, language, or agent — it names the steps and the decisions inside them without depending on Claude's tool-use format.

```
INPUT: raw video file, optional script text, client name, reel number

1. NORMALIZE(raw_video) -> normalized_video
   - constant frame rate, H.264, rotation baked into pixels, AAC 48kHz stereo
   - every downstream step (silence detection, transcription, diarization,
     final export) must reference this SAME normalized file — never the raw
     source and never two different re-encodes. A single canonical timeline
     is what keeps word timestamps, cut points, and the final export in sync.

2. DETECT_SILENCE(normalized_video) -> silent_ranges

3. TRANSCRIBE_WORDS(normalized_video) -> words[]  // {text, start, end} per word
   - word-level timestamps, not sentence-level — cuts need to land exactly
     on a word boundary, not somewhere inside a 3-second sentence chunk

4. DIARIZE(normalized_video) -> utterances[]  // {speaker_label, start, end, text}
   IF count(distinct speaker_label) > 1:
     FOR EACH speaker_label:
       loudness[speaker_label] = MEAN(
         volume_db(sample) FOR sample IN longest_utterances(speaker_label, n=5)
       )
     on_camera_speaker = ARGMAX(loudness)
     gap = loudness[on_camera_speaker] - loudness[second_loudest]
     confidence = "high" IF gap >= 5dB ELSE "medium" IF gap >= 2dB ELSE "low"
     IF confidence != "high" OR result contradicts known context:
       ASK_HUMAN(loudness, sample utterances per speaker) -> on_camera_speaker
   ELSE:
     on_camera_speaker = the only speaker present

   candidate_words = words[] FILTERED to on_camera_speaker's utterance ranges

5. BUILD_CUT_LIST(candidate_words, script?) -> cuts[]  // {startSec, endSec, reason}
   IF script given:
     FOR EACH line IN script:
       takes = FIND_ALL(candidate_words, matching line's approximate content)
       best = CLOSEST_WORDING_MATCH(takes, line)  // ties -> later/cleaner take
       IF no take matches at all: NOTE("line never recorded"), skip it
       cuts += everything NOT in best's [start, end] range, up to the
              next kept take's start (endSec = next kept word's start,
              not this take's own end — preserves natural pause)
   ELSE (or in addition):
     detect repeats, false starts, standalone fillers, stretched/stuttered
     words, abandoned sentences, self-corrections, off-topic banter
     -> cuts += one entry per removed span, using the same
        startSec = first cut word's start,
        endSec = next KEPT word's start convention

6. VERIFY(cuts):
   - every cut lands on a word boundary (never mid-word)
   - every kept span comes from on_camera_speaker only
   - no accidental gaps: a script line with zero matching takes is reported,
     not silently invented

7. PROPOSE_HOOK(transcript) -> 5 candidates, max 4-5 words each, truthful to
   content, non-clickbait -> ASK_HUMAN to pick one (or skip, e.g. testimonials)

8. RENDER_PROJECT(normalized_video, cuts, hook_text,
                   project_name = "REEL-{reel_number}-{client_name}")
   -> CapCut-compatible project (draft_content.json + material references)

OUTPUT: CapCut project ready to open, named per the studio convention,
        report to human: duration before/after, which speaker was kept and
        why, any script-wording deviations
```

## Notes for a from-scratch implementation

- The speaker-loudness heuristic (step 4) is exactly that — a heuristic. It works because the person being filmed is almost always physically closest to whatever mic is capturing the room, so their voice measures louder on average even without a dedicated lav mic per person. It fails when both people are roughly equidistant from the mic (small loudness gap) or when the "on camera" person deliberately steps back — which is why low-confidence results must escalate to a human rather than being trusted blindly.
- Step 5's word-boundary convention (`endSec` = next kept word's start, not the cut span's own end) is what prevents two failure modes at once: leaking the onset of the next kept word into the removed span (clipping its start), and collapsing natural pauses between sentences into dead silence.
- See `API_REFERENCE.md` for the concrete REST endpoints and CLI commands each pseudocode step maps to.
