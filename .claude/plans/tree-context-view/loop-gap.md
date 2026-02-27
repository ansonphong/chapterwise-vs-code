# Tree Context View Plan Gap Scanner — Ralph Loop Prompt

> **Usage:** `/ralph-loop:ralph-loop ".claude/plans/tree-context-view/loop-gap.md" --max-iterations 50 --completion-promise "NO GAPS REMAINING"`

You are an iterative plan-quality auditor. Each iteration, you spawn **one parallel Opus agent per plan file** to find gaps, then collect results and fix everything.

## Plan Directory

```
.claude/plans/tree-context-view/
```

## Editable Files (one agent each)

| # | File | Agent Focus |
|---|------|-------------|
| 1 | `00-master-plan.md` | Master checklist integrity — all tasks referenced, IDs match phase docs, checkpoint commands correct, stage dependencies accurate |
| 2 | `01-foundation.md` | Stage 1 — buildYamlPath fix + ordering migration tasks match master plan, test classes/files correct, dependency ordering, all ordering-dependent functions covered |
| 3 | `02-new-modules.md` | Stage 2 — TrashManager + ClipboardManager tasks match master plan, test classes correct, integration with structureEditor specified |
| 4 | `03-structure-editor-extensions.md` | Stage 3 — field/type/tag/duplicate/extract ops match master plan, method signatures consistent with codebase-facts, test coverage complete |
| 5 | `04-package-json-wiring.md` | Stage 4 — commands/menus/keybindings match master plan, view scope correct (Fact #45 stacked mode), command IDs consistent |
| 6 | `05-widen-existing-handlers.md` | Stage 5 — handler widening tasks match master plan, resolveIndexNodeForEdit usage correct, reload strategy per Fact #48 |
| 7 | `06-new-command-handlers.md` | Stage 6 — new command tasks match master plan, lazy imports (Fact #1), reload strategy correct, no raw trashManager for file-level ops |
| 8 | `07-tree-provider-and-missing-ops.md` | Stage 7 — tree provider integration + missing ops match master plan, security checks (Fact #47), multi-select signature correct |
| 9 | `08-integration-testing.md` | Stage 8 — test matrix covers all operations from stages 1-7, manual test items match actual commands, completion criteria realistic |
| 10 | `codebase-facts.md` | Codebase facts — all facts referenced by stage plans exist, no orphan facts, no contradictions between facts, fact numbers sequential |
| 11 | `review-findings.md` | Review findings — all findings have resolutions, resolution stages match actual stage plans, no unresolved high-severity findings |

## Read-Only Reference Files (agents can read but NEVER edit)

```
.claude/plans/tree-context-view/gap-audit-2026-02-22.md
```

## Gap Categories (every agent checks ALL of these for its file)

### 1. Cross-Reference Integrity
- Task IDs match between master/foundation and phase docs
- Test class names match between master and phase docs
- Test file paths match between master and phase docs
- pytest/vitest command strings target the correct file::class
- File lists match between master and phase docs
- Phase checkpoint commands cover all files in the phase
- Review finding references (R1-x, R2-x, etc.) match actual findings in review-findings.md

### 2. Internal Consistency
- Task numbering sequential, no gaps or duplicates
- Checklist items match tasks defined in same doc
- Every task has: checkbox, bold task number, description, Test line, Files line
- Test commands use valid vitest syntax
- No dangling references to nonexistent tasks/files/classes
- Codebase fact numbers referenced actually exist in codebase-facts.md

### 3. Completeness
- Every phase doc task appears in master plan
- Every master plan task for a phase appears in that phase doc
- Phase checkpoints include test commands AND review scope
- Import paths reference modules that exist after prior tasks
- Rationale/Implementation present where non-obvious
- All gap-audit findings (gap-audit-2026-02-22.md) have been addressed in plans

### 4. Terminology & Naming
- Consistent terminology (follow existing conventions)
- Class names: PascalCase, descriptive
- Test classes start with `describe`
- File names: camelCase.ts for source, camelCase.test.ts for tests
- Command IDs: `chapterwiseCodex.camelCase`

### 5. Dependency & Ordering
- No forward references without dependency notes
- Phase ordering logical (Stage 1 before 2 before 3...)
- Task ordering within phase follows build sequence
- Prerequisites listed match actual dependencies

### 6. Structural Quality
- No orphan tasks (in phase but not master)
- No phantom tasks (in master but not phase)
- Consistent markdown formatting
- No duplicate content between stage files
- Code snippets are syntactically valid TypeScript

### 7. Contract & API Gaps
- Public interfaces consistent across all docs
- Method signatures match test references
- Config/settings fields consistent
- Event names/payloads consistent
- Facts about API patterns (lazy imports, buildYamlPath, etc.) consistently applied in all stage snippets

## Procedure (follow EXACTLY each iteration)

### Step 1 — Spawn parallel agents

Use the **Task tool** to spawn one **Opus agent** (`model: "opus"`, `subagent_type: "general-purpose"`) per editable file (11 agents total). All in a **single message** for parallel execution.

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
