# /loop-gap — Generate & Run Iterative Gap Scanner Loop

Generate a `loop-gap.md` Ralph Loop prompt for any scope — plan directories, code features, or the whole project — then execute it. If one already exists, update it with any new/removed files and run it.

## Usage

```
# Plan directories (scan plan .md files for cross-reference consistency)
/loop-gap .claude/plans/vace
/loop-gap .claude/plans/new-image-pipelines

# Code features (scan source code for a specific feature area)
/loop-gap feature:licensing
/loop-gap feature:sequences
/loop-gap feature:templates

# Specific code paths (scan specific directories/files)
/loop-gap backend/processors/
/loop-gap backend/sequences/tweeners/ backend/sequences/workflows/
/loop-gap frontend/src/lib/components/sequences/

# Whole project (broad sweep)
/loop-gap project
```

## Instructions

### Step 0 — Detect scan mode

Parse the arguments to determine which mode to use:

| Argument Pattern | Mode | Description |
|-----------------|------|-------------|
| Path ending in `.claude/plans/*` or containing only `.md` files | **plan** | Scan plan docs for cross-reference consistency |
| `feature:{name}` | **feature** | Scan all code related to a named feature |
| `project` | **project** | Broad scan across the whole project |
| Any other path(s) | **code** | Scan specific code directories/files |

### Step 1 — Discover files

#### Plan mode
Glob `{TARGET_DIR}/**/*.md` — collect all markdown plan files.

#### Feature mode
Map the feature name to relevant directories using this lookup + any additional discovery:

| Feature | Directories to scan |
|---------|-------------------|
| `licensing` | `backend/licensing/`, `backend/api/routes/license.py`, `backend/tests/licensing/`, `frontend/src/lib/components/license/`, `frontend/src/lib/api/license.ts` |
| `sequences` | `backend/sequences/`, `backend/api/routes/sequences.py`, `backend/tests/sequences/`, `frontend/src/lib/components/sequences/`, `frontend/src/lib/api/sequences.ts` |
| `templates` | `backend/templates/`, `backend/api/routes/templates.py`, `backend/tests/templates/`, `frontend/src/lib/components/templates/` |
| `processors` | `backend/processors/`, `backend/api/routes/processors.py`, `backend/tests/processors/` |
| `gallery` | `backend/gallery/`, `backend/api/routes/gallery.py`, `backend/tests/gallery/`, `frontend/src/lib/components/gallery/` |
| `seed-canvas` | `backend/seed_canvas/`, `backend/api/routes/seed_canvas.py`, `backend/tests/seed_canvas/` |
| `settings` | `backend/settings.py`, `backend/api/routes/settings.py`, `frontend/src/lib/stores/settings.ts` |
| Other | Glob for `**/*{feature_name}*` across `backend/` and `frontend/src/`, also check `backend/api/routes/`, `backend/tests/` |

Collect all `.py`, `.ts`, `.svelte` files in those directories. Also include related plan files if they exist (`{.claude/plans/}/{feature}*`).

#### Code mode
Glob all source files (`.py`, `.ts`, `.svelte`, `.rs`) in the specified paths. Include subdirectories.

#### Project mode
Scan at the module level — one agent per major backend module + one per major frontend area:
- `backend/api/` (routes + models)
- `backend/core/` (GPU ops, projection, propagation)
- `backend/processors/` (AI model integrations)
- `backend/sequences/` (tweeners, workflows)
- `backend/services/` (pipeline, export)
- `backend/licensing/`
- `backend/templates/`
- `frontend/src/lib/components/`
- `frontend/src/lib/stores/`
- `frontend/src/lib/api/`

### Step 2 — Classify files

#### Plan mode
Sort into three buckets:

| Bucket | Rule |
|--------|------|
| **Master/Foundation** | Filename contains `master-plan`, `foundation`, or `overview` |
| **Editable** | Plan files NOT master, NOT research/reference, NOT `loop-gap.md`/`gap-scanner.md`/`REVIEW-LOG.md` |
| **Read-only** | Files in `research/` subdirs, or with `research`, `assessment`, `REVIEW-LOG`, `iteration-*-gap` in name |

#### Feature / Code / Project mode
Sort into:

