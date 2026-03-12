# Tree Provider Context State Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three original context-state bugs plus three gap-analysis findings (6 total) in `CodexTreeProvider`.

**Architecture:** Remove the legacy `workspaceRoot`/`contextFolder` fields entirely — route all reads through `currentContext`. Fix the `onDidChangeTextDocument` watcher to dispatch by file type (index vs codex). Clear `activeDocument` in `setContextFolder` so stale file edits can't knock the tree out of index mode. Widen the `setActiveDocument` guard to accept index files. Use `'.'` (not `null`) for workspace-root index context so `getIndexChildren` can always resolve a path. Fix `setContextFolder(null, wsRoot)` reset to actually load the root index. Clear stale `contextFolder` in `setActiveDocument` when switching to a non-index file.

**Tech Stack:** VS Code Extension API, TypeScript

---

## Task 1: Remove legacy fields, unify on `currentContext`

**Files:**
- Modify: `src/treeProvider.ts:604-615` (field declarations)
- Modify: `src/treeProvider.ts:866-951` (`setContextFolder`)
- Modify: `src/treeProvider.ts:956-958` (`getContextFolder`)
- Modify: `src/treeProvider.ts:1249-1256` (`getIndexChildren`)

**Step 1: Delete legacy field declarations and update comments**

In `src/treeProvider.ts`, remove lines 614-615:

```typescript
// REMOVE these two lines:
private contextFolder: string | null = null;     // Context folder path (kept for backward compatibility)
private workspaceRoot: string | null = null;     // Workspace root (kept for backward compatibility)
```

**Step 2: Update `setContextFolder` to only write `currentContext`**

Replace all `this.contextFolder = X` and `this.workspaceRoot = X` with `this.currentContext.contextFolder = X` / `this.currentContext.workspaceRoot = X`. Specifically:

- Line 881: `this.contextFolder = folderPath;` → remove (already written at line 879)
- Line 882: `this.workspaceRoot = workspaceRoot;` → remove (already written at line 878)
- Line 935: `this.contextFolder = null;` → remove (already written at line 937)
- Line 936: `this.workspaceRoot = null;` → remove (already written at line 938)

**Step 3: Update `getContextFolder` to read from `currentContext`**

```typescript
getContextFolder(): string | null {
  return this.currentContext.contextFolder;
}
```

**Step 4: Update `getIndexChildren` to read from `currentContext`**

Replace lines 1249-1253. Note: `contextFolder` is now always `'.'` for workspace root (never `null` when in index mode), so the null check is still valid as a "not-yet-initialized" guard:

```typescript
// Old:
if (!this.workspaceRoot || !this.contextFolder) {
  log('[TreeProvider] getIndexChildren: Missing workspaceRoot or contextFolder');
  return [];
}
const workspaceRoot = this.workspaceRoot;

// New:
if (!this.currentContext.workspaceRoot || !this.currentContext.contextFolder) {
  log('[TreeProvider] getIndexChildren: Missing workspaceRoot or contextFolder');
  return [];
}
const workspaceRoot = this.currentContext.workspaceRoot;
```

Replace line 1256:

```typescript
// Old:
const indexPath = path.join(workspaceRoot, this.contextFolder, '.index.codex.json');
// New:
const indexPath = path.join(workspaceRoot, this.currentContext.contextFolder!, '.index.codex.json');
```

**Step 5: Update log lines in `setContextFolder` that read legacy fields**

- Line 870: `this.contextFolder || 'none'` → `this.currentContext.contextFolder || 'none'`
- Line 871: `this.workspaceRoot || 'none'` → `this.currentContext.workspaceRoot || 'none'`

**Step 6: Compile**

Run: `npm run compile`
Expected: Clean build with no errors

**Step 7: Run tests**

Run: `npm test`
Expected: All 81 tests pass

**Step 8: Commit**

