/**
 * @file brains/sources/content-writer.ts
 * @description Source content for the built-in **Content Writer** Brain Pack
 * (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * A technical-writing and documentation expert: Markdown structure, clear
 * concise prose, editing, and information architecture. GENERAL-PURPOSE writing
 * knowledge for READMEs, docs, UI copy, and articles. Original content, ships
 * CC0. One durable fact per entry → one retrieval chunk.
 */
import type { BrainFact } from "./_types.js";

export const CONTENT_WRITER_CHARTER = `You are augmented with a technical-writing brain. Follow these rules on every writing task:

1. Lead with the point. Put the conclusion, answer, or action first (BLUF — bottom line up front); readers skim and leave. Don't bury the important sentence under throat-clearing.
2. Cut the fluff. Delete filler ("in order to" → "to"), hedges, and redundancy. Prefer short words and short sentences. If a word earns nothing, remove it.
3. Write for the reader's task, not the writer's knowledge. Know who the reader is and what they're trying to do; answer that. Define a term the first time; never assume unstated context.
4. Prefer active voice and concrete verbs. "The function returns X" beats "X is returned by the function." Name the actor.
5. Structure for scanning: descriptive headings, short paragraphs, lists for parallel items, tables for comparisons, code blocks for code. Format carries meaning.
6. Be consistent: one term per concept, consistent capitalization/voice/tense, and a followed style guide. Inconsistency makes readers doubt the content.
7. Show, don't just tell: a concrete example or command beats an abstract description. Every how-to needs a runnable/copyable example.
8. Cite the corpus when you use it; prefer its specific guidance over a generic recollection, and surface any conflict rather than silently choosing.`;

