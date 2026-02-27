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

**Test implementation:** Write tests using vitest with `vi.mock('fs/promises')` for filesystem mocking. Key test cases:
- `trashPath` returns `path.join(wsRoot, '.chapterwise', 'trash')`
- `getTrashDestination('chapters/ch1.codex.yaml')` returns `path.join(trashPath, 'chapters/ch1.codex.yaml')`
- `moveToTrash('chapters/ch1.codex.yaml')`: creates trash directory (`mkdir -p`), renames file to trash destination, calls `ensureGitignore()` (Fact #55)
- `restoreFromTrash('chapters/ch1.codex.yaml')`: moves file back from trash to original location, creates parent dirs if needed
- `listTrash()` returns empty array when trash folder doesn't exist
- `listTrash()` returns `TrashEntry[]` with relativePath, name, trashedAt, isDirectory when trash folder has contents
- `emptyTrash()`: calls `fs.rm(trashPath, { recursive: true, force: true })`
- `ensureGitignore()`: reads `.gitignore`, adds `.chapterwise/trash/` line if not present, creates `.gitignore` if missing, skips if line already exists
- `hasTrash()` returns `true` when trash dir exists and has entries, `false` otherwise

### Step 2: Run tests — verify FAIL

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/trashManager.test.ts`
Expected: FAIL — module not found

### Step 3: Implement TrashManager

Create `src/trashManager.ts` with:
- `TrashEntry` interface (`relativePath`, `name`, `trashedAt`, `isDirectory`)
- `TrashManager` class with `trashPath`, `getTrashDestination`, `moveToTrash`, `restoreFromTrash`, `listTrash`, `emptyTrash`, `ensureGitignore`, `hasTrash`

**Implementation details:** The `TrashManager` class uses `fs/promises` for all file operations:
- Constructor takes `workspaceRoot: string`, computes `trashPath = path.join(workspaceRoot, '.chapterwise', 'trash')`
- `getTrashDestination(relativePath)`: returns `path.join(this.trashPath, relativePath)`
- `moveToTrash(relativePath)`: computes source (`path.join(wsRoot, relativePath)`) and dest (`getTrashDestination`), creates dest directory with `mkdir({ recursive: true })`, renames file, **MUST call `this.ensureGitignore()` inside moveToTrash** (Fact #55 — ensures gitignore is always updated regardless of caller)
- `restoreFromTrash(relativePath)`: reverse of moveToTrash — move from trash back to original location, create parent dir if needed
- `listTrash()`: if trash dir doesn't exist return `[]`. Otherwise `readdir` recursively, return `TrashEntry[]`
- `emptyTrash()`: `fs.rm(this.trashPath, { recursive: true, force: true })`
- `ensureGitignore()`: read `.gitignore` from wsRoot, check if `.chapterwise/trash/` line exists, append if missing, create file if doesn't exist
- `hasTrash()`: check if trash dir exists and has at least one entry

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

**Test implementation:** Write tests using vitest. Key test cases:
- `cut({ nodeId: 'abc', nodeType: 'scene', nodeName: 'Test', sourceUri: mockUri, sourcePath: ['children', 0] })`: stores entry
- `getCutEntry()`: returns the stored entry after `cut()`
- `isCut('abc')`: returns `true` for the cut node ID
- `isCut('xyz')`: returns `false` for a different ID
- `clear()`: removes stored entry, `getCutEntry()` returns `undefined`
- `onDidChange`: fires event on `cut()` call (use `vi.fn()` listener)
- `onDidChange`: fires event on `clear()` call
- Second `cut()` replaces first entry (only one item on clipboard at a time)
- `dispose()`: cleans up the EventEmitter

### Step 3: Run tests — verify FAIL

### Step 4: Implement ClipboardManager

Create `src/clipboardManager.ts` with:
- `ClipboardEntry` interface (`nodeId`, `nodeType`, `nodeName`, `sourceUri`, `sourcePath`, `isFileBacked`, optional `filePath`)
- `ClipboardManager` class implementing `vscode.Disposable` with `cut()`, `getCutEntry()`, `isCut()`, `clear()`, `dispose()`
- Uses `vscode.EventEmitter<void>` for `onDidChange` event

**Implementation details:** The `ClipboardManager` class implements `vscode.Disposable`:
- `ClipboardEntry` interface: `{ nodeId: string, nodeType: string, nodeName: string, sourceUri: vscode.Uri, sourcePath: PathSegment[], isFileBacked: boolean, filePath?: string }`
- Private `_cutEntry: ClipboardEntry | undefined`
- Private `_onDidChange = new vscode.EventEmitter<void>()`
- `readonly onDidChange = this._onDidChange.event`
- `cut(entry: ClipboardEntry)`: sets `_cutEntry`, fires `_onDidChange.fire()`
- `getCutEntry()`: returns `_cutEntry`
- `isCut(nodeId: string)`: returns `_cutEntry?.nodeId === nodeId`
- `clear()`: sets `_cutEntry = undefined`, fires `_onDidChange.fire()`
- `dispose()`: calls `_onDidChange.dispose()`

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
- [ ] `TrashManager.moveToTrash()` calls `ensureGitignore()` internally (Fact #55 — not left to callers)
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