```bash
git add src/treeProvider.ts
git commit -m "refactor: unify context state — remove legacy workspaceRoot/contextFolder fields

Route all reads through currentContext. Removes the split-state bug where
setActiveDocument updated currentContext but getIndexChildren/getContextFolder
still read the legacy fields.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Fix `onDidChangeTextDocument` to dispatch by file type

**Files:**
- Modify: `src/treeProvider.ts:700-711` (constructor watcher)

**Step 1: Replace the watcher body**

Old (lines 701-710):

```typescript
this.disposables.push(
  vscode.workspace.onDidChangeTextDocument((e) => {
    try {
      if (this.activeDocument && e.document.uri.toString() === this.activeDocument.uri.toString()) {
        this.updateCodexDoc();
      }
    } catch (error) {
      console.error('[ChapterWise] Error in onDidChangeTextDocument:', error);
    }
  })
);
```

New:

```typescript
this.disposables.push(
  vscode.workspace.onDidChangeTextDocument((e) => {
    try {
      if (this.activeDocument && e.document.uri.toString() === this.activeDocument.uri.toString()) {
        if (isIndexFile(this.activeDocument.fileName)) {
          this.updateIndexDoc();
        } else {
          this.updateCodexDoc();
        }
      }
    } catch (error) {
      console.error('[ChapterWise] Error in onDidChangeTextDocument:', error);
    }
  })
);
```

**Step 2: Compile**

Run: `npm run compile`
Expected: Clean build

**Step 3: Commit**

```bash
git add src/treeProvider.ts
git commit -m "fix: dispatch document-change watcher by file type

Index files now route to updateIndexDoc() instead of updateCodexDoc().
Prevents editing .index.codex.json from corrupting the index tree by
parsing JSON through the YAML/codex parser and clearing indexDoc.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Clear stale `activeDocument` in `setContextFolder`

**Files:**
- Modify: `src/treeProvider.ts:866-951` (`setContextFolder`)

**Step 1: Add `activeDocument = null` after context update**

After line 879 (`this.currentContext.contextFolder = folderPath;`), insert:

```typescript
// Clear stale activeDocument so the onDidChangeTextDocument watcher
// won't reparse the old file and yank the tree out of index mode
this.activeDocument = null;
this.codexDoc = null;
```

**Step 2: Compile and test**

Run: `npm run compile && npm test`
Expected: Clean build, all tests pass

**Step 3: Commit**

```bash
git add src/treeProvider.ts
git commit -m "fix: clear activeDocument when entering folder context

Prevents stale document-change watcher from calling updateCodexDoc()
on the previously-tracked file, which would clear indexDoc and yank
the navigator out of index mode.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Widen `setActiveDocument` guard and fix explicit-context for Switch to Index Mode

**Files:**
- Modify: `src/treeProvider.ts:746-749` (`setActiveDocument` guard)
- Modify: `src/extension.ts:2659` (`switchToIndexMode` command)

**Step 1: Update the guard to accept index files**

Old:

```typescript
if (!isCodexLikeFile(document.fileName)) {
  return;
}
```

New:

```typescript
if (!isCodexLikeFile(document.fileName) && !isIndexFile(document.fileName)) {
  return;
}
```

**Step 2: Fix `switchToIndexMode` to pass `explicit=true` and reinitialize search**

The command at extension.ts:2659 calls `setActiveDocument(doc)` without `explicit=true`. Since `setActiveDocument` blocks non-explicit context switches until `contextExplicitlySet` is already true (line 752), the root index auto-open silently fails on first use.

Also, `setActiveDocument` never calls `initializeForContext()` — that only lives in `setContextFolder`. So after opening the root index via Switch to Index Mode, search stays scoped to the old folder (or shows "Set a context folder first").

Old (extension.ts:2656-2659):

```typescript
const indexPath = path.join(workspaceRoot.uri.fsPath, '.index.codex.json');
if (fs.existsSync(indexPath)) {
  const doc = await vscode.workspace.openTextDocument(indexPath);
  treeProvider.setActiveDocument(doc);
}
```

New:

```typescript
const indexPath = path.join(workspaceRoot.uri.fsPath, '.index.codex.json');
if (fs.existsSync(indexPath)) {
  const doc = await vscode.workspace.openTextDocument(indexPath);
  treeProvider.setActiveDocument(doc, true);

  // Reinitialize search for workspace root (setActiveDocument doesn't do this)
  const searchManager = getSearchIndexManager();
  if (searchManager) {
    searchManager.initializeForContext('.', workspaceRoot.uri.fsPath);
  }
}
```

**Step 3: Compile and test**

Run: `npm run compile && npm test`
Expected: Clean build, all tests pass

**Step 4: Commit**

```bash
git add src/treeProvider.ts src/extension.ts
git commit -m "fix: allow index files through setActiveDocument guard + explicit context

