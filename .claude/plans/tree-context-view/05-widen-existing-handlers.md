# Stage 5: Command Handlers — Widen Existing Handlers

> **Master plan:** `00-master-plan.md` — execute via Ralph Loop
>
> **Shared reference:** See `codebase-facts.md` for all codebase facts.
> **Prerequisites:** Stage 1 (helpers in extension.ts), Stage 2 (TrashManager, ClipboardManager)
> **Review findings addressed:** R1-2, R1-4, R1-5, R1-6 (partial — applies reload helpers), R2-6, R2-7, R2-8, R3-3, R3-6

**Goal:** Widen all existing command handlers in extension.ts to accept `IndexNodeTreeItem` (and `CodexFieldTreeItem` where appropriate), using the shared helpers defined in Stage 1.

**Architecture:** Single file modification (extension.ts). Each handler gets an `instanceof` guard branch. Uses `resolveIndexNodeForEdit()` for all index-mode edits.

---

## Task 8: Widen Existing Handlers + Import Managers

**Files:**
- Modify: `src/extension.ts`

### Step 0: Register backward-compat alias (deferred from Stage 4, Fact #49, R5-1)

Stage 4 renamed `navigateToNodeInCodeView` → `navigateToEntityInCodeView` in package.json but deferred the TypeScript alias to this stage. Register it in `extension.ts`:

```typescript
// Backward-compat alias for renamed command (can remove in next major version)
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.navigateToNodeInCodeView',
    (...args: any[]) => vscode.commands.executeCommand('chapterwiseCodex.navigateToEntityInCodeView', ...args)
  )
);
```

### Step 1: Add imports

```typescript
import { ClipboardManager } from './clipboardManager';
// TrashManager uses lazy import in handlers per Fact #1 / Fact #31 (needs workspaceRoot)
```

> **Note:** `getNodeKind` is NOT exported from treeProvider.ts (file-scoped helper). Extension.ts must use
> `(treeItem.indexNode as any)._node_kind` or define a local accessor. Future cleanup: export `getNodeKind`
> from treeProvider.ts or a shared types module to eliminate `as any` casts.

### Step 2: Instantiate ClipboardManager in activate()

```typescript
const clipboardManager = new ClipboardManager();
context.subscriptions.push(clipboardManager);
```

