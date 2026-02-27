# /meta-planner - Restructure Plans for Ralph Loop Execution

Take an existing plan (single file, multiple files, or directory) and restructure it into a ralph-loop-optimized execution format with a master checklist, discrete phase files, built-in testing, and code review gates.

## Usage

```
/meta-planner <path-to-plan>
/meta-planner .claude/plans/my-feature/
/meta-planner .claude/plans/2026-02-22-some-plan.md
```

## What This Skill Does

1. **Reads** the input plan(s) — single file, multiple files, or entire directory
2. **Analyzes** the plan structure, tasks, dependencies, and phases
3. **Restructures** into ralph-loop-compatible format with:
   - `00-master-plan.md` — master checklist + ralph-loop command
   - Phase files (`YYYY-MM-DD-phase-N-description.md`) — discrete task groups
   - Original reference preserved as-is (if large)
4. **Generates** the `/ralph-loop` command pre-configured for the plan
5. **Validates** every task has: test command, file list, commit step
6. **Embeds test + code-review gates** after every phase

---

## Output Structure

```
.claude/plans/<plan-name>/
├── 00-master-plan.md                  ← Master checklist + ralph-loop command
├── YYYY-MM-DD-phase-1-*.md            ← Phase 1 tasks (detailed steps)
├── YYYY-MM-DD-phase-2-*.md            ← Phase 2 tasks
├── ...                                ← More phases as needed
└── YYYY-MM-DD-original-reference.md   ← Original plan preserved (if needed)
```

---

## Instructions

### Stage 1: Read and Understand the Input

1. **Read all input files.** If given a directory, read every `.md` file in it.
2. **Inventory all tasks.** Extract every discrete unit of work — look for:
   - Numbered tasks/steps
   - Checkbox items (`- [ ]`)
   - Section headers describing work
   - Code blocks that need to be written
   - Test commands
3. **Map dependencies.** Which tasks must come before others?
4. **Identify phases.** Group related tasks into logical phases (3-8 tasks per phase max).

### Stage 2: Create the Phase Files

For each phase, create a file following this exact structure:

````markdown
# Phase N: Phase Title — Tasks X-Y

> **Reference:** [Link to original plan or section if applicable]

## Task X: Descriptive Task Title

**Files:**
- Create: `exact/path/to/new_file.py`
- Modify: `exact/path/to/existing.py`
- Test: `tests/exact/path/to/test_file.py`

### Step X.1: Write the failing test

```python
# Actual test code here — not pseudocode
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

### Step X.2: Run test to verify it fails

Run: `cd /mnt/d/Projects/360-Hextile/backend && venv/Scripts/python.exe -m pytest tests/path/test.py::test_name -v`
Expected: FAIL — "function not defined" or similar

### Step X.3: Write minimal implementation

```python
# Actual implementation code — complete, copy-paste ready
def function(input):
    return expected
