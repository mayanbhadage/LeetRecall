# LeetRecall — Superpowers Workflow

> Adapted from [obra/superpowers](https://github.com/obra/superpowers) for this project.
> This document codifies the development methodology for all future LeetRecall work.

## Skill Activation Order

```
1. brainstorming     → Understand what we're building
2. writing-plans     → Break into bite-sized tasks (tracked in Beads)
3. executing-plans   → Implement task-by-task with TDD
4. systematic-debugging → Root-cause any bugs (no guess-and-check)
5. verification      → Evidence before claims
6. code-review       → Review before merge
```

---

## 1. Brainstorming (Before ANY Feature)

**Iron Law:** No code without a validated design.

**Process:**
1. Explore project context (check files, recent commits, Beads issues)
2. Ask clarifying questions — one at a time, prefer multiple choice
3. Propose 2-3 approaches with trade-offs and recommendation
4. Present design in sections, get user approval after each
5. Save spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
6. Self-review: placeholder scan, consistency check, scope check
7. User reviews spec before proceeding

**LeetRecall specifics:**
- Check `bd ready` for related open issues
- Check `bd memories` for architectural decisions
- Consider Chrome extension constraints (MV3, service worker lifecycle, content script isolation)

---

## 2. Writing Plans (After Design Approval)

**Iron Law:** Plans assume the implementer has zero codebase context.

**Task granularity — each step is 2-5 minutes:**
```
- [ ] Write the failing test
- [ ] Run it to verify it fails
- [ ] Implement minimal code to pass
- [ ] Run tests to verify green
- [ ] Commit
```

**Plan structure:**
```markdown
### Task N: [Component Name]
**Files:**
- Create: `exact/path/to/file.js`
- Modify: `exact/path/to/existing.js:123-145`
- Test: `tests/exact/path/to/test.js`

Steps with complete code, exact commands, expected output.
```

**Requirements:**
- Exact file paths always
- Complete code in every step
- No placeholders (TBD, TODO, "similar to Task N")
- DRY, YAGNI, TDD, frequent commits
- Save to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
- Create matching Beads issues: `bd create "<task>" -p <priority>`

---

## 3. Test-Driven Development (During Implementation)

**Iron Law:** No production code without a failing test first.

**RED → GREEN → REFACTOR cycle:**

| Phase | Action | Verification |
|-------|--------|-------------|
| **RED** | Write ONE failing test | Run test, confirm it FAILS for the right reason |
| **GREEN** | Write MINIMAL code to pass | Run test, confirm it PASSES |
| **REFACTOR** | Clean up (names, duplication) | Run tests, confirm still GREEN |

**LeetRecall test targets:**
- `background/sm2.js` — SM-2 algorithm (pure functions, easily testable)
- `shared/storage.js` — Storage layer (mock chrome.storage)
- `content/detector.js` — Detection logic (mock DOM/fetch)
- `background/service-worker.js` — Message handlers

**Anti-patterns to avoid:**
- Testing mock behavior instead of real behavior
- Tests that pass immediately (you're testing existing behavior)
- "I'll write tests after" — tests written after prove nothing

---

## 4. Systematic Debugging (For ANY Bug)

**Iron Law:** No fixes without root cause investigation first.

### The Four Phases

| Phase | Key Activities | Gate |
|-------|---------------|------|
| **1. Root Cause** | Read errors completely, reproduce, check recent changes, trace data flow | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare against references, identify differences | Know what's different |
| **3. Hypothesis** | Form single theory, test with SMALLEST change, one variable at a time | Confirmed or new hypothesis |
| **4. Fix** | Create failing test, implement single fix, verify | Bug resolved, tests pass |

**Red flags — STOP and return to Phase 1:**
- "Quick fix for now, investigate later"
- "Just try changing X and see"
- Proposing solutions before tracing data flow
- 3+ failed fixes → question the architecture

**LeetRecall debugging context:**
- Check `chrome://extensions` error log
- Use `console.log('[LeetRecall]')` prefix for tracing
- Remember: content scripts run in page context, service worker is isolated
- Check `bd memories` for known architectural decisions

---

## 5. Verification Before Completion

**Iron Law:** Evidence before claims, always.

```
BEFORE claiming any status:
1. IDENTIFY: What command/action proves this claim?
2. RUN: Execute it (fresh, complete)
3. READ: Full output, check exit code
4. VERIFY: Does output confirm the claim?
5. ONLY THEN: Make the claim
```

**LeetRecall verification checklist:**
- [ ] Extension loads without errors in `chrome://extensions`
- [ ] Service worker shows "active" status
- [ ] Console shows `[LeetRecall] Content script loaded` on LeetCode pages
- [ ] No errors in DevTools console
- [ ] Feature works as expected (manual test on LeetCode)
- [ ] Beads issue updated: `bd close <id>`
- [ ] Changes committed and pushed

**Never say:** "should work", "probably fixed", "looks correct"
**Always say:** "Verified: [evidence]" or "Not yet verified"

---

## 6. Code Review (Before Merge)

**When mandatory:**
- After completing major feature
- Before merge to main
- After fixing complex bug

**Review against:**
1. Plan compliance — does implementation match the plan?
2. Code quality — naming, structure, edge cases
3. Test coverage — are behaviors tested?
4. Chrome extension constraints — MV3 compliance, permissions

---

## Integration with Beads

All workflow steps integrate with our Beads issue tracker:

| Superpowers Step | Beads Action |
|-----------------|-------------|
| Brainstorming starts | `bd create "<epic>" -p 0` |
| Plan tasks defined | `bd create "<task>" -p <N>` per task |
| Task started | `bd update <id> --claim` |
| Bug found | `bd create "<bug>" -p 0 -t bug` |
| Insight discovered | `bd remember "<insight>"` |
| Task verified complete | `bd close <id>` |
| All tasks done | `bd ready` (should be empty) |

---

## Quick Reference Card

```
Before coding:    brainstorming → writing-plans
During coding:    RED → GREEN → REFACTOR (per feature)
Bug found:        Phase 1 (root cause) → Phase 2 (pattern) → Phase 3 (hypothesis) → Phase 4 (fix)
Before claiming:  RUN → READ → VERIFY → THEN claim
Before merge:     code-review → fix issues → merge
Track everything: bd create / bd update / bd close / bd remember
```
