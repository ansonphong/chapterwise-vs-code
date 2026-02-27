# Tree View Context Menu — Master Plan

> **For Claude:** This is a Ralph Loop master plan. Read the Execution Rules below, then execute ALL unchecked tasks continuously.

## How to Start

Run this command to kick off Ralph Loop:

```
/ralph-loop:ralph-loop "Execute .claude/plans/tree-context-view/00-master-plan.md" --completion-promise "ALL TREE CONTEXT MENU TASKS COMPLETE" --max-iterations 40
```

**CRITICAL: The kickoff prompt MUST be a single short line referencing this file. Ralph reads all instructions from the file itself — NEVER put multi-line instructions in the kickoff prompt.**

---

## Execution Rules

**CRITICAL: Execute ALL tasks in one continuous run. NEVER stop between tasks.**

When Ralph reads this file, follow these rules:

1. **Execute ALL unchecked tasks in sequence** — start at the first `- [ ]` and do not stop until every task is `- [x]` or the completion promise is output.
2. **For each regular task:**
   - Read the stage file referenced for full details.
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

**Goal:** Wire up complete context menus for all tree node types, add missing operations (Add Field, Change Type, Duplicate, Cut/Paste, Trash, etc.), migrate to unified ordering system, and make the tree a first-class outliner.

**Architecture:** Build bottom-up — fix foundational bugs first, then migrate ordering, then new modules (trashManager, clipboardManager), then structureEditor operations, then package.json wiring, then extension.ts command handlers. Each stage is independently testable.

**Tech Stack:** TypeScript, VS Code Extension API, YAML library, Vitest for tests.

**Design doc:** `.claude/plans/2026-02-21-tree-view-context-menu-ux.md`

**Shared references:**
- `codebase-facts.md` — 51 codebase facts referenced by all stages
- `review-findings.md` — 5 rounds of review findings (R1-R5) with resolutions

**Key cross-cutting facts:**
- **Fact #1:** Lazy imports for `structureEditor`, `settingsManager`, etc.
- **Fact #14:** `npm run compile` is the canonical build command (esbuild, NOT `tsc --noEmit`)
- **Fact #45:** Default mode is "stacked" — menus must work in all views (not just Navigator)
- **Fact #48:** `reloadTreeIndex()` only reads cache. Disk-mutating ops MUST use `regenerateAndReload(wsRoot)`
- **Fact #47:** `inlineThisFile` must check `isPathWithinWorkspace()` before reading include targets

---

## Stage Dependencies

```
Stage 1 (Foundation)
  ├─→ Stage 2 (New Modules)
  ├─→ Stage 3 (StructureEditor Extensions) ── requires Stage 1
  ├─→ Stage 4 (Package.json Wiring) ── requires Stage 1 (pure JSON, parallel with 2-3)
  │
  Stage 2 + Stage 1 ─→ Stage 5 (Widen Existing Handlers)
  Stage 1 + 2 + 3 ──→ Stage 6 (New Command Handlers)
  Stage 2 + 6 ───────→ Stage 7 (Tree Provider + Missing Ops)
  All ───────────────→ Stage 8 (Integration Testing)
```

> **Execution order:** Serial 1→2→3→4→5→6→7→8 is the simplest safe ordering.

---

## Task Checklist

### Stage 1: Foundation — buildYamlPath Fix + Unified Ordering (`01-foundation.md`)

- [ ] **Task 0:** Fix buildYamlPath bug (duplicate 'children' segments)
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`
  - Files: `src/structureEditor.ts`, `src/structureEditor.test.ts`

- [ ] **Task 0.5:** Migrate to unified ordering system (index.codex.yaml array position)
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/orderingManager.test.ts && npm test && npm run compile`
  - Files: `src/orderingManager.ts`, `src/orderingManager.test.ts`, `src/indexGenerator.ts`, `src/structureEditor.ts`, `src/dragDropController.ts`, `src/extension.ts`, `src/indexParser.ts`, `package.json`

- [ ] **CHECKPOINT Stage 1:** Run tests + code review
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`
  - Review: Run `superpowers:requesting-code-review` for Stage 1 files against `01-foundation.md`
  - **Gate:** Do NOT proceed to Stage 2 until tests pass AND review is clean

### Stage 2: New Modules — TrashManager + ClipboardManager (`02-new-modules.md`)

- [ ] **Task 1:** Create TrashManager (`.chapterwise/trash/` system) + wire into removeFileFromIndex
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/trashManager.test.ts && npm test && npm run compile`
  - Files: `src/trashManager.ts`, `src/trashManager.test.ts`, `src/structureEditor.ts`

- [ ] **Task 2:** Create ClipboardManager (cut/paste state) + extend VS Code mock
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/clipboardManager.test.ts && npm test`
  - Files: `src/clipboardManager.ts`, `src/clipboardManager.test.ts`, `src/__mocks__/vscode.ts`

- [ ] **CHECKPOINT Stage 2:** Run tests + code review
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`
  - Review: Run `superpowers:requesting-code-review` for Stage 2 files against `02-new-modules.md`
  - **Gate:** Do NOT proceed to Stage 3 until tests pass AND review is clean

### Stage 3: StructureEditor Extensions — Field/Type/Tag/Duplicate/Extract (`03-structure-editor-extensions.md`)

- [ ] **Task 3:** Add field operations + metadata methods to CodexStructureEditor
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`
  - Files: `src/structureEditor.ts`, `src/structureEditor.test.ts`

- [ ] **Task 4:** Add duplicateNodeInDocument + extractNodeToFile
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts && npm test && npm run compile`
  - Files: `src/structureEditor.ts`, `src/structureEditor.test.ts`

