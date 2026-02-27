# Stage 6: Command Handlers — New Operations

> **Master plan:** `00-master-plan.md` — execute via Ralph Loop
>
> **Shared reference:** See `codebase-facts.md` for all codebase facts.
> **Prerequisites:** Stage 1 (helpers), Stage 2 (TrashManager, ClipboardManager), Stage 3 (StructureEditor methods)
> **Review findings addressed:** R1-6 (partial — applies reload helpers), R1-7, R2-4, R2-9, R3-4, R3-5, R3-10

**Goal:** Register all new command handlers: field/type/tag/icon operations, trash, duplicate, cut/paste, extract, addChildFile, renameFolder. (Note: `addChildFolder`, `inlineThisFile`, and batch ops are in Stage 7.)

**Architecture:** Two tasks in extension.ts — field/metadata ops (Task 9), then file-level ops (Task 10). All handlers use lazy imports (Fact #1). Reload strategy (Fact #48):
- **YAML-only edits** (add field, change type, add tags, rename inline node, set emoji) → `reloadTreeIndex()`
- **Disk-mutating ops** (trash file, duplicate file, add file, add folder, restore from trash) → `regenerateAndReload(wsRoot)`

---

## Task 9: Field/Type/Tag/Icon Command Handlers

**Files:**
- Modify: `src/extension.ts`

> **Helper pattern:** All handlers follow:
> 1. `if (!treeItem) return;`
> 2. `if (treeItem instanceof CodexTreeItem) { ... direct access ... }`
> 3. `else if (treeItem instanceof IndexNodeTreeItem) { resolveIndexNodeForEdit() ... }`
> 4. `await reloadTreeIndex()` (NOT `treeProvider.refresh()` — R3-4)

### Step 1: Register `addField`

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.addField', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    if (!treeItem) return;
    const { PROSE_FIELDS } = await import('./codexModel');
    const COMMON_FIELDS = [...PROSE_FIELDS, 'notes'];
    let existingFields: string[] = [];
    if (treeItem instanceof CodexTreeItem) {
      existingFields = treeItem.codexNode.availableFields;
    }
    const items = COMMON_FIELDS
      .filter(f => !existingFields.includes(f))
      .map(f => ({ label: f.charAt(0).toUpperCase() + f.slice(1), field: f }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a field to add' });
    if (!picked) return;
    const { getStructureEditor } = await import('./structureEditor');
    const editor = getStructureEditor();
    if (treeItem instanceof CodexTreeItem) {
      const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
      await editor.addFieldToNode(doc, treeItem.codexNode, picked.field);
    } else if (treeItem instanceof IndexNodeTreeItem) {
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
      if (resolved) await editor.addFieldToNode(resolved.doc, resolved.node, picked.field);
    }
    await reloadTreeIndex();  // YAML-only edit — no disk mutation
  })
);
```

### Step 2: Register changeType, changeIcon, addTags, addRelation

Each follows the same pattern — QuickPick/InputBox then:
- `CodexTreeItem` → open doc from `treeItem.documentUri`, call editor method
- `IndexNodeTreeItem` → `resolveIndexNodeForEdit()`, call editor method
- End with `await reloadTreeIndex()` (YAML-only edits)

**changeType:** QuickPick with types: book, chapter, scene, character, location, item, event, note, world, faction, lore

**changeIcon:** QuickPick with grouped emojis

**addTags:** InputBox for comma-separated tags

**addRelation:** Step 1: QuickPick listing all project nodes. Step 2: QuickPick for relation type.

### Step 3: Register deleteField, renameField

Accept `CodexFieldTreeItem` or `IndexNodeTreeItem` (for `indexField`):
- `CodexFieldTreeItem`: use `treeItem.fieldName` and `treeItem.parentNode`
- `IndexNodeTreeItem` with `_node_kind === 'field'`: use `_field_name` and resolve parent

### Step 4: Register copyPath, openInFinder

- **copyPath:** Guard for `indexFile`/`indexFolder` only (`_computed_path` is absent on `indexNode` — Fact #12):
  ```typescript
  const cp = treeItem.indexNode._computed_path;
  if (!cp) return;
  vscode.env.clipboard.writeText(cp);
  ```
- **openInFinder:** `vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(fullPath))`

### Step 5: Verify build

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

### Step 6: Commit

```bash
git add src/extension.ts
git commit -m "feat: register field/type/tag/icon command handlers with full index-mode support"
```

---

## Task 10: Trash, Duplicate, Cut/Paste, Extract, Folder Commands

**Files:**
- Modify: `src/extension.ts`

> **CRITICAL:** File-level trash MUST use `structureEditor.removeFileFromIndex()`, NOT raw `trashManager.moveToTrash()`. The structureEditor method handles index maintenance.

### Step 1: Register moveToTrash

```typescript
'chapterwiseCodex.moveToTrash', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
  if (!treeItem) return;
  if (treeItem instanceof CodexTreeItem) {
    // Inline: remove from document
    // ... standard editor.removeNodeFromDocument pattern
  } else if (treeItem instanceof IndexNodeTreeItem) {
    const nodeKind = (treeItem.indexNode as any)._node_kind;
    if (nodeKind === 'file' || nodeKind === 'folder') {
      // File-level: structureEditor.removeFileFromIndex (NOT raw trashManager)
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const filePath = treeItem.indexNode._computed_path;
      if (!filePath) return;
      // Lazy imports (Fact #1)
      const { getStructureEditor } = await import('./structureEditor');
      const { getSettingsManager } = await import('./settingsManager');
      const editor = getStructureEditor();
      // Use actual file URI for settings, NOT treeItem.documentUri (Fact #8, R2-9)
      const fileUri = vscode.Uri.file(path.join(wsRoot, filePath));
      const settings = await getSettingsManager().getSettings(fileUri);
      await editor.removeFileFromIndex(wsRoot, filePath, false, settings);
      // removeFileFromIndex handles index internally; regenerate to be safe
      await regenerateAndReload(wsRoot);  // Fact #48: file deleted from disk
      return;
    } else if (nodeKind === 'node') {
      // Entity in file: resolveIndexNodeForEdit + removeNodeFromDocument
      // ... (YAML-only edit)
    }
  }
  await reloadTreeIndex();  // YAML-only edit path
}
```

### Step 2: Register duplicateNode

- `CodexTreeItem`: `editor.duplicateNodeInDocument(doc, node)`
- `IndexNodeTreeItem` `nodeKind === 'file'`: copy file on disk, regenerate IDs → `regenerateAndReload(wsRoot)` (Fact #48)
- `IndexNodeTreeItem` `nodeKind === 'node'`: `resolveIndexNodeForEdit()` + `editor.duplicateNodeInDocument()` → `reloadTreeIndex()` (YAML-only)
- Use correct reload per path

### Step 3: Register cutNode

Store in clipboardManager:
```typescript
clipboardManager.cut({
  nodeId, nodeType, nodeName, sourceUri, sourcePath,
  isFileBacked: nodeKind === 'file',
  filePath: nodeKind === 'file' ? _computed_path : undefined,
});
await reloadTreeIndex();  // triggers re-render with cut indicator
```

### Step 4: Register pasteNodeAsChild + pasteNodeAsSibling

**pasteNodeAsChild:**
- `CodexTreeItem` + non-file-backed: same-file inline move via `editor.moveNodeInDocument()`
- File-backed into folder: lazy-import `getSettingsManager` (Fact #1), get settings for file URI (Fact #8), then call `editor.moveFileInIndex(wsRoot, path, destFolder, settings)` (Fact #35: settings required, R2-4)
- Cross-file inline paste: deferred to future work (R3-5)

**pasteNodeAsSibling:**
- `CodexTreeItem` + non-file-backed: `editor.moveNodeInDocument(doc, source, target, 'after')`
- `IndexNodeTreeItem` + `nodeKind === 'file'` + clipboard `isFileBacked`: create sibling file next to target. Use `getSettingsManager().getSettings()` for naming, `isPathWithinWorkspace()` for validation, then `fs.rename()` or `fs.copyFile()` the cut file to the new sibling location. End with `regenerateAndReload(wsRoot)`. (Fact #53: use existing safety pipelines)
- End with `clipboardManager.clear()` + appropriate reload (`regenerateAndReload` for file moves, `reloadTreeIndex` for inline moves)

### Step 5: Register restoreFromTrash, emptyTrash, extractToFile, addChildFile, renameFolder

> **Note:** `openInFinder` is already registered in Task 9 Step 4 — do NOT re-register here.

**restoreFromTrash + emptyTrash:** Use `TrashManager` directly (this is correct — TrashManager is for restore/empty operations; the line 105 warning about NOT using raw trashManager applies only to the *delete* direction, where index maintenance is needed). After restore → `regenerateAndReload(wsRoot)` (Fact #48: disk mutation).

**extractToFile:** Call `editor.extractNodeToFile()`. Creates new file → `regenerateAndReload(wsRoot)`.

**addChildFile:** Prompt for name, reject path separators and `..`/`.`. Use `structureEditor.slugifyName(name, settings.naming)` for filename sanitization (Fact #53 — NOT inline regex). Validate with `isPathWithinWorkspace()`. Create new `.codex.yaml` with `crypto.randomUUID()` ID, format version from settings. Add to `index.codex.yaml` via `om.addEntry()`. End with `regenerateAndReload(wsRoot)`.

```typescript
'chapterwiseCodex.addChildFile', async (treeItem?: IndexNodeTreeItem) => {
  if (!treeItem) return;
  const nodeKind = (treeItem.indexNode as any)._node_kind;
  if (nodeKind !== 'folder') return;
  const name = await vscode.window.showInputBox({ prompt: 'Enter file name' });
  if (!name) return;
  // Sanitize: reject path separators and traversal patterns
  if (/[/\\]/.test(name) || name === '..' || name === '.') {
    vscode.window.showErrorMessage('Invalid file name');
    return;
  }
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return;
  const parentPath = treeItem.indexNode._computed_path || '';
  // Use existing slugify pipeline (Fact #53)
  const { getStructureEditor } = await import('./structureEditor');
  const { getSettingsManager } = await import('./settingsManager');
  const editor = getStructureEditor();
  const fileUri = vscode.Uri.file(path.join(wsRoot, parentPath));
  const settings = await getSettingsManager().getSettings(fileUri);
  const slugName = (editor as any).slugifyName(name, settings.naming);
  const newFilePath = path.join(parentPath, `${slugName}.codex.yaml`);
  const newFullPath = path.join(wsRoot, newFilePath);
  // Path traversal validation (Fact #47)
  const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
  if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
    vscode.window.showErrorMessage('File path resolves outside workspace');
    return;
  }
  const { randomUUID } = await import('crypto');
  const content = `metadata:\n  formatVersion: "1.2"\nid: "${randomUUID()}"\ntype: chapter\nname: "${name}"\nbody: ""\n`;
  await vscode.workspace.fs.writeFile(vscode.Uri.file(newFullPath), Buffer.from(content, 'utf-8'));
  // Add to ordering index
  const { getOrderingManager } = await import('./orderingManager');
  const om = getOrderingManager(wsRoot);
  await om.addEntry(parentPath, { name: `${slugName}.codex.yaml`, type: 'file' });
  await regenerateAndReload(wsRoot);
}
```

**renameFolder:** Do NOT use `renameFileInIndex()` for folders — it uses string replacement for include path updates that is NOT path-segment-aware (Fact #54). Instead, implement folder rename inline:

```typescript
'chapterwiseCodex.renameFolder', async (treeItem?: IndexNodeTreeItem) => {
  if (!treeItem) return;
  const nodeKind = (treeItem.indexNode as any)._node_kind;
  if (nodeKind !== 'folder') return;
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return;
  const oldPath = treeItem.indexNode._computed_path;
  if (!oldPath) return;
  const oldName = path.basename(oldPath);
  const newName = await vscode.window.showInputBox({
    prompt: 'Enter new folder name',
    value: oldName
  });
  if (!newName || newName === oldName) return;
  // Sanitize folder name
  if (/[/\\]/.test(newName) || newName === '..' || newName === '.') {
    vscode.window.showErrorMessage('Invalid folder name');
    return;
  }
  const parentDir = path.dirname(oldPath);
  const newPath = parentDir === '.' ? newName : path.join(parentDir, newName);
  const oldFullPath = path.join(wsRoot, oldPath);
  const newFullPath = path.join(wsRoot, newPath);
  // Path traversal validation (Fact #47)
  const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
  if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
    vscode.window.showErrorMessage('Folder path resolves outside workspace');
    return;
  }
  // Rename on disk
  const fsPromises = await import('fs/promises');
  await fsPromises.rename(oldFullPath, newFullPath);
  // Update include paths using SEGMENT-AWARE replacement (Fact #54)
  // Match on oldPath + path.sep prefix to avoid substring collisions
  const { getStructureEditor } = await import('./structureEditor');
  const editor = getStructureEditor();
  await (editor as any).updateIncludePathsSegmentAware(wsRoot, oldPath, newPath);
  await regenerateAndReload(wsRoot);
}
```

**NOTE (Fact #54):** `updateIncludePathsSegmentAware()` is a new helper method needed on `structureEditor` that replaces include path prefixes using path-segment matching (e.g., only matches `chapters/` not `ch` inside `chapter/`). If adding this method is too complex for this stage, use `updateIncludePaths()` but document the substring-collision risk as a known limitation and add a TODO for future fix.

### Step 6: Verify build

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

### Step 7: Commit

```bash
git add src/extension.ts
git commit -m "feat: register trash, duplicate, cut/paste, extract, folder commands with index maintenance"
```

---

## Stage 6 Completion Checklist

- [ ] `addField` handler works for CodexTreeItem + IndexNodeTreeItem
- [ ] `changeType` handler with QuickPick
- [ ] `changeIcon` handler with emoji QuickPick
- [ ] `addTags` handler with InputBox
- [ ] `addRelation` handler with two-step QuickPick
- [ ] `deleteField` / `renameField` handlers for CodexFieldTreeItem + indexField
- [ ] `copyPath` / `openInFinder` handlers
- [ ] `moveToTrash` uses `removeFileFromIndex()` for file-level (NOT raw trashManager)
- [ ] `duplicateNode` handles file copy + inline copy
- [ ] `cutNode` stores in ClipboardManager
- [ ] `pasteNodeAsChild` handles inline move + file move with `moveFileInIndex()` (settings param)
- [ ] `pasteNodeAsSibling` handles inline move
- [ ] `restoreFromTrash` + `emptyTrash` use TrashManager
- [ ] `extractToFile` creates file + include directive
- [ ] `addChildFile` uses `slugifyName()` + `isPathWithinWorkspace()` + `om.addEntry()` (Fact #53)
- [ ] `addChildFile` rejects path separators and traversal patterns in user input
- [ ] `pasteNodeAsSibling` handles file-backed nodes (creates sibling file, not just inline) — fixes Stage 6/8 contradiction
- [ ] `renameFolder` does NOT use `renameFileInIndex()` — uses inline folder rename with segment-aware include path updates (Fact #54)
- [ ] YAML-only ops use `reloadTreeIndex()`, disk-mutating ops use `regenerateAndReload(wsRoot)` (Fact #48)
- [ ] No handler uses bare `treeProvider.refresh()`
- [ ] No `treeItem.documentUri` used for edit targets (uses `resolveIndexNodeForEdit`)
- [ ] `npm run compile` succeeds
- [ ] All changes committed