```

### Step X.4: Run tests to verify pass

Run: `cd /mnt/d/Projects/360-Hextile/backend && venv/Scripts/python.exe -m pytest tests/path/test.py -v`
Expected: PASS

### Step X.5: Commit

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

**Phase file rules:**
- Every task MUST have a test command (even if manual verification)
- Every task MUST list exact file paths (Create/Modify/Test)
- Every task MUST end with a commit step
- Code blocks must be complete and copy-paste ready (no "add validation here")
- Steps follow TDD: test → fail → implement → pass → commit
- Frontend tasks use `svelte-check` as their test command
- Backend tasks use specific `pytest` invocations

### Stage 3: Create the Master Plan

Create `00-master-plan.md` with this structure. **CRITICAL:** The master plan embeds test + code-review gates after every phase. The loop executes ALL tasks continuously without stopping.

````markdown
# [Feature Name] — Master Plan

> **For Claude:** This is a Ralph Loop master plan. Read the Execution Rules below, then execute ALL unchecked tasks continuously.

## How to Start

Run this command to kick off Ralph Loop:

```
/ralph-loop:ralph-loop "Execute .claude/plans/<plan-name>/00-master-plan.md" --completion-promise "ALL <FEATURE> TASKS COMPLETE" --max-iterations <N>
```

**CRITICAL: The kickoff prompt MUST be a single short line referencing this file. Ralph reads all instructions from the file itself — NEVER put multi-line instructions in the kickoff prompt.**

---

## Execution Rules

**CRITICAL: Execute ALL tasks in one continuous run. NEVER stop between tasks.**

When Ralph reads this file, follow these rules:

1. **Execute ALL unchecked tasks in sequence** — start at the first `- [ ]` and do not stop until every task is `- [x]` or the completion promise is output.
2. **For each regular task:**
   - Read the phase file referenced for full details.
   - Execute using TDD (failing test → implement → verify).
   - Run the task-specific test command.
   - If tests pass, commit and check off (`- [ ]` → `- [x]`).
   - **Immediately continue to the next unchecked task.**
3. **For CHECKPOINT tasks:**
   - Run the test suite specified.
   - If tests FAIL: fix failures, re-run until pass, commit fixes.
   - Run code review via `superpowers:requesting-code-review`.
   - If review has findings: fix, re-test, re-review.
   - Only check off when BOTH tests AND review pass.
   - **Then immediately continue to the next task.**
4. **NEVER stop between tasks.** The ONLY reasons to stop mid-plan are:
   - A critical error that makes ALL further progress impossible (e.g., fundamental broken dependency, hardware failure, missing external resource that cannot be created)
   - User explicitly interrupts and asks a question requiring a decision that CANNOT be reasonably inferred
   - These are EXTREMELY rare. Test failures, review findings, minor ambiguities, and implementation challenges are NOT reasons to stop. Fix them and keep going. The bar to stop is: "Is it literally impossible to continue?" If no, keep going.

---

## Overview

**Goal:** [One sentence]

**Architecture:** [2-3 sentences]

**Original Reference:** [Link to original plan file(s) if preserved]

---

## Task Checklist

### Phase 1: Phase Title (`YYYY-MM-DD-phase-1-description.md`)

- [ ] **Task 0:** Short descriptive title
  - Test: `exact pytest or svelte-check command`
  - Files: `file1.py`, `file2.py`

- [ ] **Task 1:** Short descriptive title
  - Test: `exact test command`
  - Files: `file1.py`, `tests/test_file.py`

- [ ] **CHECKPOINT Phase 1:** Run tests + code review
  - Test: `cd /mnt/d/Projects/360-Hextile/backend && venv/Scripts/python.exe -m pytest tests/<relevant>_*.py -v --timeout=120`
  - Review: Run `superpowers:requesting-code-review` for all Phase 1 files
  - **Gate:** Do NOT proceed to Phase 2 until tests pass AND review is clean

### Phase 2: Phase Title (`YYYY-MM-DD-phase-2-description.md`)

- [ ] **Task 2:** Short descriptive title
  - Test: `exact test command`
  - Files: `file.py`

- [ ] **CHECKPOINT Phase 2:** Run tests + code review
  - Test: `full regression command`
  - Review: Run `superpowers:requesting-code-review` for all Phase 2 files
  - **Gate:** Do NOT proceed to Phase 3 until tests pass AND review is clean

[... more phases ...]

### Final Phase: Verification (`YYYY-MM-DD-phase-N-verification.md`)

- [ ] **Task N-1:** Full regression suite
  - Test: Backend + Frontend verification commands

- [ ] **FINAL CHECKPOINT:** Full test suite + final code review
  - Test: `cd /mnt/d/Projects/360-Hextile/backend && venv/Scripts/python.exe -m pytest tests/ -v --timeout=120`
  - Review: Run `superpowers:requesting-code-review` for ALL changed files
  - **Gate:** ALL tests must pass AND review must be 100% clean

- [ ] **Task N:** Output completion promise
  - When ALL tasks AND ALL checkpoints pass: `<promise>ALL <FEATURE> TASKS COMPLETE</promise>`

---

## Execution Notes

- **Git identity:** `Phong <phong@phong.com>`
- **Branch:** Stay on current branch — NEVER switch branches
- **Each task:** TDD (write failing test → implement → verify → commit)
- **Phase gates:** Tests + code review must BOTH pass before crossing phase boundary
- **Phase dependencies:** [Document which phases depend on which]
- **NEVER STOP:** Execute all tasks continuously. Only stop for truly impossible blockers.
````

**Master plan rules:**
- **The ralph-loop kickoff prompt MUST be a single concise line** — just `"Execute .claude/plans/<plan-name>/00-master-plan.md"`. All execution logic goes in the "Execution Rules" section of the master plan file itself. Ralph does NOT parse multi-line kickoff prompts well.
- `--max-iterations` = total number of tasks + checkpoints + 10 buffer (extra for review fix loops)
- `--completion-promise` = `"ALL <FEATURE_NAME> TASKS COMPLETE"` (SCREAMING_CASE feature name)
- Every task has: checkbox, bold task number, title, test command, file list
- **CHECKPOINT** tasks are BLOCKING GATES — tests pass + code review clean before next phase
- Final checkpoint reviews ALL changed files across entire feature
- Last task outputs the `<promise>` tag

### Stage 4: Validate the Output

Before presenting the restructured plan, verify:

1. **Every task has a test command** — no task missing `- Test:` line
2. **Every task has file paths** — no task missing `- Files:` line
3. **Phase files match master checklist** — task numbers align
4. **Ralph-loop command is correct** — path, promise, max-iterations all set
5. **Ralph-loop kickoff prompt is a single short line** — no multi-line prompts
6. **Dependencies are respected** — tasks ordered so prerequisites come first
7. **No orphan tasks** — every task in phase files appears in master checklist
8. **Commit messages follow convention** — `feat:`, `fix:`, `refactor:`, `test:`
9. **Every phase has a checkpoint** — no phase without a gate
10. **Checkpoint test commands are phase-cumulative** — later checkpoints run broader test suites
11. **Final checkpoint reviews ALL files** — not just last phase

### Stage 5: Present Result

After creating all files, output:

```
Plan restructured into ralph-loop format:

