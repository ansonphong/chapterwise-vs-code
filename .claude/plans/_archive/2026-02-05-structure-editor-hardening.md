# Structure Editor Hardening Plan (Recommended)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the structure editor with path traversal prevention, secure UUID, async I/O, settings passthrough, rename implementation, and error recovery.

**Architecture:** Add path validation helpers, convert sync fs to async, pass real settings to drag-drop, implement FILES mode rename, add rollback for multi-step operations.

**Tech Stack:** TypeScript, VS Code Extension API

---

## Summary of Changes

| Category | Changes |
|----------|---------|
| Security - Path Traversal | Validate all resolved paths stay within workspaceRoot |
| Security - UUID | Replace Math.random() UUID with crypto.randomUUID() |
| Async I/O | Convert sync fs calls to fs.promises in structureEditor.ts |
| Settings | Pass actual settings from settingsManager to drag-drop moves |
| Feature | Implement rename for FILES mode (YAML name update) |
| Error Recovery | Rollback fs.rename on subsequent failures |
| Duplicate Check | Verify no name collision in target folder before move |

---

### Task 1: Add Path Traversal Validation and Secure UUID

**Files:**
- Modify: `src/structureEditor.ts`

**Step 1: Add path validation helper and crypto import after existing imports (line 7)**

After the existing imports, add:

```typescript
import * as crypto from 'crypto';

/**
 * Validate that a resolved path stays within the workspace root.
 * Prevents path traversal via malicious file paths.
 */
function isPathWithinRoot(resolvedPath: string, rootPath: string): boolean {
  const normalizedResolved = path.resolve(resolvedPath);
  const normalizedRoot = path.resolve(rootPath);
  return normalizedResolved.startsWith(normalizedRoot + path.sep) || normalizedResolved === normalizedRoot;
}
```

**Step 2: Add path validation to moveFileInIndex (lines 50-54)**

After computing `sourceFull` and `targetFull`, add validation:

```typescript
// Validate paths stay within workspace
if (!isPathWithinRoot(sourceFull, workspaceRoot) || !isPathWithinRoot(targetFull, workspaceRoot)) {
  return {
    success: false,
    message: 'Path traversal detected: paths must stay within workspace'
  };
}
```

**Step 3: Add path validation to renameFileInIndex (after line 145)**

After computing `newFull`, add:

```typescript
// Validate new path stays within workspace
if (!isPathWithinRoot(newFull, workspaceRoot)) {
  return {
    success: false,
    message: 'Path traversal detected: renamed path must stay within workspace'
  };
}
```

**Step 4: Add path validation to removeFileFromIndex (after line 219)**

After computing `fullPath`, add:

```typescript
// Validate path stays within workspace
if (!isPathWithinRoot(fullPath, workspaceRoot)) {
  return {
    success: false,
    message: 'Path traversal detected: path must stay within workspace'
  };
}
```

**Step 5: Add path traversal check in slugifyName (line 937)**

After the existing sanitization, add rejection of `..` sequences:

```typescript
// Remove path traversal sequences
slug = slug.replace(/\.\./g, '');
```

**Step 6: Replace Math.random UUID with crypto.randomUUID (lines 953-958)**

Replace the `generateUuid` method:

```typescript
private generateUuid(): string {
  return crypto.randomUUID();
}
```

**Step 7: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 8: Commit**

```bash
git add src/structureEditor.ts
git commit -m "security(structure): add path traversal validation and secure UUID

- Add isPathWithinRoot() helper for workspace boundary checks
- Validate moveFileInIndex, renameFileInIndex, removeFileFromIndex paths
- Strip '..' from slugified names
- Replace Math.random() UUID with crypto.randomUUID()"
```

---

### Task 2: Convert Synchronous File I/O to Async

**Files:**
- Modify: `src/structureEditor.ts`

**Step 1: Add fs.promises import alias (at top of file)**

After `import * as fs from 'fs';`, add:

```typescript
const fsPromises = fs.promises;
```

**Step 2: Convert moveFileInIndex sync calls to async**

Replace:
- `fs.existsSync(sourceFull)` → `await fsPromises.access(sourceFull).then(() => true).catch(() => false)` (or use a helper)
- `fs.mkdirSync(targetDir, { recursive: true })` → `await fsPromises.mkdir(targetDir, { recursive: true })`
- `fs.renameSync(sourceFull, targetFull)` → `await fsPromises.rename(sourceFull, targetFull)`

To keep it clean, add a helper:

```typescript
/** Check if a file/directory exists (async) */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
```

Then update all methods to use `await fileExists(...)` and `await fsPromises.*`.

**Step 3: Convert renameFileInIndex sync calls to async**

- `fs.existsSync(oldFull)` → `await fileExists(oldFull)`
- `fs.existsSync(newFull)` → `await fileExists(newFull)`
- `fs.renameSync(oldFull, newFull)` → `await fsPromises.rename(oldFull, newFull)`

**Step 4: Convert removeFileFromIndex sync calls to async**

- `fs.existsSync(fullPath)` → `await fileExists(fullPath)`
- `fs.copyFileSync(fullPath, backupPath)` → `await fsPromises.copyFile(fullPath, backupPath)`

**Step 5: Convert surgical index methods to async**

- `fs.existsSync(indexPath)` → `await fileExists(indexPath)`
- `fs.readFileSync(indexPath, 'utf-8')` → `await fsPromises.readFile(indexPath, 'utf-8')`
- `fs.writeFileSync(indexPath, ...)` → `await fsPromises.writeFile(indexPath, ...)`

**Step 6: Convert reorderFileInIndex, moveFileUp, moveFileDown to async**

Same pattern: replace all sync fs calls.

**Step 7: Convert autofixFolderOrder to async**

Same pattern. Also convert the `fs.readdirSync` and `fs.statSync` calls.

**Step 8: Convert updateIncludePaths and findFilesIncluding to async**

- `fs.readFileSync(...)` → `await fsPromises.readFile(...)`
- `fs.writeFileSync(...)` → `await fsPromises.writeFile(...)`

**Step 9: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 10: Commit**

```bash
git add src/structureEditor.ts
git commit -m "perf(structure): convert synchronous file I/O to async

- Add fileExists() async helper
- Convert all fs.*Sync calls to fsPromises equivalents
- Prevents blocking extension host during file operations"
```

---

### Task 3: Pass Real Settings to Drag-Drop and Add Duplicate Name Check

**Files:**
- Modify: `src/dragDropController.ts`

**Step 1: Import settingsManager**

Add import after existing imports:

```typescript
import { getSettingsManager } from './settingsManager';
```

**Step 2: Replace empty settings in handleIndexDrop MOVE section (line 252-254)**

Replace:
```typescript
// We need to get settings, but for now use empty object
// TODO: Get actual settings from settingsManager
const settings = {} as any;
```

With:
```typescript
const settingsMgr = getSettingsManager();
const docUri = item.documentUri ? vscode.Uri.parse(item.documentUri) : undefined;
const settings = docUri
  ? await settingsMgr.getSettings(docUri)
  : settingsMgr.getDefaultSettings();
```

**Step 3: Add duplicate name check in validateSingleDrop (after line 464)**

Replace the TODO comment with actual validation:

```typescript
// Check for duplicate names in target folder
if (target instanceof IndexNodeTreeItem && item.type === 'index' && item.filePath) {
  const targetPath = target.getFilePath();
  const targetDir = path.dirname(targetPath);
  const sourceFileName = path.basename(item.filePath);
  const potentialTarget = path.join(targetDir, sourceFileName);
  if (fs.existsSync(potentialTarget) && potentialTarget !== item.filePath) {
    return false; // Would overwrite existing file
  }
}
```

**Step 4: Convert sync fs calls in getSiblingsForTarget to async**

