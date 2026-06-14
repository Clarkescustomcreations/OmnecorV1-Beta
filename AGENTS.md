## Read Before Anything Else

## Read in this exact order before any implementation

1.Context/ Project-Overview.md
2. Context/Architecture.md
3. Context/UI-Tokens.md
4. Context/UI-Rules.md
5. Context/UI-Registry.md
6. Context/Code-Standards.md
7. Context/Library-Docs.md
8. Context/Build-Plan.md
9. Context/Progress-Tracker.md
10.Context/Installed Skill Docs.md

## Available Skills **ALWAYS USE AVAILABLE SKILLS**

## Skills

/architect
Use before building anything.

Think through what you are about to build like a senior engineer before writing any code. Surfaces decisions, aligns on language, and produces a clear implementation plan you confirm before anything starts.

This is not a grilling session. It is a thinking session — collaborative, not adversarial.

/remember
Use at the end and start of every session.

AI has no memory between sessions. Every new session starts blank. This skill fixes that.

/remember save — at end of session, compress what matters into memory.md
/remember restore — at start of new session, restore full context and confirm before continuing

/review
Use after building any feature.

Verify what was built is correct — not just that it works. Reviews in three layers: plan alignment, system integrity, and production readiness. Reports issues clearly so the developer decides what to fix.

Working and correct are not the same thing.

/recover
Use when something goes wrong.

Not every problem is a bug. Not every bug needs debugging. This skill diagnoses which type of failure you are dealing with before deciding how to respond:

Targeted fix — isolated problem, find root cause, fix precisely
Hard reset — polluted session, stop patching, start fresh
Rethink — wrong foundation, no amount of debugging helps

/imprint
Use after building any UI component.

Extract the visual patterns that matter for consistency and save them to ui-registry.md. So every component built after this one matches what came before.

/imprint — capture from recently built component
/imprint [file] — capture from specific file
/imprint audit — scan entire codebase, find conflicts, establish baseline

## Task Specific Skill In
Context/Installed Skill Docs.md
.claude/skills/

## Rules That Never Change

- Never use hardcoded hex values or raw tailwind color classes
- Work through Features and Phases in order 
- Update ‘Context/Progress-Tracker.md’ and Context/UI-Registry.md  after every Feature and Phase 
- ## Before any third party library
- load its installed skill first then read Context/Library-Docs.md  for project specific rules
- ## if the same problem persists after one correction attempt stop immediately use Available Skills
- When unsure ask questions to get more information
- DO NOT guess if needed Search online for known working solutions
- DO NOT reinvent the wheel pull shallow git clones of known working reference code to integrate
- once confirmed used Delete unused ref code and Manus folders when pulling git clones clean up leftover unused files