isCodexLikeFile only matches .codex/.md files — index files
(.index.codex.json) were silently rejected. Now explicitly allowed.
Also fix switchToIndexMode to pass explicit=true so the root index
auto-open works even on first use.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Use `'.'` instead of `null` for workspace-root index context

**Why:** When opening a root-level `.index.codex.json`, `setActiveDocument` computes `indexFolder = '.'` then converts to `null` via `indexFolder === '.' ? null : indexFolder`. But `getIndexChildren` requires non-null `contextFolder` to build the index path. This means root-level index mode renders an empty tree.

**Files:**
- Modify: `src/treeProvider.ts:764-768` (`setActiveDocument` index-folder extraction)

**Step 1: Stop converting `'.'` to `null`**

Old (line 768):

```typescript
this.currentContext.contextFolder = indexFolder === '.' ? null : indexFolder;
```

New:

```typescript
this.currentContext.contextFolder = indexFolder;
```

Now `contextFolder = '.'` for workspace-root indexes, which `path.join(root, '.', filename)` resolves correctly.

**Step 2: Compile and test**

Run: `npm run compile && npm test`
Expected: Clean build, all tests pass

**Step 3: Commit**

```bash
git add src/treeProvider.ts
git commit -m "fix: use '.' for workspace-root index context instead of null

getIndexChildren requires non-null contextFolder to build the index
path. Root-level .index.codex.json was setting contextFolder to null,
causing an empty tree. Now uses '.' which path.join handles correctly.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Fix `setContextFolder(null, wsRoot)` reset to load root index

**Why:** `resetContext` command (extension.ts:2900) calls `setContextFolder(null, wsRoot)` with comment "Stay in INDEX mode but show workspace root." But the null branch clears both `workspaceRoot` and `contextFolder`, doesn't load any index, and leaves the tree empty.

**Files:**
- Modify: `src/treeProvider.ts:933-941` (`setContextFolder` null/reset branch)

**Step 1: Replace the null branch**

Old (lines 933-941):

```typescript
} else {
  // Reset to workspace root or FILES mode
  this.contextFolder = null;
  this.workspaceRoot = null;
  this.currentContext.contextFolder = null;
  this.currentContext.workspaceRoot = null;
  this.isLoading = false;
  this.loadingMessage = null;
  this.refresh();
}
```

New (after Task 1 removes legacy fields):

```typescript
} else {
  // Reset to workspace root — load root-level index if it exists
  this.currentContext.contextFolder = '.';
  this.currentContext.workspaceRoot = workspaceRoot;
  this.activeDocument = null;
  this.codexDoc = null;

  const rootIndexPath = path.join(workspaceRoot, '.index.codex.json');
  if (fs.existsSync(rootIndexPath)) {
    try {
      const indexContent = fs.readFileSync(rootIndexPath, 'utf-8');
      this.indexDoc = parseIndexFileJSON(indexContent);
      this.isIndexMode = true;
    } catch (error) {
      log(`[TreeProvider] Error loading root index: ${error}`);
      this.indexDoc = null;
      this.isIndexMode = false;
    }
  } else {
    this.indexDoc = null;
    this.isIndexMode = false;
  }

  this.isLoading = false;
  this.loadingMessage = null;
  this.refresh();
}
```

**Also:** The search-index reinitialization at the bottom of `setContextFolder` (line 945) only runs when `folderPath` is truthy. Since `null` is falsy, search stays scoped to the old folder after reset. Move the search init **inside** the new else branch so it reinitializes for `'.'`:

After `this.refresh();` in the else branch above, add:

```typescript
// Reinitialize search for workspace root
const searchManager = getSearchIndexManager();
if (searchManager) {
  searchManager.initializeForContext('.', workspaceRoot);
}
```

And update the existing search block (line 944-950) to only run in the `if (folderPath)` branch (which it already does — the guard `if (folderPath)` at line 945 is correct for the truthy branch, but note it now won't fire for the null/reset path since we handle that above).

**Step 2: Compile and test**

Run: `npm run compile && npm test`
Expected: Clean build, all tests pass

**Step 3: Commit**

```bash
git add src/treeProvider.ts
git commit -m "fix: resetContext now loads workspace-root index

