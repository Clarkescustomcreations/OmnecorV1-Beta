/**
 * @file brains/eval/content-writer.cases.ts
 * @description A/B eval question set for the built-in **Content Writer** brain.
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "content-writer",
  name: "Content Writer",
  model: "qwen2.5:7b",
  baseSystem:
    "You are a concise, accurate technical-writing and documentation expert. Answer " +
    "directly in 3–5 sentences. Be specific about structure, clarity, and Markdown; " +
    "prefer concrete rules and examples over generalities.",
  cases: [
    {
      q: "How should I order information in a technical document or summary?",
      facts: [["bluf", "bottom line", "lead with", "up front", "first"], ["conclusion", "answer", "action", "point"], ["skim", "support", "then"]],
    },
    {
      q: "What are concrete ways to make writing more concise?",
      facts: [["cut", "delete", "remove", "fluff"], ["in order to", "due to the fact", "wordy", "filler"], ["hedge", "just", "basically", "very", "really"]],
    },
    {
      q: "Should I use active or passive voice in technical writing, and why?",
      facts: [["active"], ["actor", "subject", "who", "named"], ["passive", "shorter", "clearer", "unknown"]],
    },
    {
      q: "What should a good README contain and in what order?",
      facts: [["what", "one-line", "description", "quickstart"], ["install", "usage", "example", "how"], ["top", "run", "developer", "evaluat"]],
    },
    {
      q: "How do I write a fenced code block in Markdown with syntax highlighting?",
      facts: [["fence", "triple backtick", "backtick"], ["language", "tag", "bash", "ts", "json"], ["close", "inline", "single backtick"]],
    },
    {
      q: "Why is it bad to use 'click here' as link text, in Markdown or anywhere?",
      facts: [["descriptive", "meaningful", "link text"], ["screen reader", "accessib", "out of context", "scan"], ["[text]", "here", "read out"]],
    },
    {
      q: "What are the four distinct types of documentation and why not mix them?",
      facts: [["tutorial", "how-to", "how to", "reference", "explanation"], ["diátaxis", "diataxis", "learning", "task", "understanding"], ["mix", "muddle", "mode", "distinct"]],
    },
    {
      q: "Why should I use one consistent term per concept instead of varying my wording?",
      facts: [["one term", "same term", "consistent", "single"], ["elegant variation", "vary", "synonym", "different things"], ["repetition", "reference", "glossary", "define"]],
    },
    {
      q: "When should I use a list versus a table versus prose?",
      facts: [["list", "parallel", "sequential", "steps", "numbered", "bullet"], ["table", "compar", "dimension"], ["prose", "reasoning", "nuance", "narrative"]],
    },
    {
      q: "How do I write an effective error message in a UI?",
      facts: [["what went wrong", "what", "why", "how to fix", "fix"], ["not", "stack trace", "vague", "error"], ["actionable", "guide", "next", "specific"]],
    },
    {
      q: "What's an effective process for editing and revising a draft?",
      facts: [["pass", "passes", "separate"], ["structure", "clarity", "consistency", "proofread"], ["aloud", "order", "rewrite", "last"]],
    },
    {
      q: "How do I write for accessibility and non-native readers?",
      facts: [["plain language", "plain", "jargon"], ["acronym", "expand", "define", "first use"], ["idiom", "color", "alt text", "short"]],
    },
  ],
};

export default spec;
