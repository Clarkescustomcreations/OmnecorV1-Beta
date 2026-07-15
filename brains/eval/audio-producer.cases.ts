/**
 * @file brains/eval/audio-producer.cases.ts
 * @description A/B eval question set for the built-in **Audio & Podcast Producer** brain.
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "audio-producer",
  name: "Audio & Podcast Producer",
  model: "qwen2.5:7b",
  baseSystem:
    "You are a concise, accurate audio production and text-to-speech expert. Answer " +
    "directly in 3–5 sentences. Be specific and technically precise about TTS, audio " +
    "formats, and mastering; prefer concrete rules and numbers over generalities.",
  cases: [
    {
      q: "What loudness should I master a podcast to, and why not just make it as loud as possible?",
      facts: [["lufs"], ["-16", "16 lufs", "-14", "-19"], ["true peak", "true-peak", "-1", "dbtp", "normalize", "platform"]],
    },
    {
      q: "How do I make synthetic TTS narration sound less robotic and better paced?",
      facts: [["break", "pause", "silence"], ["prosody", "rate", "slow", "vary"], ["ssml", "emphasis", "read aloud"]],
    },
    {
      q: "The TTS engine mispronounces a name. How do I force the correct pronunciation?",
      facts: [["phoneme", "ipa"], ["say-as", "sub", "alias", "respell"], ["lexicon", "homograph", "spelling"]],
    },
    {
      q: "What sample rate and bit depth should I record and edit spoken-word audio at?",
      facts: [["44.1", "48"], ["24-bit", "24 bit", "32-bit float", "32 bit float"], ["16-bit", "16 bit", "export", "dither", "final"]],
    },
    {
      q: "Should a solo-voice podcast be mono or stereo, and why?",
      facts: [["mono"], ["file size", "half", "smaller"], ["earbud", "one earbud", "phone", "playback", "consistent"]],
    },
    {
      q: "What's the difference between normalization and compression for a voice track?",
      facts: [["normaliz", "fixed gain", "level", "target"], ["compress", "dynamics", "threshold", "ratio", "difference"], ["consistent", "peaks", "quiet"]],
    },
    {
      q: "What is the proper order to clean and process a raw voice recording?",
      facts: [["noise", "hiss", "hum"], ["plosive", "pop", "de-ess", "click"], ["clean first", "then", "eq", "compression", "order"]],
    },
    {
      q: "How do I keep background music from drowning out the voice in a podcast?",
      facts: [["duck", "ducking"], ["sidechain", "side-chain", "automation", "lower"], ["voice", "intelligib", "below"]],
    },
    {
      q: "How should I EQ a voice for clarity?",
      facts: [["high-pass", "high pass", "roll off", "rumble", "80", "100"], ["presence", "3", "6 khz", "clarity", "intelligib"], ["de-ess", "sibilance", "mud", "200", "400"]],
    },
    {
      q: "What should I keep in mind when writing a script that will be read by a TTS voice?",
      facts: [["heard", "ear", "aloud", "spoken"], ["short", "single", "sentence"], ["spell", "acronym", "number", "twenty"]],
    },
    {
      q: "Why keep working files lossless and export to MP3 only at the end?",
      facts: [["lossless", "wav", "flac"], ["lossy", "mp3", "aac", "opus", "discard"], ["generation loss", "re-encod", "artifact", "final"]],
    },
    {
      q: "What are the ethical and technical requirements for cloning someone's voice?",
      facts: [["consent", "permission"], ["disclose", "impersonat", "illegal", "deepfake"], ["clean", "reference", "samples", "quality"]],
    },
  ],
};

export default spec;
