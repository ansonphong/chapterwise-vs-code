# Stage 2: New Modules — TrashManager + ClipboardManager

> **Master plan:** `00-master-plan.md` — execute via Ralph Loop
>
> **Shared reference:** See `codebase-facts.md` for all codebase facts.
> **Prerequisite:** Stage 1 (buildYamlPath fix + ordering migration, since Task 1 modifies `structureEditor.ts`)
> **Review findings addressed:** R1-1, R1-3, R2-5, R2-12

**Goal:** Create TrashManager (`.chapterwise/trash/` system) and ClipboardManager (cut/paste state), wire TrashManager into existing `removeFileFromIndex`.

**Architecture:** Two independent modules — can be implemented in parallel. TrashManager integrates into structureEditor.ts. ClipboardManager is standalone (wired later in Stage 7).

---

## Task 1: TrashManager

**Files:**
- Create: `src/trashManager.ts`
- Create: `src/trashManager.test.ts`
- Modify: `src/structureEditor.ts`

### Step 1: Write failing tests

Create `src/trashManager.test.ts` with tests for:
- `trashPath` returns `.chapterwise/trash/` under workspace root
- `getTrashDestination` preserves relative path
- `moveToTrash` creates dir + renames file
- `restoreFromTrash` moves back
- `listTrash` returns empty when no trash folder
- `emptyTrash` removes directory recursively
- `ensureGitignore` adds entry if missing, skips if present

Full test code: see original plan (lines 1038-1146).

### Step 2: Run tests — verify FAIL

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/trashManager.test.ts`
Expected: FAIL — module not found

### Step 3: Implement TrashManager

Create `src/trashManager.ts` with:
- `TrashEntry` interface (`relativePath`, `name`, `trashedAt`, `isDirectory`)
- `TrashManager` class with `trashPath`, `getTrashDestination`, `moveToTrash`, `restoreFromTrash`, `listTrash`, `emptyTrash`, `ensureGitignore`, `hasTrash`

Full implementation: see original plan (lines 1156-1254).

### Step 4: Run tests — verify PASS

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/trashManager.test.ts`

### Step 5: Wire into structureEditor.removeFileFromIndex

Modify `src/structureEditor.ts` at `removeFileFromIndex()` (lines ~320-330):

```typescript
// BEFORE:
if (settings.safety.backupBeforeDestruct && permanent) {
  const backupPath = `${fullPath}.backup`;
  await fsPromises.copyFile(fullPath, backupPath);
}
await vscode.workspace.fs.delete(fileUri, { recursive: false, useTrash: !permanent });

// AFTER:
const fileUri = vscode.Uri.file(fullPath);  // was in replaced range — must re-declare
if (permanent) {
  const stat = await vscode.workspace.fs.stat(fileUri);
  const isDir = stat.type === vscode.FileType.Directory;
  if (settings.safety.backupBeforeDestruct && !isDir) {  // Fact #36: copyFile fails on dirs
    const backupPath = `${fullPath}.backup`;
    await fsPromises.copyFile(fullPath, backupPath);
  }
  await vscode.workspace.fs.delete(fileUri, { recursive: isDir, useTrash: false });
} else {
  const { TrashManager } = await import('./trashManager');
  const tm = new TrashManager(workspaceRoot);
  await tm.moveToTrash(filePath);  // parameter name is `filePath` in removeFileFromIndex()
}
```

### Step 6: Run full test suite + build

Run: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`

### Step 7: Commit

```bash
git add src/trashManager.ts src/trashManager.test.ts src/structureEditor.ts
git commit -m "feat: add TrashManager for .chapterwise/trash/ system, wire into removeFileFromIndex"
```

---

## Task 2: ClipboardManager

**Files:**
- Create: `src/clipboardManager.ts`
- Create: `src/clipboardManager.test.ts`
- Modify: `src/__mocks__/vscode.ts` (extend mock)

### Step 1: Extend VS Code mock

**IMPORTANT (Fact #37):** Before writing ClipboardManager tests, extend `src/__mocks__/vscode.ts` with:
- `EventEmitter` mock (with `fire()`, `event`, `dispose()`)
- `Position`, `Selection`, `Range` constructors
- `FileType` enum
- `workspace.fs` stubs
- `env.clipboard` stubs
- `commands.executeCommand` stub

These mocks are also needed by Stage 3 (structureEditor.test.ts extensions) and Stages 5-7.

### Step 2: Write failing tests

Create `src/clipboardManager.test.ts` with tests for:
- `cut` stores entry, replaces previous
- `isCut` returns true/false correctly
- `clear` removes cut entry
- `onDidChange` fires on cut and clear

Full test code: see original plan (lines 1318-1388).

### Step 3: Run tests — verify FAIL

### Step 4: Implement ClipboardManager

Create `src/clipboardManager.ts` with:
- `ClipboardEntry` interface (`nodeId`, `nodeType`, `nodeName`, `sourceUri`, `sourcePath`, `isFileBacked`, optional `filePath`)
- `ClipboardManager` class implementing `vscode.Disposable` with `cut()`, `getCutEntry()`, `isCut()`, `clear()`, `dispose()`
- Uses `vscode.EventEmitter<void>` for `onDidChange` event

Full implementation: see original plan (lines 1396-1436).

### Step 5: Run tests — verify PASS

### Step 6: Commit

```bash
git add src/clipboardManager.ts src/clipboardManager.test.ts src/__mocks__/vscode.ts
git commit -m "feat: add ClipboardManager for cut/paste tree operations, extend VS Code mock"
```

---

## Stage 2 Completion Checklist

- [ ] `TrashManager` created with test coverage
- [ ] `TrashManager.moveToTrash` creates `.chapterwise/trash/` directories
- [ ] `TrashManager.restoreFromTrash` moves files back
- [ ] `TrashManager.ensureGitignore` adds `.chapterwise/trash/` to `.gitignore`
- [ ] `TrashManager.listTrash` returns entries (empty when no trash folder)
- [ ] `TrashManager.emptyTrash` removes directory recursively
- [ ] `TrashManager.hasTrash` returns correct boolean
- [ ] `removeFileFromIndex` uses TrashManager for soft deletes
- [ ] `removeFileFromIndex` passes `recursive: true` for directories
- [ ] `removeFileFromIndex` skips backup for directories
- [ ] VS Code mock extended (EventEmitter, Position, Range, etc.)
- [ ] `ClipboardManager` created with test coverage
- [ ] `ClipboardManager.onDidChange` fires correctly
- [ ] `npm test` passes
- [ ] `npm run compile` succeeds
- [ ] All changes committed