Replace `fs.existsSync` and `fs.readFileSync` with async versions.

**Step 5: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 6: Commit**

```bash
git add src/dragDropController.ts
git commit -m "fix(drag-drop): pass real settings and add duplicate name check

- Replace empty settings object with actual settingsManager settings
- Add duplicate filename check before allowing move operations
- Convert sync I/O to async in getSiblingsForTarget"
```

---

### Task 4: Implement Rename Command for FILES Mode and Add Error Recovery

**Files:**
- Modify: `src/structureEditor.ts`
- Modify: `src/extension.ts`

**Step 1: Add renameNodeInDocument method to CodexStructureEditor (after removeNodeFromDocument)**

```typescript
/**
 * Rename a node within a document (FILES mode)
 * Updates the node's 'name' field in YAML
 */
async renameNodeInDocument(
  document: vscode.TextDocument,
  node: CodexNode,
  newName: string
): Promise<boolean> {
  try {
    const text = document.getText();
    const yamlDoc = YAML.parseDocument(text);

    const nodePath = this.buildYamlPath(node.path);
    const nodeValue = yamlDoc.getIn(nodePath);

    if (!nodeValue || typeof nodeValue !== 'object') {
      vscode.window.showErrorMessage('Node not found in document');
      return false;
    }

    // Update name field
    yamlDoc.setIn([...nodePath, 'name'], newName);

    // Apply edit
    const newText = yamlDoc.toString();
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newText
    );

    await vscode.workspace.applyEdit(edit);
    await document.save();

    return true;
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to rename node: ${error}`);
    return false;
  }
}
```

**Step 2: Wire up renameNode command in extension.ts (lines 1540-1559)**

Replace the TODO block:

```typescript
'chapterwiseCodex.renameNode',
async (treeItem?: CodexTreeItem) => {
  if (!treeItem) return;

  const newName = await vscode.window.showInputBox({
    prompt: 'Enter new name',
    value: treeItem.codexNode.name,
    placeHolder: 'New node name'
  });

  if (!newName || newName === treeItem.codexNode.name) return;

  const document = treeProvider.getActiveTextDocument();
  if (!document) {
    vscode.window.showErrorMessage('No active document');
    return;
  }

  const { getStructureEditor } = await import('./structureEditor');
  const editor = getStructureEditor();

  const success = await editor.renameNodeInDocument(
    document,
    treeItem.codexNode,
    newName
  );

  if (success) {
    treeProvider.setActiveDocument(document);
    showTransientMessage(`✓ Renamed to: ${newName}`, 3000);
  }
}
```

**Step 3: Add rollback to moveFileInIndex (error recovery)**

After the `fs.rename` succeeds, if include path update or index update fails, attempt to rename back:

```typescript
// Move the file
await fsPromises.rename(sourceFull, targetFull);

// Update include paths (best-effort, log errors)
let affectedFiles: string[] = [];
try {
  affectedFiles = await this.updateIncludePaths(
    workspaceRoot,
    sourceFilePath,
    path.join(targetParentPath, fileName)
  );
} catch (includeError) {
  // Attempt rollback
  try {
    await fsPromises.rename(targetFull, sourceFull);
  } catch (rollbackError) {
    // Rollback also failed - report both
  }
  return {
    success: false,
    message: `Failed to update include paths (file moved back): ${includeError}`
  };
}
```

**Step 4: Add rollback to renameFileInIndex**

Same pattern: if include update fails after rename, attempt to rename back.

**Step 5: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 6: Commit**

```bash
git add src/structureEditor.ts src/extension.ts
git commit -m "feat(structure): implement rename command and add error recovery

