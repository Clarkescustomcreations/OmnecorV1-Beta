# Podcast Studio — User Guide

Podcast Studio turns a topic, a set of sources, or a rough idea into a fully
scripted, multi-speaker audio episode — generated and synthesized entirely
within Omnecor.

**Access:** Click **Podcast Studio** in the sidebar navigation.

---

## 1. Overview

The workflow runs end to end inside one page:

```mermaid
graph LR
    T[Topic / Sources] --> S[AI Script Generation]
    S --> D[Multi-Speaker Dialogue]
    D --> A[Local TTS Synthesis]
    A --> E[Episode Audio]
    E --> H[Episode History]
```

Nothing leaves your machine unless you've explicitly configured a cloud TTS
provider — the default voice pipeline is local (XTTS-v2 / Kokoro).

---

## 2. Adding Sources

Before generating a script, you can ground it in real material instead of
letting the model improvise from the topic alone. Use the **Add Sources**
panel to attach:

- **Pasted text** — paste an article, notes, or a transcript directly.
- **Website URL** — Omnecor fetches the page and strips it down to readable
  text before feeding it to the script generator.
- **File upload** — attach a document from disk.

Sources are listed above the script editor and feed directly into the AI's
context when it writes dialogue, so the episode reflects what's actually in
your sources rather than generic commentary.

---

## 3. Generating the Script

1. Enter a **topic** (and optionally a title).
2. Add sources if you want the script grounded in specific material.
3. Click **Generate Script**. The AI produces a multi-speaker dialogue —
   each line attributed to a named speaker — based on the topic and sources.
4. Review and edit any line directly in the script editor before synthesizing
   audio. Nothing is locked until you generate audio.

---

## 4. Speakers & Voices

Each speaker in the script can be assigned:
- A **display name** (shown in the script and episode metadata)
- A **voice** from the local voice pipeline, or a cloned voice if you've set
  one up via the Voice Pipeline / RVC tools

You don't need to finalize voices before generating the script — assign or
change them any time before synthesizing.

---

## 5. Generating Audio

Click **Generate Audio** to synthesize the full episode. Each dialogue turn
is rendered through the assigned speaker's voice and stitched together with
natural pacing into a single audio file.

**While generation is running:**
- Progress is shown per segment.
- You can continue editing the script for segments that haven't synthesized
  yet.

**After generation:**
- A full audio player appears with play/pause and a progress scrubber.
- **Download Audio (.wav)** saves the finished episode locally.

---

## 6. Per-Segment Regeneration

If one line sounds off — wrong tone, mispronunciation, awkward pacing — you
don't need to regenerate the whole episode. Each segment in the result list
has its own **regenerate** button (the refresh icon). Clicking it re-synthesizes
only that segment; the rest of the episode stays exactly as it was, and you
can keep listening/playing while it processes.

---

## 7. Session Persistence

Your in-progress episode — script, sources, speaker assignments, topic, and
title — is automatically saved to your browser's local storage as you work.
If you navigate away or close the tab, reopening Podcast Studio restores
exactly where you left off.

Click **Reset** to clear the current session and start a new episode from
scratch.

---

## 8. Episode History

Every successfully generated episode is recorded in **Episode History**,
accessible from the header. From there you can:
- **Play** any past episode directly
- **Download** the audio again
- **Remove** an episode you no longer want to keep

History is stored locally in your browser and persists across sessions.

---

## 9. Linking to the Neural Brain Map

Toggle **Link to Brain Map** to have generated episodes appear as nodes in
your Neural Brain Map, connected to their source material — useful if you're
using Podcast Studio as part of a larger research or content workflow rather
than a one-off.

---

## Tips

- **Ground episodes in sources** for factual topics — the AI writes
  noticeably better dialogue when it has real material to draw from instead
  of working from a bare topic string.
- **Assign distinct voices** per speaker before the first full generation —
  changing voices later means regenerating affected segments.
- **Use per-segment regeneration liberally** — it's the fastest way to polish
  a near-final episode without burning time re-synthesizing lines that
  already sound right.