- [ ] **CHECKPOINT Stage 3:** Run tests + code review
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`
  - Review: Run `superpowers:requesting-code-review` for Stage 3 files against `03-structure-editor-extensions.md`
  - **Gate:** Do NOT proceed to Stage 4 until tests pass AND review is clean

### Stage 4: Package.json Wiring — Commands + Menus + Keybindings (`04-package-json-wiring.md`)

- [ ] **Task 5:** Register 23 new commands in contributes.commands + fix command ID mismatch
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Files: `package.json`

- [ ] **Task 6:** Wire context menus for all node types (codexNode, indexNode, indexFile, indexFolder, fields, multi-select)
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Files: `package.json`

- [ ] **Task 7:** Add keybindings (sibling, rename, duplicate, cut/paste, delete→trash, migrate existing to regex scope)
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Files: `package.json`

- [ ] **CHECKPOINT Stage 4:** Run build + code review
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Review: Run `superpowers:requesting-code-review` for `package.json` against `04-package-json-wiring.md`
  - **Gate:** Do NOT proceed to Stage 5 until build passes AND review is clean

### Stage 5: Command Handlers — Widen Existing (`05-widen-existing-handlers.md`)

- [ ] **Task 8:** Widen all existing command handlers to accept IndexNodeTreeItem (addChild, addSibling, rename, goToYaml, copyId, moveUp/Down, removeNode, deleteNodePermanently) + register backward-compat alias
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Files: `src/extension.ts`

- [ ] **CHECKPOINT Stage 5:** Run build + code review
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Review: Run `superpowers:requesting-code-review` for `src/extension.ts` against `05-widen-existing-handlers.md`
  - **Gate:** Do NOT proceed to Stage 6 until build passes AND review is clean

### Stage 6: Command Handlers — New Operations (`06-new-command-handlers.md`)

- [ ] **Task 9:** Register field/type/tag/icon command handlers (addField, changeType, changeIcon, addTags, addRelation, deleteField, renameField, copyPath, openInFinder)
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Files: `src/extension.ts`

- [ ] **Task 10:** Register trash, duplicate, cut/paste, extract, folder commands (moveToTrash, duplicateNode, cutNode, pasteNodeAsChild, pasteNodeAsSibling, restoreFromTrash, emptyTrash, extractToFile, addChildFile, renameFolder)
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Files: `src/extension.ts`

- [ ] **CHECKPOINT Stage 6:** Run build + code review
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`
  - Review: Run `superpowers:requesting-code-review` for `src/extension.ts` against `06-new-command-handlers.md`
  - **Gate:** Do NOT proceed to Stage 7 until tests+build pass AND review is clean

### Stage 7: Tree Provider + Missing Ops (`07-tree-provider-and-missing-ops.md`)

- [ ] **Task 11:** TreeProvider — cut indicator + ClipboardManager integration
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Files: `src/treeProvider.ts`, `src/extension.ts`

- [ ] **Task 12:** Missing operations — inlineThisFile, addChildFolder, multi-select batch ops
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
  - Files: `src/structureEditor.ts`, `src/extension.ts`, `package.json`

- [ ] **CHECKPOINT Stage 7:** Run build + code review
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`
  - Review: Run `superpowers:requesting-code-review` for Stage 7 files against `07-tree-provider-and-missing-ops.md`
  - **Gate:** Do NOT proceed to Stage 8 until tests+build pass AND review is clean

### Stage 8: Integration Testing & Polish (`08-integration-testing.md`)

- [ ] **Task 13:** Run automated tests + full manual test matrix (F5 Extension Development Host)
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`
  - Files: All modified files

- [ ] **FINAL CHECKPOINT:** Full test suite + final code review
  - Test: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`
  - Review: Run `superpowers:requesting-code-review` for ALL changed files across entire feature
  - **Gate:** ALL tests must pass AND review must be 100% clean

- [ ] **Task 14:** Output completion promise
  - When ALL tasks AND ALL checkpoints pass: `<promise>ALL TREE CONTEXT MENU TASKS COMPLETE</promise>`

---

## Files Reference

| Source File | Stages That Modify It |
|-------------|----------------------|
| `src/structureEditor.ts` | 1, 2, 3, 7 |
| `src/orderingManager.ts` (new) | 1 |
| `src/trashManager.ts` (new) | 2 |
| `src/clipboardManager.ts` (new) | 2 |
| `src/indexGenerator.ts` | 1 |
| `src/dragDropController.ts` | 1 |
| `src/extension.ts` | 1, 5, 6, 7 |
| `src/treeProvider.ts` | 7 |
| `package.json` | 1, 4, 7 |
| `src/__mocks__/vscode.ts` | 2 |
| `src/indexParser.ts` | 1 |

---

## Execution Notes

- **Git identity:** `Phong <phong@phong.com>`
- **Branch:** Stay on current branch (`master`) — NEVER switch branches
- **Each task:** TDD where applicable (write failing test → implement → verify → commit)
- **Stage gates:** Tests + code review must BOTH pass before crossing stage boundary
- **Stage dependencies:** Serial 1→2→3→4→5→6→7→8
- **NEVER STOP:** Execute all tasks continuously. Only stop for truly impossible blockers.
- **Build command:** `npm run compile` (esbuild, Fact #14). NOT `tsc --noEmit`.
- **Test command:** `npm test` (vitest)
- **Lazy imports:** Always use `const { X } = await import('./module')` pattern (Fact #1)
- **Reload strategy:** YAML-only edits → `reloadTreeIndex()`. Disk mutations → `regenerateAndReload(wsRoot)` (Fact #48)