setContextFolder(null, wsRoot) previously cleared all state and left
the tree empty. Now sets contextFolder='.', keeps workspaceRoot, and
loads .index.codex.json from the workspace root if it exists.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Clear stale `contextFolder` when switching to a non-index file

**Why:** `setActiveDocument` only writes `contextFolder` for index files (line 765-768). When switching from folder context to a regular `.codex.yaml`, the old `contextFolder` persists. Then `reloadTreeIndex()`/`regenerateAndReload()` call `getContextFolder()` and target the wrong scope.

**Files:**
- Modify: `src/treeProvider.ts:759-770` (`setActiveDocument` context update block)

**Step 1: Add else branch to clear contextFolder for non-index files**

Old (lines 764-769):

```typescript
// If opening an index file, extract the context folder from its path
if (isIndexFile(document.fileName)) {
  const relativePath = path.relative(workspaceFolder.uri.fsPath, document.fileName);
  const indexFolder = path.dirname(relativePath);
  this.currentContext.contextFolder = indexFolder;
}
```

New:

```typescript
if (isIndexFile(document.fileName)) {
  // Extract context folder from index file path
  const relativePath = path.relative(workspaceFolder.uri.fsPath, document.fileName);
  const indexFolder = path.dirname(relativePath);
  this.currentContext.contextFolder = indexFolder;
} else {
  // Switching to a regular file — clear folder context so
  // reloadTreeIndex/regenerateAndReload don't target the old folder
  this.currentContext.contextFolder = null;
}
```

**Step 2: Compile and test**

Run: `npm run compile && npm test`
Expected: Clean build, all tests pass

**Step 3: Commit**

