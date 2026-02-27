# Stage 8: Integration Testing & Polish

> **Master plan:** `00-master-plan.md` — execute via Ralph Loop
>
> **Shared reference:** See `codebase-facts.md` for all codebase facts.
> **Prerequisites:** All previous stages complete.

**Goal:** Run all tests, verify build, test every context menu operation in VS Code, fix any issues.

**Architecture:** Automated test suite first, then manual test matrix in Extension Development Host (F5).

---

## Task 13: Automated Tests + Manual Testing

**Files:**
- All modified files

### Step 1: Run all tests

Run: `cd /Users/phong/Projects/chapterwise-codex && npm test`
Expected: All PASS

### Step 2: Build the extension

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`
Expected: No errors

### Step 3: Manual test matrix (F5 Extension Development Host)

Open a project with `.codex.yaml` files and test EACH node type:

**codexNode (FILES mode):**
- [ ] Right-click → verify full menu appears (in Navigator, Master, AND stacked Index views)
- [ ] Add Child → creates inline child
- [ ] Add Sibling → creates inline sibling
- [ ] Add Field → QuickPick shows, field added to YAML
- [ ] Rename → InputBox, name updated
- [ ] Change Type → QuickPick, type updated, icon changes
- [ ] Change Icon/Emoji → emoji set
- [ ] Add Tags → comma input, tags added
- [ ] Add Relation → two-step QuickPick, relation added
- [ ] Cut → node shows "(cut)" indicator
- [ ] Paste as Child / Paste as Sibling → node moves
- [ ] Go to YAML → editor opens at correct line
- [ ] Copy ID → ID in clipboard
- [ ] Duplicate → copy created with new ID, "(copy)" suffix
- [ ] Extract to File → new file created, `includePath` directive inserted (Fact #34)
- [ ] Inline This File → on include-reference node, content inlined, optional original deletion
- [ ] Move to Trash → node removed, in `.chapterwise/trash/`
- [ ] Delete Permanently → node gone
- [ ] Verify Move Up/Down NOT in codexNode menu (Fact #46 — removed in Stage 4)

**indexNode (INDEX mode, entity in file):**
- [ ] Right-click → verify correct menu
- [ ] Add Child / Add Sibling → inline operations in backing file
- [ ] Add Field → QuickPick shows, field added to backing file
- [ ] Rename → InputBox, name updated in backing file
- [ ] Change Type → QuickPick, type updated in backing file
- [ ] Change Icon/Emoji → emoji set in backing file
- [ ] Add Tags → comma input, tags added in backing file
- [ ] Add Relation → two-step QuickPick, relation added in backing file
- [ ] Move Up/Down → node reorders within backing file
- [ ] Cut → node shows "(cut)" indicator
- [ ] Paste as Child / Paste as Sibling → node moves within document
- [ ] Go to YAML → opens correct file at correct line
- [ ] Copy ID → ID in clipboard
- [ ] Duplicate → inline copy with new UUIDs
- [ ] Move to Trash → removed from backing file
- [ ] Delete Permanently → permanently removed from backing file

**indexFile (INDEX mode, file-backed):**
- [ ] Right-click → verify correct menu
- [ ] Add Child → opens file, adds child to root
- [ ] Add Sibling → creates new sibling file
- [ ] Add Field → QuickPick shows, field added to file root node
- [ ] Rename → renames file on disk, updates include paths (via `renameFileInIndex`)
- [ ] Change Type → QuickPick, type updated on file root node
- [ ] Change Icon/Emoji → emoji set on file root node
- [ ] Add Tags → comma input, tags added to file root node
- [ ] Move Up/Down → reorders in index.codex.yaml
- [ ] Cut → node shows "(cut)" indicator
- [ ] Paste as Child → paste into file
- [ ] Paste as Sibling → creates sibling file next to this one
- [ ] Copy Path → file path in clipboard
- [ ] Open in Finder → Finder opens (or OS-native file manager)
- [ ] Duplicate → file copied on disk with regenerated IDs
- [ ] Move to Trash → file in `.chapterwise/trash/`, index updated via `regenerateAndReload`
- [ ] Delete Permanently → file gone, index updated via `regenerateAndReload`

**indexFolder (INDEX mode):**
- [ ] Right-click → verify correct menu
- [ ] Add File (`addChildFile`) → new .codex.yaml in folder
- [ ] New Subfolder (`addChildFolder`) → directory created, index updated
- [ ] Rename Folder (`renameFolder`) → folder renamed on disk
- [ ] Open in Finder → Finder opens (or OS-native file manager)
- [ ] Move to Trash → folder in `.chapterwise/trash/`, index updated via `regenerateAndReload`

**codexField / indexField:**
- [ ] Rename Field → field key renamed in YAML
- [ ] Go to YAML → opens at field location
- [ ] Delete Field → field removed

**Trash operations:**
- [ ] Trash a file → verify index regenerated (no stale tree entries)
- [ ] Restore from Trash → file back, index picks it up
- [ ] Empty Trash → `.chapterwise/trash/` deleted

**Cross-cutting:**
- [ ] Cut + Paste inline nodes → correct document manipulation
- [ ] Cut + Paste file-backed nodes → file moved, index updated
- [ ] Keyboard shortcuts: Delete=moveToTrash, Shift+Delete=deleteNodePermanently, Cmd+D=duplicateNode, Cmd+X=cutNode, Cmd+V=pasteNodeAsChild, F2=renameNode, Cmd+N=addSiblingNode
- [ ] Keyboard shortcuts work in Navigator, Master, AND stacked Index views (scoped via `focusedView =~ /^chapterwiseCodex/`)
- [ ] Multi-select works in stacked views (Master + Index0-7 have `canSelectMany: true`)
- [ ] `regenerateAndReload()` refreshes stacked views — no stale data in Index0-7 after file ops
- [ ] Multi-select → batch trash (`batchMoveToTrash`), batch add tags (`batchAddTags`)
- [ ] Multi-select batch tags uses single prompt (not per-item re-prompt)
- [ ] Index regeneration → tree updates after every file-mutating operation (uses `regenerateAndReload`)
- [ ] YAML-only edits (add field, change type, etc.) use `reloadTreeIndex()` — no stale data
- [ ] Stacked mode (default) → verify context menus appear on codexNode/codexField in Index0-7 views
- [ ] Backward-compat alias: `navigateToNodeInCodeView` still works (delegates to `navigateToEntityInCodeView`)

### Step 4: Fix any issues found

### Step 5: Final commit

```bash
# Stage only files modified during integration fixes — avoid git add -A which risks
# committing unrelated changes (gap-audit low #3)
git add src/extension.ts src/treeProvider.ts src/structureEditor.ts package.json
# Add any other files touched during polish — review `git status` before committing
git commit -m "polish: fix issues found during integration testing of tree context menus"
```

---

## Stage 8 Completion Checklist

- [ ] `npm test` — all PASS
- [ ] `npm run compile` — no errors
- [ ] codexNode full menu tested
- [ ] indexNode full menu tested
- [ ] indexFile full menu tested
- [ ] indexFolder menu tested
- [ ] codexField/indexField menu tested
- [ ] Trash operations (trash/restore/empty) tested
- [ ] Cut/paste operations tested
- [ ] Keyboard shortcuts tested
- [ ] Multi-select batch operations tested
- [ ] Index regeneration verified after every file mutation
- [ ] No console errors in Extension Development Host
- [ ] All changes committed

---

## Full Project Complete

When Stage 8 passes, the tree view context menu feature is complete:
- **8 stages**, **6 new files**, multiple modified files
- All 5 review rounds addressed
- Cross-platform alignment with native app
- Complete CRUD operations via context menus
- Unified ordering system (index.codex.yaml)
- Project-level trash with restore
- Cut/paste with visual indicator
- Multi-select batch operations
