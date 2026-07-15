/**
 * @file brains/sources/audio-producer.ts
 * @description Source content for the built-in **Audio & Podcast Producer**
 * Brain Pack (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * A specialist in text-to-speech, voice generation, audio DSP, and podcast
 * production: SSML pacing, sample rates and formats, loudness normalization,
 * mixing, and multi-speaker dialogue. GENERAL-PURPOSE audio knowledge for any
 * TTS engine or DAW. Original content, ships CC0. One durable fact per entry →
 * one retrieval chunk.
 */
import type { BrainFact } from "./_types.js";

export const AUDIO_PRODUCER_CHARTER = `You are augmented with an Audio & Podcast production brain. Follow these rules on every audio task:

1. Write for the ear, not the eye. Short sentences, one idea per breath, spelled-out numbers/acronyms as spoken, and deliberate pauses — a script that reads well silently can still sound robotic aloud.
2. Control pacing explicitly. Use punctuation and SSML (breaks, prosody rate/pitch, emphasis) to shape rhythm; silence is a tool, not dead air.
3. Respect the audio format. Know your sample rate (44.1/48 kHz), bit depth, channels, and codec; keep the pipeline in a lossless/high-bitrate format until the final export.
4. Master to a loudness target, not a peak. Normalize to an integrated LUFS target for the platform (about -16 LUFS stereo for podcasts) with true-peak headroom (about -1 dBTP), so playback is consistent and not clipped.
5. Clean before you sweeten: fix noise, plosives, and levels first; apply EQ, compression, and effects second. Gain-stage so nothing clips along the chain.
6. For multi-speaker audio, keep each voice on its own track, balance their loudness to each other, and pace turn-taking so it sounds like a conversation, not alternating monologues.
7. Cite the corpus when you use it; prefer its specific guidance over a generic recollection, and surface any conflict rather than silently choosing.`;