```bash
git add src/treeProvider.ts
git commit -m "fix: clear contextFolder when switching to non-index file

Prevents reloadTreeIndex/regenerateAndReload from targeting the
previous folder context after user switches to a regular .codex.yaml.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Manual transition testing

After all code changes, verify these transitions work:

**Test 1:** Set folder context, then edit the previously open `.codex.yaml`
- Expected: Editing the old file does NOT knock the tree out of index mode (because `activeDocument` was cleared)

**Test 2:** Open workspace-root `.index.codex.json` directly via "Switch to Index Mode"
- Expected: The file passes the `setActiveDocument` guard, `contextFolder` is `'.'`, tree shows root index (NOT empty)

**Test 3:** Edit `.index.codex.json` while navigator is showing it
- Expected: Watcher calls `updateIndexDoc()` (not `updateCodexDoc()`), tree refreshes correctly without corruption

**Test 4:** Switch folder context → file context (via `setContextFile`) → trigger reload
- Expected: `getContextFolder()` returns `null` (not the old folder). If `navigationMode` is still `'index'`, `reloadTreeIndex` will call `setContextFolder('.', wsRoot)` which loads the workspace-root index — this is correct behavior (better than loading the wrong subfolder's index). If `navigationMode` is `'files'` or `'auto'`, it falls through to `refresh()`.

**Test 5:** Use "Reset Context" command while in a subfolder
- Expected: Tree switches to workspace-root index (contextFolder=`'.'`), shows root `.index.codex.json` if it exists

**Test 6:** Open subfolder index, then open a regular `.codex.yaml`, then trigger regenerate
- Expected: `getContextFolder()` returns `null` after the file switch, regenerate targets `'.'` (workspace root)

Run: Manual testing in VS Code with a multi-folder codex project

---

## Gap Analysis

Verified gaps and their resolution:

1. **`IndexNodeTreeItem.workspaceRoot`** (line 448) — This is a *different* `workspaceRoot` field on the tree item class, not the provider. It's set at construction time in `createIndexTreeItem`. NOT affected by this change.

2. **`getWorkspaceRoot()` method** (line 693) — Already reads from `currentContext.workspaceRoot`. No change needed.

3. **Extension callers** (`reloadTreeIndex` at extension.ts:139, `regenerateAndReload` at extension.ts:155) — Both call `getContextFolder()` which we're updating to read `currentContext`. No separate fix needed.

4. ~~**`setContextFolder` null branch** — Already correct after removing legacy writes.~~ **FIXED in Task 6:** The null branch was clearing `workspaceRoot` too and not loading any index. Now keeps `workspaceRoot`, sets `contextFolder='.'`, and loads root index.

5. **`setActiveDocument` also needs to mirror to legacy fields** — Not needed since we're removing the legacy fields entirely.

6. **[NEW — Codex finding #1] File-mode context reset** — `setActiveDocument` only wrote `contextFolder` for index files. Switching to a regular file left the old folder context active. **FIXED in Task 7:** Added `else { this.currentContext.contextFolder = null; }`.

7. **[NEW — Codex finding #2] Root index `null` vs `'.'`** — Root `.index.codex.json` mapped `contextFolder` to `null`, but `getIndexChildren` requires non-null `contextFolder`. **FIXED in Task 5:** Use `'.'` instead of converting to `null`.

8. **[NEW — Codex finding #3] Reset semantics** — `setContextFolder(null, wsRoot)` cleared everything but didn't load root index. **FIXED in Task 6:** Now loads root `.index.codex.json` if it exists.

9. **[NEW — Codex round 2, finding #1] `switchToIndexMode` missing `explicit=true`** — extension.ts:2659 calls `setActiveDocument(doc)` without `explicit=true`, so the root index auto-open is blocked by the `contextExplicitlySet` guard on first use. **FIXED in Task 4:** Now passes `explicit=true`.

10. **[NEW — Codex round 2, finding #2] `reloadTreeIndex` behavior after file switch** — After switching from index to file mode, `getContextFolder()` returns `null`, but if `navigationMode` is still `'index'`, `reloadTreeIndex` calls `setContextFolder('.', wsRoot)` which loads the workspace-root index. This is actually correct behavior — better than loading the wrong subfolder. **ADDRESSED in Test 4 wording.**

11. **[NEW — Codex round 2, finding #3] Search context stale after reset** — `setContextFolder`'s search reinitialization (line 945) only runs when `folderPath` is truthy. The null/reset path skips it, leaving search scoped to the old folder. **FIXED in Task 6:** Added `searchManager.initializeForContext('.', workspaceRoot)` in the reset branch.

12. **[NEW — Codex round 3, finding #1] Search stale after direct index activation** — `switchToIndexMode` goes through `setActiveDocument` which never calls `initializeForContext()`. After opening root index via Switch to Index Mode, search stays scoped to old folder. **FIXED in Task 4:** Added `searchManager.initializeForContext('.', workspaceRoot)` after `setActiveDocument` in the `switchToIndexMode` command.

13. **[NEW — Codex round 3, finding #2] No automated tests for state transitions** — These are state-transition bugs that are easy to reintroduce. Acknowledged as a real risk but out of scope for this plan (tree provider requires heavy VS Code API mocking). Consider adding integration tests in a future plan.