export const CONTENT_WRITER_SOURCES: BrainFact[] = [
  // ── Clarity & concision ────────────────────────────────────────────────────
  {
    name: "write-bluf-lead-with-point",
    text: `Lead with the bottom line (BLUF — Bottom Line Up Front): state the answer, conclusion, or required action in the FIRST sentence or paragraph, then support it. Readers skim and often stop early, so a point buried in paragraph four is a point most people never read. This inverts academic "build-up-to-the-thesis" habits. For docs: the first line of a section should tell the reader what they'll get or do. For an email/summary: the ask or decision goes first, context second.`,
  },
  {
    name: "write-cut-the-fluff",
    text: `Ruthlessly cut words that earn nothing. Replace wordy phrases: "in order to" → "to", "due to the fact that" → "because", "at this point in time" → "now", "has the ability to" → "can", "a large number of" → "many". Delete hedges ("basically", "actually", "just", "very", "really") and empty intros ("It is important to note that…"). Concision is respect for the reader's time. A good test: try removing a word — if the meaning survives, it was fluff.`,
  },
  {
    name: "write-active-voice",
    text: `Prefer active voice: subject-verb-object with a named actor. "The parser validates the input" is clearer and shorter than the passive "the input is validated by the parser", and it can't hide WHO does the thing (passive voice's classic failure: "mistakes were made"). Passive is defensible when the actor is unknown, irrelevant, or when you deliberately want to foreground the object ("The server was compromised at 3am"). Default to active; use passive as a conscious choice, not a habit.`,
  },
  {
    name: "write-short-sentences",
    text: `Favor short sentences and one idea per sentence. Long sentences with multiple clauses force the reader to hold too much in working memory and lose the thread. Vary length for rhythm, but when a sentence runs past ~25-30 words or has three "and/but/which" joints, split it. Break a dense paragraph the same way: one topic per paragraph, and keep paragraphs short (a few sentences) so the page looks scannable rather than a wall of text.`,
  },
  {
    name: "write-concrete-not-abstract",
    text: `Replace abstractions with concrete, specific language. "Improves performance" is vague; "cuts page load from 4s to 400ms" is concrete and credible. Prefer strong specific verbs over noun-phrases built on weak verbs ("decide" not "make a decision", "analyze" not "perform an analysis" — this is fixing "nominalization/zombie nouns"). Concrete nouns and vivid verbs make writing shorter AND clearer at once. When you catch yourself writing a category word, ask "like what, exactly?"`,
  },
  {
    name: "write-parallel-structure",
    text: `Keep parallel ideas in parallel grammatical form. A list should have items of the same shape: all verb phrases ("Install X. Configure Y. Run Z.") or all noun phrases — not a mix. Headings at the same level should share a pattern. Parallelism makes structure feel intentional and easier to scan; broken parallelism ("The tool is fast, reliable, and it has good docs") reads as clumsy. This applies to bullet lists, headings, and series within a sentence.`,
  },
  {
    name: "write-know-your-reader",
    text: `Write for a specific reader and their task, not for yourself. Identify who they are (beginner vs expert), what they already know, and what they're trying to accomplish, then include exactly what serves that — no more, no less. An expert reference and a beginner tutorial about the same feature are different documents. The most common technical-writing failure is the "curse of knowledge": assuming the reader shares context they don't have. When in doubt, define the term and show the step.`,
  },
  // ── Structure & formatting ─────────────────────────────────────────────────
  {
    name: "write-headings-scannable",
    text: `Structure documents so a reader can scan and jump. Use descriptive headings that state the section's content or the task ("Configure the database" not "Configuration"), keep a logical heading hierarchy (don't skip levels), and front-load each section with its key point. Most readers scan headings, first sentences, lists, and code before reading prose. Good structure lets someone find their answer without reading top-to-bottom — which is how technical docs are actually used.`,
  },
  {
    name: "write-lists-vs-prose",
    text: `Use the right container for the content. LISTS for parallel/sequential items — numbered (ordered) for steps that must happen in sequence, bulleted (unordered) for a set with no order. TABLES for comparing items across the same dimensions. PROSE for reasoning, nuance, and connected argument that lists would fragment. Don't bullet-point everything (it strips out the connective logic) and don't bury a 7-step procedure in a paragraph. Match the format to whether items are parallel, sequential, comparative, or narrative.`,
  },
  {
    name: "write-one-term-per-concept",
    text: `Use exactly ONE term for each concept and stick to it. In technical writing, "elegant variation" (calling the same thing a "user", then "account", then "profile" to avoid repetition) makes readers wonder if you mean three different things. Pick the clearest term and repeat it — repetition is a feature in reference material. Keep a glossary/term list for anything ambiguous, and define each term on first use. Consistency of terminology is more important than avoiding repetition.`,
  },
  {
    name: "write-examples-and-code",
    text: `Show, don't just tell: pair every abstract instruction with a concrete example, command, or code snippet the reader can copy and run. A how-to that says "configure the connection string" without showing one is half-finished. Make examples realistic and complete (they should actually work), use meaningful placeholder names (YOUR_API_KEY, not "xxx"), and show expected output where it helps confirm success. Examples are often the ONLY part of the docs people read carefully.`,
  },
  {
    name: "write-front-load-sentences",
    text: `Front-load sentences and paragraphs with the most important information. English readers weight the beginning; put the subject and the point early and push qualifications to the end. "Set TIMEOUT to at least 30 seconds to avoid dropped connections" leads with the action; "In order to avoid dropped connections, which can occur under load, you should consider setting…" buries it. This mirrors BLUF at the sentence level and keeps skimmers oriented.`,
  },
  // ── Markdown ───────────────────────────────────────────────────────────────
  {
    name: "md-headings-structure",
    text: `Markdown headings use # (one # per level, space after: "# Title", "## Section", "### Subsection"). Use exactly ONE h1 (#) as the document title, then nest logically without skipping levels (don't jump ## to ####). Headings generate the document outline/anchors many renderers use for a table of contents and deep links, so write them as meaningful, unique labels. Leave a blank line before and after a heading so it renders reliably across parsers.`,
  },
  {
    name: "md-code-blocks-fences",
    text: `Use FENCED code blocks (triple backticks) with a language tag for syntax highlighting: open with three backticks followed by the language (e.g. \`\`\`bash / \`\`\`ts / \`\`\`json) and close with three backticks on their own line. Inline code uses single backticks for identifiers, filenames, commands, and values (\`getUser()\`, \`config.json\`). If your code sample itself contains triple backticks, fence the outer block with FOUR backticks. Never paste code as plain prose — the block preserves whitespace and prevents autocorrect mangling.`,
  },
  {
    name: "md-lists-and-nesting",
    text: `Markdown lists: use -, *, or + for unordered and 1. 2. 3. for ordered (many renderers renumber automatically, so you can write 1. for every item). Nest by indenting the sub-item (typically 2-4 spaces) under its parent. Leave a blank line before a list starts so it isn't absorbed into the preceding paragraph, and keep marker style consistent within a document. For task lists many renderers support - [ ] (unchecked) and - [x] (checked).`,
  },
  {
    name: "md-links-and-images",
    text: `Markdown links are [visible text](url) and images add a leading bang: ![alt text](path). Always write descriptive link text ("see the [installation guide](…)") not "click [here](…)" — the link text is read out by screen readers and scanned by sighted users out of context. Give images meaningful ALT text describing their content for accessibility. Use reference-style links ([text][ref] with [ref]: url defined elsewhere) to keep long URLs out of the prose when a document has many links.`,
  },
  {
    name: "md-tables",
    text: `Markdown tables use pipes and a header separator row: a header row, then a row of dashes (---) defining columns, then data rows, each cell separated by |. Control alignment in the separator row: :--- left, :---: center, ---: right. Keep tables for genuinely tabular, comparative data — they degrade badly on narrow screens and in plain-text views, so don't force prose or long content into a table. For complex layouts, a list or several small tables read better than one giant wide table.`,
  },
  {
    name: "md-blockquotes-callouts",
    text: `Blockquotes use a leading > and are conventionally used for quoted text and, in many tools, for CALLOUTS/admonitions (Note, Warning, Tip) — some renderers (GitHub, docs sites) style > [!NOTE] / > [!WARNING] blocks specially. Use callouts sparingly for genuinely important asides (a gotcha, a destructive-action warning); overusing them trains readers to ignore them. Keep the callout short and lead with the type so the reader knows instantly whether it's a warning or a nicety.`,
  },
  {
    name: "md-portability",
    text: `Markdown has flavors (CommonMark, GitHub-Flavored Markdown, and tool-specific extensions). Stick to widely-supported CommonMark/GFM basics — headings, lists, code fences, links, tables, blockquotes — for maximum portability, and only reach for extensions (footnotes, admonitions, math, mermaid diagrams) when you know the target renderer supports them. Test how a document renders in its actual destination (GitHub, a docs generator, a chat client) rather than assuming; raw asterisks and unclosed fences are the usual culprits when Markdown "breaks".`,
  },
  // ── Documents & editing ────────────────────────────────────────────────────
  {
    name: "doc-readme-structure",
    text: `A good README answers, in order: WHAT it is (one-line description + a bit of context), WHY/what problem it solves, HOW to install it, HOW to use it (a minimal working example), and where to go next (config, contributing, license). Lead with the one-liner and a quickstart — a developer evaluating your project decides in seconds. Put the copy-paste "get it running" path near the top; push exhaustive reference and edge cases lower. A README that opens with history and architecture instead of "here's how to run it" loses readers.`,
  },
  {
    name: "doc-types-diataxis",
    text: `Documentation serves four distinct needs, and mixing them muddles all four (the Diátaxis framework): TUTORIALS (learning-oriented, hand-held first success), HOW-TO GUIDES (task-oriented recipes for a specific goal), REFERENCE (information-oriented, complete and dry — API/CLI/config), and EXPLANATION (understanding-oriented background and rationale). A tutorial should not double as a reference; a reference should not tell a story. Decide which mode a given page is and keep it in that mode — readers arrive with one of these needs, not all four.`,
  },
  {
    name: "doc-ui-microcopy",
    text: `UI copy (buttons, labels, errors, empty states) is writing too, and it's short by necessity. Buttons name the action the user takes ("Save changes", "Delete account") not vague labels ("OK", "Submit"). ERROR messages say what went wrong, why, and how to fix it ("Email is already registered — try signing in") not "Error" or a stack trace. Empty states guide the first action rather than showing a blank void. Be consistent in voice and capitalization. Every word is on-screen forever, so make each one earn its space.`,
  },
  {
    name: "edit-revise-in-passes",
    text: `Writing is rewriting — draft first, then revise in separate PASSES rather than perfecting each sentence as you go. A useful order: (1) structure — is the information in the right order and complete? (2) clarity — cut fluff, fix passive/vague/long sentences; (3) consistency — terms, formatting, style; (4) proofreading — grammar, spelling, typos last. Editing all dimensions at once is inefficient and misses things. Read it aloud to catch awkward phrasing, and, ideally, leave time between drafting and editing so you read it fresh.`,
  },
  {
    name: "edit-style-guide-consistency",
    text: `Follow a style guide (a project's own, or a standard like the Microsoft/Google developer style guides) so choices are consistent and not re-litigated per document: heading capitalization (title vs sentence case), Oxford comma or not, number formatting, voice/tense, how code and UI elements are marked. Consistency signals care and reduces reader friction — inconsistent style makes readers subconsciously trust the content less. When no guide exists, pick conventions, write them down, and apply them uniformly.`,
  },
  {
    name: "write-accessibility-plain-language",
    text: `Write inclusively and accessibly: prefer PLAIN LANGUAGE over jargon (or define the jargon), expand acronyms on first use, and avoid idioms/cultural references that don't translate. Use descriptive link text and image alt text (screen readers depend on them). Don't rely on color or spatial words alone ("the green button", "the box on the right") to convey meaning — name the thing. Short sentences and clear structure help everyone, especially non-native readers and assistive-tech users. Accessibility is good writing, not a special mode.`,
  },
];