- Add renameNodeInDocument() for FILES mode rename
- Wire up chapterwiseCodex.renameNode command
- Add rollback: revert fs.rename if include update fails
- Move and rename operations now attempt recovery on partial failure"
```

---

### Task 5: Clean Up Console.log and Add Backup Before Move/Rename

**Files:**
- Modify: `src/structureEditor.ts`

**Step 1: Add backup before move in moveFileInIndex**

Before the `fsPromises.rename(sourceFull, targetFull)` call, add optional backup:

This is covered by the rollback in Task 4 - if move fails mid-way, the file is renamed back. No need for a separate backup copy since `fs.rename` is atomic on the same filesystem.

**Step 2: Convert excessive console.log in autofixFolderOrder to use output channel pattern**

Replace all `console.log('[autofixFolderOrder]...')` (lines 1247-1370) with a simple `log()` function that doesn't spam the console. Since the extension has an output channel already, these should be removed from the structureEditor.ts class (the caller in extension.ts already logs to outputChannel).

Remove/minimize console.log statements in autofixFolderOrder - keep only error-level messages.

**Step 3: Remove console.log from surgical index methods**

Convert `console.log` and `console.warn` to be minimal:
- Keep `console.error` for actual errors
- Remove success logging (`console.log('✓ Surgically updated...')`)
- Remove debug logging (`console.log('  Updated: ...')`)

**Step 4: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 5: Commit**

```bash
git add src/structureEditor.ts
git commit -m "fix(structure): remove excessive console.log statements

- Remove verbose debug logging from autofixFolderOrder
- Remove success/debug logging from surgical index methods
- Keep console.error for actual error conditions"
```

---

### Task 6: Update META-DEV-PROMPT

**Files:**
- Modify: `/Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md`

**Step 1: Mark Structure Editor as complete**

Find line with Structure Editor and change:

```
| 27 | Structure Editor | ⬜ | 7 | | | Move, rename, delete, ordering |
```

To:

```
| 27 | Structure Editor | ✅ | 7 | 2026-02-05 | | Path traversal fix, async I/O, rename impl, error recovery |
```

**Step 2: Add decision log entry**

Add to NOTES & DECISIONS LOG section:

```markdown
### 2026-02-05 - Structure Editor Hardening (#27) [chapterwise-codex]
Decision: Recommended-level hardening for structure editor operations
Changes:
- Path traversal prevention: isPathWithinRoot() validates all resolved paths
- Secure UUID: replace Math.random() with crypto.randomUUID()
- Async I/O: convert all fs.*Sync calls to fs.promises equivalents
- Settings passthrough: drag-drop now uses actual settingsManager settings
- Rename command: implemented renameNodeInDocument for FILES mode
- Error recovery: rollback fs.rename if include path update fails
- Duplicate check: validate no name collision before drag-drop move
- Console cleanup: removed verbose debug logging from autofixFolderOrder
Deferred (Low priority):
- Full circular reference detection with parent traversal
- Race condition mutex/locking for concurrent operations
- Transaction rollback for all multi-step operations
- Reserved filename check (COM1, LPT1 on Windows)
```

**Step 3: Commit**

```bash
git add /Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md
git commit -m "docs: mark Structure Editor as hardened"
```

---

## Verification Checklist

Before marking complete:

- [ ] isPathWithinRoot() helper function added
- [ ] moveFileInIndex validates paths within workspace
- [ ] renameFileInIndex validates paths within workspace
- [ ] removeFileFromIndex validates paths within workspace
- [ ] slugifyName strips '..' sequences
- [ ] crypto.randomUUID() replaces Math.random() UUID
- [ ] All sync fs calls converted to async
- [ ] fileExists() async helper added
- [ ] Drag-drop passes real settings from settingsManager
- [ ] Duplicate name check in validateSingleDrop
- [ ] renameNodeInDocument method implemented
- [ ] renameNode command wired up in extension.ts
- [ ] moveFileInIndex has rollback on include failure
- [ ] renameFileInIndex has rollback on include failure
- [ ] Excessive console.log removed from autofixFolderOrder
- [ ] Extension compiles without errors
- [ ] META-DEV-PROMPT updated