Master plan: .claude/plans/<name>/00-master-plan.md
Phase files: N files created
Total tasks: N tasks + M checkpoints across P phases
Quality gates: M test+review checkpoints embedded
Ralph command: Ready (max N iterations)

To execute: Open the master plan and run the ralph-loop command at the top.
```

---

## Task Granularity Guidelines

**Each task should be 2-5 minutes of focused work:**
- "Write the failing test for X" — one task
- "Implement minimal code to pass the test" — one task
- "Add type definitions" — one task
- "Wire the API endpoint" — one task

**NOT acceptable as single tasks:**
- "Implement the entire backend" — too big, split into 5-10 tasks
- "Fix everything" — not specific enough
- "Write tests" — which tests? Be specific

**Splitting heuristic:** If a task touches more than 3 files, consider splitting it.

---

## Handling Different Input Formats

### Single monolithic plan file
- Split into phases by logical groupings
- Preserve original as `YYYY-MM-DD-original-reference.md`
- Create phase files with extracted tasks

### Multiple unstructured files
- Read all, merge understanding
- Identify the canonical task list
- Restructure into phase files + master plan

### Already-structured plan directory
- Read all files, assess structure
- If already ralph-loop compatible: report "Plan already structured" and suggest improvements only
- If partially structured: fill gaps (missing tests, missing file paths, missing commits, missing checkpoints)

### Plans without test commands
- Infer test commands from file paths and task types:
  - Backend Python files → `pytest tests/...`
  - Frontend Svelte files → `svelte-check`
  - API endpoints → `pytest tests/api/...`
- If truly untestable, use: `Test: Manual — [specific verification step]`

---

## Phase Checkpoint Details

Phase checkpoints are special tasks that act as quality gates. They ensure:

1. **All tests pass** — run the phase-specific regression suite
2. **Code review is clean** — use `superpowers:requesting-code-review` skill
3. **No regressions** — later checkpoints include earlier test suites

**Checkpoint behavior in ralph-loop:**
- If tests fail: fix, re-run, commit fix — then KEEP GOING
- If code review has findings: fix findings, re-run tests, re-request review — then KEEP GOING
- Only check off when BOTH tests AND review pass
- NEVER stop after a checkpoint — immediately continue to the next phase

**Checkpoint test command escalation:**
```
Phase 1: pytest tests/test_feature_*.py -v
Phase 2: pytest tests/test_feature_*.py tests/test_api_*.py -v
Phase 3: pytest tests/ -v --timeout=120  (full suite)
Final:   pytest tests/ -v --timeout=120 + svelte-check (everything)
```

---

## Example: Restructuring a Flat Plan

**Input:** A single `2026-02-22-add-widget.md` with 12 tasks in a flat list

**Output:**
```
.claude/plans/add-widget/
├── 00-master-plan.md                          (checklist + ralph command)
├── 2026-02-22-phase-1-backend-model.md        (Tasks 0-2: Pydantic models)
├── 2026-02-22-phase-2-backend-api.md          (Tasks 3-5: API endpoints)
├── 2026-02-22-phase-3-frontend-types.md       (Tasks 6-7: TypeScript types)
├── 2026-02-22-phase-4-frontend-ui.md          (Tasks 8-10: Components)
├── 2026-02-22-phase-5-verification.md         (Tasks 11-12: Integration tests)
└── 2026-02-22-original-reference.md           (Original plan preserved)
```

Master checklist: 12 tasks + 5 phase checkpoints + 1 final = 18 checklist items
Ralph-loop: `--max-iterations 28` (18 + 10 buffer for review fix loops)