export const AUDIO_PRODUCER_SOURCES: BrainFact[] = [
  // ── TTS & SSML ─────────────────────────────────────────────────────────────
  {
    name: "tts-write-for-the-ear",
    text: `TTS and voiceover scripts must be written to be HEARD, not read. Use short, single-clause sentences; avoid nested parentheticals and long subordinate chains the listener can't re-scan. Spell out how things should sound: "twenty twenty-six" not "2026", "dot" and "slash" in URLs, expand or gloss acronyms on first use. Replace visual-only cues (bullet lists, "see below") with spoken transitions ("first… next… finally"). Read every draft ALOUD — the ear catches robotic phrasing the eye forgives.`,
  },
  {
    name: "tts-ssml-basics",
    text: `SSML (Speech Synthesis Markup Language) wraps text in tags that control delivery. Core tags: <break time="500ms"/> for a pause, <prosody rate="90%" pitch="-2st" volume="loud"> to change speed/pitch/loudness, <emphasis level="strong"> to stress a word, <say-as interpret-as="date|telephone|characters|cardinal"> to force pronunciation of numbers/dates/spellings, <phoneme> for exact pronunciation, and <sub alias="..."> to substitute how text is spoken. Wrap the whole document in <speak>. Not every engine supports every tag — test against your target.`,
  },
  {
    name: "tts-pacing-breaks",
    text: `Pacing is the difference between a natural read and a rushed monotone. Insert deliberate pauses: a short <break time="300ms"/> at commas/clause boundaries, a longer 600-800 ms at sentence ends, and a full beat (1 s+) between sections or before a key point lands. Slowing prosody rate slightly (85-95%) for complex or important lines improves comprehension. Silence gives the listener time to absorb — under-pausing is the most common reason synthetic narration feels relentless.`,
  },
  {
    name: "tts-pronunciation-control",
    text: `When a TTS engine mispronounces a word (names, jargon, homographs like "read"/"lead"), fix it deterministically rather than hoping: use <say-as> for numbers/dates/spelled letters, <phoneme alphabet="ipa" ph="..."> to specify exact sounds, or <sub alias="..."> to feed a phonetic respelling. Maintain a lexicon of your recurring problem words. Homographs often need context or an explicit phoneme because the model guesses from spelling. Verify pronunciations by listening, not by trusting the text looks right.`,
  },
  {
    name: "tts-emphasis-and-prosody",
    text: `Meaning rides on WHICH word is stressed — "I never said she took it" changes meaning with each emphasized word. Use <emphasis> or a small prosody pitch/rate bump to place stress on the operative word in a sentence, and drop pitch/slow slightly at the end of statements (a rising end sounds like a question). Vary prosody across a passage; a flat, evenly-stressed read is what makes synthetic speech sound robotic. Match emphasis to intent, not to every "important" word (which flattens it again).`,
  },
  {
    name: "tts-voice-selection",
    text: `Choose a voice for the content and audience: a warm mid-range voice for long-form narration (less listening fatigue), a brighter energetic voice for ads/promos, a calm measured voice for meditative or instructional content. Match language/accent to the audience. Keep ONE voice consistent for a given speaker/character across an entire project — switching a narrator's voice mid-piece is jarring. For multi-speaker work pick voices that are clearly distinguishable in pitch and timbre so listeners can tell them apart.`,
  },
  {
    name: "tts-chunking-long-text",
    text: `Synthesize long text in CHUNKS (per paragraph or sentence group), not one giant request — this bounds latency/memory, lets you regenerate a bad line without redoing everything, and enables streaming playback. Keep chunk boundaries at natural pauses (sentence/paragraph ends) so joins are seamless, and carry consistent voice/prosody settings across chunks. Add a tiny crossfade or matched silence at joins to avoid clicks. Cache generated audio keyed by (text + voice + settings) so unchanged lines aren't re-rendered.`,
  },
  {
    name: "tts-voice-cloning-ethics",
    text: `Voice cloning (generating a target speaker's voice from samples) requires CONSENT of the person whose voice is cloned — impersonation without permission is unethical and, in many places, illegal (right of publicity, fraud, emerging deepfake laws). Best practice: use only voices you own or have licensed, disclose synthetic voices where a listener could be misled, and keep provenance records. Technically, cloning quality depends on clean, varied reference audio; a few minutes of studio-quality speech beats an hour of noisy phone audio.`,
  },
  // ── Digital audio fundamentals ─────────────────────────────────────────────
  {
    name: "audio-sample-rate-nyquist",
    text: `Digital audio samples the waveform at a SAMPLE RATE (samples/second). The Nyquist theorem says you can only represent frequencies up to half the sample rate, so 44.1 kHz (CD) captures up to ~22 kHz — beyond human hearing. 48 kHz is the video/broadcast standard; higher rates (96 kHz) mainly help during heavy processing/pitch-shifting, not final listening. Keep ONE sample rate through your project; resampling repeatedly degrades quality and causes sync drift. Voice/podcast is fine at 44.1 or 48 kHz.`,
  },
  {
    name: "audio-bit-depth-dynamic-range",
    text: `BIT DEPTH sets the amplitude resolution and thus the dynamic range and noise floor: 16-bit gives ~96 dB (CD quality, fine for final delivery), 24-bit gives ~144 dB and is the working standard for recording/editing because the extra headroom means quiet passages and gain changes stay clean. Work in 24-bit (or 32-bit float internally, which is effectively clip-proof during processing) and dither DOWN to 16-bit only at final export. Never edit heavily in 16-bit — you bake in quantization noise.`,
  },
  {
    name: "audio-lossless-vs-lossy",
    text: `Keep your working files LOSSLESS (WAV/FLAC/AIFF) and export to LOSSY (MP3/AAC/Opus) only at the very end. Lossy codecs discard data permanently; re-encoding an MP3 (editing then re-exporting to MP3) stacks artifacts ("generation loss"). For delivery: MP3 at 128-192 kbps or AAC/Opus at lower bitrates is ample for spoken-word podcasts (mono ~96-128 kbps saves bandwidth); music wants higher. Opus is the most efficient modern codec. Never master from a lossy source if you can avoid it.`,
  },
  {
    name: "audio-mono-vs-stereo",
    text: `Spoken-word podcasts are usually best in MONO: a single voice has no stereo image to preserve, mono halves the file size, and it plays back consistently on a phone speaker or a single earbud (a hard-panned stereo element vanishes on one earbud). Reserve stereo for music, ambience, and immersive/binaural production. If you record stereo mics on a solo voice, sum to mono unless the stereo width is intentional. Check mono compatibility even on stereo mixes — phase issues can cancel content when summed.`,
  },
  {
    name: "audio-db-and-headroom",
    text: `Digital level is measured in dBFS (decibels below full scale), where 0 dBFS is the maximum — go over it and you CLIP (hard distortion). Leave HEADROOM: aim recording peaks around -12 to -6 dBFS, and keep the final master's true peak at or below -1 dBTP so downstream lossy encoding (which can overshoot on reconstruction) doesn't clip. dB is logarithmic: +6 dB ≈ double the amplitude, and a 3 dB change is the smallest most people clearly notice. Gain-stage every step to preserve headroom.`,
  },
  {
    name: "audio-latency-buffer",
    text: `Recording/monitoring LATENCY is set by the audio buffer size: a small buffer (e.g. 128 samples) gives low latency for live monitoring but risks glitches/dropouts under CPU load; a large buffer (1024+) is stable for mixing/export but adds delay unusable for live tracking. Rule: small buffer while recording, large buffer while mixing. Latency in samples ÷ sample rate = latency in seconds. Use direct/hardware monitoring to hear yourself without round-trip delay when tracking.`,
  },
  // ── Cleanup & mastering ────────────────────────────────────────────────────
  {
    name: "master-loudness-lufs",
    text: `Master to a LOUDNESS target measured in LUFS (integrated loudness over the whole program), not to peaks — LUFS matches perceived volume. Podcast/streaming targets cluster around -16 LUFS for stereo (-19 to -16 for mono, roughly equivalent perceived level), spoken word often -16 to -14 LUFS. Platforms normalize playback to their own target anyway, so mastering too loud just gets turned down (and you sacrificed dynamics for nothing). Hit the target with a true-peak ceiling around -1 dBTP.`,
  },
  {
    name: "master-normalization-vs-compression",
    text: `Two different tools. NORMALIZATION scales the whole signal by a fixed gain to hit a target (peak or, better, loudness/LUFS) — it changes level, not dynamics. COMPRESSION reduces the DIFFERENCE between loud and quiet by turning down peaks (set by threshold, ratio, attack, release), making a voice sit at a steadier level. For voice: gentle compression (ratio ~2:1-4:1) first for consistency, THEN loudness-normalize to target. Don't normalize a wildly-dynamic track to a loud target without compression, or the quiet parts vanish.`,
  },
  {
    name: "cleanup-noise-and-plosives",
    text: `Fix problems at the source and in this order. NOISE (hiss, hum, room tone): capture a few seconds of silence as a noise profile and apply gentle broadband reduction — over-reduction makes voices sound watery/underwater. PLOSIVES ("p"/"b" pops): prevent with a pop filter and off-axis mic placement; fix in post with a high-pass filter or a short volume dip on the pop. Also de-ess harsh "s" sounds, remove clicks/mouth noise, and gate/edit out long silences. Clean first, sweeten (EQ/compression) after.`,
  },
  {
    name: "eq-voice-shaping",
    text: `EQ shapes tone by boosting/cutting frequency bands. For voice: high-pass (roll off) below ~80-100 Hz to remove rumble and handling noise (nothing useful lives there for speech); a small cut around 200-400 Hz reduces "boominess/mud"; a gentle presence boost around 3-6 kHz adds clarity/intelligibility; tame harsh sibilance around 5-8 kHz with a de-esser rather than a broad cut. Subtractive EQ (cutting problems) usually beats big boosts. A little goes a long way — a few dB is often enough.`,
  },
  {
    name: "mic-technique-proximity",
    text: `Mic choice and placement shape the recording more than any plugin. Dynamic mics (e.g. broadcast dynamics) reject room noise and suit untreated rooms; condensers are more detailed but pick up more room. The PROXIMITY EFFECT means directional mics boost bass as you get closer — use it for warmth, but too close plus plosives = boom and pops. Keep a consistent 4-8 inch distance slightly off-axis with a pop filter, and record in a treated/soft space (soft furnishings, closet full of clothes) to cut reflections. Fixing a bad room in post is far harder than avoiding it.`,
  },
  // ── Podcast production ─────────────────────────────────────────────────────
  {
    name: "podcast-structure-pacing",
    text: `A podcast episode has a shape: a cold open/hook (a compelling line in the first ~15-30 seconds — most drop-off happens early), a brief intro/branding, the body segmented with clear transitions, and a wrap/call-to-action. PACE the segments and vary energy so it doesn't drone; use short music stings or beats of silence to mark transitions. Keep the intro short — listeners came for content, not a long branded opener. Signpost ("first we'll… then…") so the audio-only listener never gets lost.`,
  },
  {
    name: "podcast-multitrack-editing",
    text: `Record each speaker to a SEPARATE track (multitrack), even in the same room, so you can edit levels, noise, and timing independently and fix one person's mic without touching the others. Balance the speakers to the same perceived loudness, edit out cross-talk and long gaps, and tighten turn-taking so replies land naturally (real conversation has minimal dead air between speakers). For remote recording, capture locally on each end ("double-ender") rather than the compressed call audio for far better quality.`,
  },
  {
    name: "podcast-multispeaker-balance",
    text: `For multi-speaker or dialogue audio, make each voice clearly distinguishable and evenly balanced: pick voices/timbres that contrast, match their loudness to each other (a quiet guest next to a loud host is fatiguing to ride the volume on), and keep them centered (mono) for podcasts rather than panned. Pace the exchange like a conversation — slight overlaps and quick responses feel alive; long identical gaps between every turn feel like a stilted read of alternating lines. Give each speaker consistent EQ/processing so the voice's character stays stable across the episode.`,
  },
  {
    name: "podcast-music-ducking",
    text: `When voice and music/ambience play together, DUCK the music: automatically lower the bed several dB whenever the voice is present (via sidechain compression keyed off the voice, or manual volume automation) so speech stays intelligible, then bring the music back up in gaps. Set intro/outro music and stingers well below the voice level. Crossfade music in/out rather than hard cuts. Un-ducked music competing with narration is a top reason listeners can't follow a podcast.`,
  },
  {
    name: "audio-export-chapters-metadata",
    text: `Finalize a podcast with correct METADATA and structure: embed ID3 tags (title, artist/show, episode number, artwork) so players display it properly, add CHAPTER markers for long episodes so listeners can jump around, and keep filenames/URLs stable. Export at the platform's recommended format (commonly MP3 mono ~96-128 kbps or stereo ~128-192 kbps for music-rich shows) hitting the loudness target. Provide a transcript for accessibility and searchability. Consistent metadata is what makes a feed look professional in every app.`,
  },
];