| Bucket | Rule |
|--------|------|
| **Primary source** | Implementation files (`.py`, `.ts`, `.svelte`, `.rs`) — one agent per file or per module (see grouping below) |
| **Test files** | Files in `tests/` directories — agents can read for context but focus is on source |
| **Config/reference** | `__init__.py`, config files, type definitions — read-only context |

**Grouping for agents:** If there are more than 15 source files, group them by module/directory (one agent per directory instead of per file). If fewer than 15, one agent per file.

**Always exclude:** `loop-gap.md`, `gap-scanner.md`, `__pycache__/`, `node_modules/`, `.venv/`, `venv/`.

### Step 3 — Check for existing loop-gap.md

Determine output location:
- **Plan mode:** `{TARGET_DIR}/loop-gap.md`
- **Feature mode:** `.claude/plans/loop-gap-{feature_name}.md`
- **Code mode:** `.claude/plans/loop-gap-{dirname}.md` (derived from first path argument)
- **Project mode:** `.claude/plans/loop-gap-project.md`

Check if the file exists:
- **Exists:** Read it. Compare file lists against discovery.
  - Files added → update lists and agent table
  - Files removed → remove from lists
  - No changes → skip to Step 5
- **Doesn't exist:** Generate fresh in Step 4

### Step 4 — Generate loop-gap.md

Use the appropriate template based on mode:

---

#### Plan Mode Template

Use the plan template (same as before — see "Plan Template" section below).

#### Feature / Code / Project Mode Template

````markdown
# {SCOPE_NAME} Gap Scanner — Ralph Loop Prompt

> **Usage:** `/ralph-loop:ralph-loop "{OUTPUT_PATH}" --max-iterations 50 --completion-promise "NO GAPS REMAINING"`

You are an iterative code-quality auditor for the **{SCOPE_NAME}** scope. Each iteration, you spawn **one parallel Opus agent per file/module** to find gaps, then collect results and fix everything.

## Scope

```
{SCOPE_DESCRIPTION}
```

## Files/Modules (one agent each)

| # | File/Module | Agent Focus |
|---|------------|-------------|
{FOR_EACH_PRIMARY}
| {N} | `{PATH}` | {FOCUS_DESCRIPTION} |
{END_FOR}

## Context Files (agents can read for reference)

```
{FOR_EACH_CONTEXT_FILE}
{PATH}
{END_FOR}
```

## Gap Categories (every agent checks ALL of these for its file/module)

### 1. Interface Consistency
- Public class/function signatures match what callers expect
- Type hints are present and accurate
- Return types match what consumers use
- Method names follow project conventions (snake_case Python, camelCase TS)

### 2. Import & Dependency Integrity
- All imports resolve to existing modules/classes
- No circular import chains
- No imports from internal/private modules that shouldn't be accessed
- Dependencies flow in the right direction (e.g., services → core, not core → services)

### 3. Contract Completeness
- Abstract/base class methods are implemented by all subclasses
- Required fields in Pydantic models match API usage
- Event names/payloads are consistent between emitter and consumer
- API route responses match frontend API client expectations

### 4. Test Coverage Gaps
- Public functions/methods have corresponding tests
- Edge cases identified in code comments have test coverage
- Error paths have tests (not just happy path)
- Test mocks match actual interfaces they mock

### 5. Error Handling
- Async functions have proper try/except
- API routes return proper error responses (not bare 500s)
- Resource cleanup in finally blocks where needed
- Error messages are descriptive enough to debug

### 6. Dead Code & Orphans
- No unreachable code paths
- No unused imports or variables
- No functions/classes defined but never called
- No config fields defined but never read

### 7. Documentation & Naming
- Public APIs have docstrings
- Complex logic has explanatory comments
- Variable/function names clearly describe purpose
- No misleading names (e.g., function named `get_X` that also modifies state)

## Procedure (follow EXACTLY each iteration)

### Step 1 — Spawn parallel agents

Use the **Task tool** to spawn one **Opus agent** (`model: "opus"`, `subagent_type: "general-purpose"`) per file/module ({N_PRIMARY} agents total). Launch them **all in a single message** so they run in parallel.

Each agent's prompt MUST include:

1. **Its primary file/module** — the one it is responsible for auditing
2. **The full list of other files** — for cross-reference context
3. **The full gap categories list** (copy-paste the 7 categories above)
4. **These instructions:**
   - Read your primary file(s) completely
   - Read related files as needed for cross-reference (callers, callees, base classes, tests)
   - Report ALL gaps found as a structured list: `file:line | category | severity (High/Med/Low) | description | suggested fix`
   - If you can fix a gap in your primary file, fix it directly with the Edit tool
   - If a gap requires changes to ANOTHER file, do NOT edit it — just report it
   - DO NOT add features, refactor, or "improve" code — only fix genuine gaps
   - DO NOT add docstrings/comments to code you didn't change for other reasons
   - DO NOT change code style or formatting unless it's an actual bug

### Step 2 — Collect and apply fixes

After all {N_PRIMARY} agents return:
- Gather all reported gaps that need cross-file fixes
- Apply those cross-file fixes yourself
- Compile a summary of everything fixed this iteration

### Step 3 — Code review gate

If any fixes were made, spawn a **single Opus review agent** (`model: "opus"`, `subagent_type: "superpowers:code-reviewer"`) to verify the fixes.

The review agent's prompt MUST include:

```
# Code Gap Fix Review

You are reviewing code edits made by gap-scanner agents for correctness.

## What Was Implemented
Gap fixes across {SCOPE_NAME} — interface consistency fixes, import corrections,
contract completeness, dead code removal, and error handling patches.

## Requirements
Fixes must resolve genuine gaps without introducing new bugs, changing behavior,
or adding unnecessary complexity. No feature additions, no refactoring, no style changes.

## Files to Review
{FOR_EACH_PRIMARY}
- {PATH}
{END_FOR}

## Review Checklist

**Correctness:**
- Do fixes resolve the reported gaps without introducing new bugs?
- Are all imports still valid?
- Do type signatures still match callers/callees?
- Are tests still passing (no behavioral changes)?

**No Scope Creep:**
- Were any new features added? (REJECT)
- Was code refactored beyond the gap fix? (REJECT)
- Were unnecessary docstrings/comments added? (REJECT)

**Consistency:**
- Do fixes follow project coding conventions?
- Are naming patterns consistent with surrounding code?

## Output Format

### Issues Found
For each issue: file:line | severity (Critical/Important/Minor) | description | fix

### Assessment
**Fixes correct?** [Yes / Yes with issues / No — revert needed]
```

**After review returns:**
- **Critical issues** → fix immediately
- **Important issues** → fix before proceeding
- **Minor issues** → note, proceed
- **Clean** → proceed

### Step 4 — Decide: loop or stop

- **If any gaps were found and fixed** → `/compact` and let Ralph loop again
- **If zero gaps found across all agents** → Output: `<promise>NO GAPS REMAINING</promise>`

## Rules

- **DO NOT add features or refactor.** You are fixing gaps, not improving code.
- **DO NOT change behavior** — fixes should be invisible to end users.
- **DO NOT add docstrings/comments** to code you didn't change for other reasons.
- **Preserve existing tests** — fix tests only if they test the wrong interface.
- **Each iteration should fix ALL gaps found in that pass**, not just one.
- **Be specific** — include file:line, exact strings, not vague summaries.
````

---

#### Plan Template

````markdown
# {PLAN_NAME} Plan Gap Scanner — Ralph Loop Prompt

> **Usage:** `/ralph-loop:ralph-loop "{TARGET_DIR}/loop-gap.md" --max-iterations 50 --completion-promise "NO GAPS REMAINING"`

You are an iterative plan-quality auditor. Each iteration, you spawn **one parallel Opus agent per plan file** to find gaps, then collect results and fix everything.

## Plan Directory

```
{TARGET_DIR}/
```

## Editable Files (one agent each)

| # | File | Agent Focus |
|---|------|-------------|
{FOR_EACH_EDITABLE_FILE}
| {N} | `{FILENAME}` | {FOCUS_DESCRIPTION} |
{END_FOR}

**Agent focus descriptions** — generate based on the file's role:
- Master plan → "Master checklist integrity — all tasks referenced, IDs match phase docs, checkpoint commands correct"
- Phase docs → "Phase N — tasks match master plan, test classes/files correct, dependency ordering"
- Spec docs → "Spec — model IDs, config fields, resolution limits match execution phase"
- UX/metadata → "UX/metadata — covers all models/pipelines, UI component names consistent"
- Other → Infer from filename and first ~50 lines of content