> TrashManager and OrderingManager need `workspaceRoot` — instantiate on-demand in handlers (Fact #31).

### Step 3: Widen `addChildNode`

Change type to `CodexTreeItem | IndexNodeTreeItem`. Add:
```typescript
if (treeItem instanceof IndexNodeTreeItem) {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return;
  const nodeKind = (treeItem.indexNode as any)._node_kind;
  if (nodeKind === 'folder') {
    vscode.window.showInformationMessage('Use "Add File" for folders');
    return;
  }
  const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
  if (!resolved) return;
  const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
  if (!name) return;
  const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: 'scene' });
  if (!type) return;
  const { getStructureEditor } = await import('./structureEditor');
  const { getSettingsManager } = await import('./settingsManager');
  const editor = getStructureEditor();
  const settings = await getSettingsManager().getSettings(resolved.doc.uri);
  await editor.addNodeInDocument(resolved.doc, resolved.node, 'child', { name, type, proseField: 'body', proseValue: '' }, settings);
  // Fact #48: inline-only edit — reloadTreeIndex() suffices (no new files created)
  await reloadTreeIndex();
  return;
}
```

### Step 3b: Widen `addSiblingNode` (R3-3)

Current handler (extension.ts:1427) only accepts `CodexTreeItem`. Add:
```typescript
if (treeItem instanceof IndexNodeTreeItem) {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return;
  const nodeKind = (treeItem.indexNode as any)._node_kind;

  if (nodeKind === 'file') {
    // Create sibling file in same folder
    const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
    if (!name) return;
    const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: treeItem.indexNode.type || 'chapter' });
    if (!type) return;
    const filePath = treeItem.indexNode._computed_path;
    if (!filePath) return;
    const dir = path.dirname(filePath);

    // Fact #53: Use existing safety pipelines for file creation
    // Reject path separators and traversal patterns in user input
    if (/[/\\]/.test(name) || name === '..' || name === '.') {
      vscode.window.showErrorMessage('Invalid node name');
      return;
    }
    // Use structureEditor.slugifyName() for consistent filename sanitization
    const { getStructureEditor } = await import('./structureEditor');
    const { getSettingsManager } = await import('./settingsManager');
    const editor = getStructureEditor();
    const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
    const slugName = (editor as any).slugifyName(name, settings.naming);
    const newFilePath = path.join(dir, `${slugName}.codex.yaml`);
    const newFullPath = path.join(wsRoot, newFilePath);

    // Fact #47/53: Path traversal validation
    const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
    if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
      vscode.window.showErrorMessage('File path resolves outside workspace');
      return;
    }

    const { randomUUID } = await import('crypto');
    const content = `metadata:\n  formatVersion: "1.2"\nid: "${randomUUID()}"\ntype: ${type}\nname: "${name}"\nbody: ""\n`;
    await vscode.workspace.fs.writeFile(vscode.Uri.file(newFullPath), Buffer.from(content, 'utf-8'));
    // Fact #48/52: new file created on disk — must regenerate index cache + stacked views
    await regenerateAndReload(wsRoot);
  } else if (nodeKind === 'node') {
    // Inline sibling in backing file
    const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
    if (!resolved) return;
    const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
    if (!name) return;
    const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: treeItem.indexNode.type || 'scene' });
    if (!type) return;
    const { getStructureEditor } = await import('./structureEditor');
    const { getSettingsManager } = await import('./settingsManager');
    const editor = getStructureEditor();
    const settings = await getSettingsManager().getSettings(resolved.doc.uri);
    await editor.addNodeInDocument(resolved.doc, resolved.node, 'sibling-after', { name, type, proseField: 'body', proseValue: '' }, settings);
    await reloadTreeIndex();
  }
  return;
}
```

### Step 4: Widen `renameNode`

For `IndexNodeTreeItem`:
- `nodeKind === 'file'`: use `structureEditor.renameFileInIndex()` (Fact #28) → `regenerateAndReload(wsRoot)` (Fact #48: file renamed on disk)
- `nodeKind === 'node'`: use `resolveIndexNodeForEdit()` + `editor.renameNodeInDocument()` → `reloadTreeIndex()` (YAML-only edit)

### Step 4b: Widen `goToYaml` (R1-4, R2-7)

Accept `CodexTreeItem | IndexNodeTreeItem | CodexFieldTreeItem`:
```typescript
if (treeItem instanceof IndexNodeTreeItem) {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return;
  const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
  if (!resolved) return;
  const editor = await vscode.window.showTextDocument(resolved.doc);
  if (resolved.node.lineNumber) {
    const pos = new vscode.Position(resolved.node.lineNumber - 1, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
  }
  return;
}
if (treeItem instanceof CodexFieldTreeItem) {
  // Navigate to field line in document
  const document = treeProvider.getActiveTextDocument();
  if (!document) return;
  await vscode.window.showTextDocument(document);
  return;
}
```

### Step 4c: Widen `copyId` (R1-4)

```typescript
if (treeItem instanceof IndexNodeTreeItem) {
  await vscode.env.clipboard.writeText(treeItem.indexNode.id);
  vscode.window.setStatusBarMessage(`Copied ID: ${treeItem.indexNode.id}`, 3000);
}
```

### Step 4d: Extend `moveNodeUp`/`moveNodeDown` (R1-4)

> **Note:** These handlers ALREADY accept `IndexNodeTreeItem` (extension.ts:1583, 1621).
> The widening is to add a `nodeKind === 'node'` branch for inline reorder, and to fix
> the existing `treeProvider.refresh()` calls (lines 1609, 1647) which violate Fact #48.

For `IndexNodeTreeItem`:
- `nodeKind === 'file'`: call `editor.moveFileUp(wsRoot, relativePath)` (2 args — matches existing signature at extension.ts:1605) → replace `treeProvider.refresh()` with `await reloadTreeIndex()`
- `nodeKind === 'node'`: use `resolveIndexNodeForEdit()` + inline reorder in document → `await reloadTreeIndex()` (YAML-only edit)

### Step 5: Widen `removeNode`

For `IndexNodeTreeItem`:
- `nodeKind === 'file'|'folder'`: use `structureEditor.removeFileFromIndex()` (NOT raw trashManager)
  - Use `vscode.Uri.file(path.join(wsRoot, filePath))` for settings (NOT `treeItem.documentUri` — Fact #8)
  - End with `await regenerateAndReload(wsRoot)` (Fact #48: file deleted from disk)
- `nodeKind === 'node'`: use `resolveIndexNodeForEdit()` + `editor.removeNodeFromDocument()`
  - End with `await reloadTreeIndex()` (YAML-only edit)

### Step 5b: Widen `deleteNodePermanently`

> **Note:** The existing handler at extension.ts:1511 only accepts `CodexTreeItem`.
> Must widen with same pattern as `removeNode` but pass `permanent: true` to `removeFileFromIndex()`.

For `IndexNodeTreeItem`:
- `nodeKind === 'file'|'folder'`: `structureEditor.removeFileFromIndex(wsRoot, filePath, true, settings)`
  - Use `vscode.Uri.file(path.join(wsRoot, filePath))` for settings (NOT `treeItem.documentUri` — Fact #8)
  - End with `await regenerateAndReload(wsRoot)` (Fact #48: file deleted from disk)
- `nodeKind === 'node'`: use `resolveIndexNodeForEdit()` + `editor.removeNodeFromDocument(doc, node, true, settings)`
  - End with `await reloadTreeIndex()` (YAML-only edit)

### Step 6: Verify build

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

### Step 7: Commit

```bash
git add src/extension.ts
git commit -m "refactor: widen existing command handlers to accept IndexNodeTreeItem with proper index maintenance"
```

---

## Stage 5 Completion Checklist

- [ ] Backward-compat alias for `navigateToNodeInCodeView` registered (Fact #49, R5-1)
- [ ] `addChildNode` accepts IndexNodeTreeItem (indexFile + indexNode)
- [ ] `addSiblingNode` accepts IndexNodeTreeItem (file creation + inline sibling)
- [ ] `addSiblingNode` file creation uses `slugifyName()` + `isPathWithinWorkspace()` (Fact #53)
- [ ] `renameNode` accepts IndexNodeTreeItem (file rename + inline rename)
- [ ] `goToYaml` accepts IndexNodeTreeItem + CodexFieldTreeItem
- [ ] `copyId` accepts IndexNodeTreeItem
- [ ] `moveNodeUp`/`moveNodeDown` extended with inline node reorder + `treeProvider.refresh()` replaced with `reloadTreeIndex()`
- [ ] `removeNode` accepts IndexNodeTreeItem with proper index maintenance (file/folder: `regenerateAndReload`, node: `reloadTreeIndex`)
- [ ] `deleteNodePermanently` accepts IndexNodeTreeItem (parallel to `removeNode` with `permanent: true`)
- [ ] All index-mode edits use `resolveIndexNodeForEdit()` (not `documentUri`)
- [ ] File-creating ops use `regenerateAndReload(wsRoot)` (Fact #48)
- [ ] YAML-only ops use `reloadTreeIndex()` (Fact #48)
- [ ] No handler uses bare `treeProvider.refresh()`
- [ ] `npm run compile` succeeds
- [ ] All changes committed
