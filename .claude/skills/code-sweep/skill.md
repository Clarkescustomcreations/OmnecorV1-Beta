# Code-Sweep Skill

Beta-readiness code sweep for the Omnecor HMCI AI Workstation. Runs a full 6-domain scan using a swarm of Haiku 4.5 agents, applies fixes via Sonnet 4.6, and escalates security findings to Opus 4.8.

## Usage

```
/code-sweep
```

Optionally scope to a domain:
```
/code-sweep security
/code-sweep typescript
/code-sweep dependencies
/code-sweep routers
/code-sweep frontend
/code-sweep mock
```

## What It Does

Launches parallel Haiku 4.5 agents across 6 domains:

| Domain | What It Scans |
|--------|--------------|
| **typescript** | `any` types, N+1 DB queries, build errors, strict null violations, `@ts-ignore` usage |
| **dependencies** | Outdated packages, deprecated APIs, version conflicts, CommonJS-in-ESM, unused deps |
| **routers** | Dead tRPC endpoints, stub procedures, hardcoded URLs, empty returns, N+1 patterns |
| **frontend** | Broken tRPC hooks, missing error boundaries, dead routes, mock data in production |
| **security** | Hardcoded secrets, auth bypasses, CORS misconfig, XSS vectors, rate limit gaps |
| **mock** | Test/mock data in prod paths, debug artifacts, placeholder strings, in-memory stores |

### Fix Workflow
1. **Haiku 4.5** scans each domain in parallel
2. **Sonnet 4.6** (you) reviews findings and applies targeted fixes
3. **Opus 4.8** handles all security escalations (critical/high vulnerabilities only)
4. All results tracked in `Beta-Code-Sweep.md` at the project root

## Skill Instructions

<execute>
# Determine scan scope
SCOPE="${args:-all}"

echo "Starting Code-Sweep for Omnecor HMCI AI Workstation"
echo "Scope: $SCOPE"
echo "Tracking file: Beta-Code-Sweep.md"
echo ""
echo "Workflow:"
echo "  1. Haiku 4.5 → parallel domain scans"
echo "  2. Sonnet 4.6 → fix non-security issues"
echo "  3. Opus 4.8 → fix security vulnerabilities"
echo "  4. Final: pnpm exec tsc --noEmit (must pass 0 errors)"
</execute>

When this skill is invoked, Claude should:

1. **Read** `Beta-Code-Sweep.md` if it exists (check for prior sweep context)
2. **Explore** the project structure briefly if it's been >7 days since last sweep
3. **Launch** Haiku 4.5 agents in parallel (use `model: "haiku"` in Agent calls with `run_in_background: true`):
   - Agent 1: TypeScript & type safety scan (grep for `: any`, `as any`, `@ts-ignore`, run `pnpm exec tsc --noEmit`)
   - Agent 2: Dependency audit (run `pnpm outdated`, `pnpm audit`, check `package.json` for deprecated packages)
   - Agent 3: Server routers scan (read all files in `server/routers/`, grep for stubs/hardcoded URLs/empty returns)
   - Agent 4: Frontend components scan (read `App.tsx`, grep for `console.log`, missing error boundaries, broken hooks)
   - Agent 5: Security scan (grep for secrets, eval, CORS issues, read `_core/security.ts` and `_core/oauth.ts`)
   - Agent 6: Mock/dead code scan (grep for mock/fake/dummy/placeholder, read `server/storage.ts`)

4. **Wait** for all agents to complete (they run in background — you'll be notified)

5. **Triage** findings as they arrive:
   - Log each domain result to `Beta-Code-Sweep.md` immediately on receipt
   - Mark SECURITY findings for Opus 4.8 escalation
   - Mark all other HIGH/CRITICAL findings for Sonnet 4.6 fix

6. **Fix** non-security issues directly (you are Sonnet 4.6):
   - Make minimal targeted changes — no refactoring
   - Read each file before editing
   - Verify with `pnpm exec tsc --noEmit` after each batch

7. **Escalate** security findings to Opus 4.8:
   - Launch one Opus agent with all security findings
   - Provide exact file paths, line numbers, and context
   - Opus applies the fixes and verifies tsc clean

8. **Final verification**:
   - Run `pnpm exec tsc --noEmit` — must be 0 errors
   - Update `Beta-Code-Sweep.md` checklist
   - Report summary to user

## Tracking File Format

Results are written to `Beta-Code-Sweep.md` at the project root. The file tracks:
- Scan domain status table
- Per-domain findings (grouped by severity: CRITICAL / HIGH / MEDIUM / LOW)
- Fixes applied table (file | issue | fix | agent)
- Security escalations table
- Final gate checklist
- Remaining deferred issues

## Notes

- Haiku agents require Bash permissions. If they fail with permission errors, run `/update-config` to add `Bash(grep *)`, `Bash(find *)`, `Bash(pnpm *)` to the project allowlist.
- The `_refs/` directory contains reference code — exclude it from all scans.
- TypeScript baseline: `pnpm exec tsc --noEmit` must pass 0 errors.
- Security findings always go to Opus 4.8 — never self-fix security issues as Sonnet.
- Track deferred issues (Phase 28 stubs, etc.) in the Remaining Known Issues table — don't fix things that are intentionally incomplete.