## Read-Only Reference Files (agents can read but NEVER edit)

```
{FOR_EACH_READONLY_FILE}
{FILEPATH}
{END_FOR}
```

## Gap Categories (every agent checks ALL of these for its file)

### 1. Cross-Reference Integrity
- Task IDs match between master/foundation and phase docs
- Test class names match between master and phase docs
- Test file paths match between master and phase docs
- pytest command strings target the correct file::class
- File lists match between master and phase docs
- Phase checkpoint commands cover all files in the phase

### 2. Internal Consistency
- Task numbering sequential, no gaps or duplicates
- Checklist items match tasks defined in same doc
- Every task has: checkbox, bold task number, description, Test line, Files line
- Test commands use valid pytest syntax
- No dangling references to nonexistent tasks/files/classes

### 3. Completeness
- Every phase doc task appears in master plan
- Every master plan task for a phase appears in that phase doc
- Phase checkpoints include test commands AND review scope
- Import paths reference modules that exist after prior tasks
- Rationale/Implementation present where non-obvious

### 4. Terminology & Naming
- Consistent terminology (follow existing conventions)
- Class names: PascalCase, descriptive
- Test classes start with `Test`
- File names: snake_case.py, kebab-case.svelte

### 5. Dependency & Ordering
- No forward references without dependency notes
- Phase ordering logical
- Task ordering within phase follows build sequence

### 6. Structural Quality
- No orphan tasks (in phase but not master)
- No phantom tasks (in master but not phase)
- Consistent markdown formatting
- No duplicate content

### 7. Contract & API Gaps
- Public interfaces consistent across all docs
- Method signatures match test references
- Config/settings fields consistent
- Event names/payloads consistent

## Procedure (follow EXACTLY each iteration)

### Step 1 — Spawn parallel agents

Use the **Task tool** to spawn one **Opus agent** (`model: "opus"`, `subagent_type: "general-purpose"`) per editable file ({N_EDITABLE} agents total). All in a **single message** for parallel execution.

Each agent's prompt MUST include:
1. Its primary file (the one it audits and can edit)
2. Full list of all other plan files (for cross-reference)
3. The 7 gap categories above
4. Instructions: read primary fully, read master for cross-ref, fix own file, report cross-file gaps, preserve checkboxes, no new tasks, no deletions

### Step 2 — Collect and apply fixes

After all agents return:
- Apply cross-file fixes agents couldn't make
- Compile summary of everything fixed

### Step 3 — Code review gate

If fixes were made, spawn a **single Opus review agent** (`model: "opus"`, `subagent_type: "superpowers:code-reviewer"`) with a prompt covering: what was fixed, files to review, correctness checklist (no new mismatches, sequential IDs, checkboxes preserved), no scope creep (no invented/deleted tasks, no edits to read-only files), consistency checks.

Handle review results: fix Critical/Important immediately, note Minor, proceed if clean.

### Step 4 — Decide: loop or stop

- **Gaps found and fixed** → `/compact`, loop again
- **Zero gaps across all agents** → `<promise>NO GAPS REMAINING</promise>`

## Rules

- **DO NOT invent new tasks or features.**
- **DO NOT delete tasks.**
- **DO NOT modify read-only reference files.**
- **Preserve checkbox states** (`[x]`/`[ ]`).
- **Prefer phase doc's version** when fixing mismatches.
- **Fix ALL gaps per pass**, not just one.
- **Be specific** — exact strings, not vague summaries.
````

---

### Step 5 — Execute the loop

After generating or updating the loop-gap file, immediately launch:

```
/ralph-loop:ralph-loop "{OUTPUT_PATH}" --max-iterations 50 --completion-promise "NO GAPS REMAINING"
```

**Report to user:**
- Fresh generation: "Generated `{OUTPUT_PATH}` — {N} editable files, {M} read-only refs. Starting gap scanner loop."
- Updated: "Updated `{OUTPUT_PATH}` — added {X} files, removed {Y}. Starting gap scanner loop."
- No changes: "`{OUTPUT_PATH}` is up to date ({N} files). Starting gap scanner loop."
