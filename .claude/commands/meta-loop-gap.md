# /meta-loop-gap — Generate & Run Gap Scanner for Any Scope

Generate a `loop-gap.md` Ralph Loop prompt for any scope — plan directories, code features, specific paths, or the whole project — then execute it. If one already exists, update it with any new/removed files and run it.

## Usage

```
# Plan directories (scan plan .md files for cross-reference consistency)
/meta-loop-gap .claude/plans/vace
/meta-loop-gap .claude/plans/new-image-pipelines

# Code features (scan source code for a specific feature area)
/meta-loop-gap feature:licensing
/meta-loop-gap feature:sequences
/meta-loop-gap feature:templates

# Specific code paths (scan specific directories/files)
/meta-loop-gap backend/processors/
/meta-loop-gap backend/sequences/tweeners/ backend/sequences/workflows/
/meta-loop-gap frontend/src/lib/components/sequences/

# Whole project (broad sweep)
/meta-loop-gap project
```

## Instructions

### Step 0 — Detect scan mode

Parse the arguments to determine which mode to use:

| Argument Pattern | Mode | Description |
|-----------------|------|-------------|
| Path inside `.claude/plans/` or directory containing only `.md` files | **plan** | Scan plan docs for cross-reference consistency |
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

Collect all `.py`, `.ts`, `.svelte` files in those directories. Also include related plan files if they exist (`.claude/plans/*{feature}*`).

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
| **Primary source** | Implementation files (`.py`, `.ts`, `.svelte`, `.rs`) — one agent per file or per module |
| **Test files** | Files in `tests/` directories — agents can read for context but focus is on source |
| **Config/reference** | `__init__.py`, config files, type definitions — read-only context |

**Grouping for agents:** If there are more than 15 source files, group them by module/directory (one agent per directory instead of per file). If fewer than 15, one agent per file.

**Always exclude:** `loop-gap.md`, `gap-scanner.md`, `__pycache__/`, `node_modules/`, `.venv/`, `venv/`.

### Step 3 — Check for existing loop-gap file

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

### Step 4 — Generate the loop-gap file

Use the appropriate template based on mode:

---

#### Plan Mode Template

Use the same template structure as `/loop-gap` — plan-focused gap categories (cross-reference integrity, task IDs, test class names, pytest commands, completeness, terminology, dependency ordering, structural quality, contract/API gaps). Refer to existing `loop-gap.md` files in plan directories for the exact format.

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
- Dependencies flow in the right direction (services → core, not core → services)

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
- No misleading names (function named `get_X` that also modifies state)

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

**Filling the placeholders:**

- `{SCOPE_NAME}` — Derive from arguments: directory name title-cased, feature name, or "Full Project"
- `{OUTPUT_PATH}` — The loop-gap file location from Step 3
- `{SCOPE_DESCRIPTION}` — Brief description of what's being scanned
- `{N_PRIMARY}` — Count of primary files/modules
- `{FOR_EACH_PRIMARY}` — One row per primary file/module
- `{FOR_EACH_CONTEXT_FILE}` — One entry per context/reference file
- `{FOCUS_DESCRIPTION}` — Infer from file role (read first ~50 lines if unclear)

### Step 5 — Execute the loop

After generating or updating the loop-gap file, immediately launch:

```
/ralph-loop:ralph-loop "{OUTPUT_PATH}" --max-iterations 50 --completion-promise "NO GAPS REMAINING"
```

**Report to user:**
- Fresh: "Generated `{OUTPUT_PATH}` — {N} files/modules, {M} context refs. Starting gap scanner loop."
- Updated: "Updated `{OUTPUT_PATH}` — added {X}, removed {Y}. Starting gap scanner loop."
- No changes: "`{OUTPUT_PATH}` up to date ({N} files). Starting gap scanner loop."
