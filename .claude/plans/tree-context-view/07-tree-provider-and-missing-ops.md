# Stage 7: Tree Provider + Missing Operations

> **Master plan:** `00-master-plan.md` — execute via Ralph Loop
>
> **Shared reference:** See `codebase-facts.md` for all codebase facts.
> **Prerequisites:** Stage 2 (ClipboardManager), Stage 6 (command handlers)
> **Review findings addressed:** R2-10, R3-7, R3-OQ

**Goal:** Add cut indicator to tree rendering, implement Inline This File, Add Subfolder, and multi-select batch operations.

**Architecture:** TreeProvider gets ClipboardManager integration (Task 11), then extension.ts/structureEditor.ts get remaining operations (Task 12).

---

## Task 11: TreeProvider — Cut Indicator + ClipboardManager Integration

**Files:**
- Modify: `src/treeProvider.ts`
- Modify: `src/extension.ts`

### Step 1: Add clipboardManager to CodexTreeProvider

```typescript
// In CodexTreeProvider class:
private clipboardManager?: ClipboardManager;

setClipboardManager(cm: ClipboardManager): void {
  this.clipboardManager = cm;
  cm.onDidChange(() => this.refresh());
}

isNodeCut(nodeId: string): boolean {
  return this.clipboardManager?.isCut(nodeId) ?? false;
}
```

### Step 2: Update tree item rendering

In constructors of `CodexTreeItem` and `IndexNodeTreeItem`, after setting `contextValue`:
```typescript
// Keep contextValue unchanged (menus still work)
// CodexTreeItem: nodeId = this.codexNode.id
// IndexNodeTreeItem: nodeId = this.indexNode.id
const nodeId = /* extract id from the appropriate node property */;
if (provider.isNodeCut(nodeId)) {
  this.description = `${this.description || ''} (cut)`.trim();
}
```

### Step 3: Wire in extension.ts activate()

```typescript
treeProvider.setClipboardManager(clipboardManager);
```

### Step 4: Verify build

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

### Step 5: Commit

```bash
git add src/treeProvider.ts src/extension.ts
git commit -m "feat: add cut indicator and clipboardManager integration to tree provider"
```

---

## Task 12: Missing Operations — Inline This File, Add Subfolder, Multi-Select

**Files:**
- Modify: `src/structureEditor.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

### Step 1: Add `inlineThisFile` to structureEditor

Reverse of `extractNodeToFile`. Available on include-reference nodes only.

```typescript
async inlineThisFile(
  document: vscode.TextDocument,
  includeNode: CodexNode,
  workspaceRoot: string,
  deleteOriginal: boolean = false
): Promise<boolean> {
  // Fact #34: property is `includePath`, not `include`
  const targetPath = includeNode.includePath;
  if (!targetPath) return false;
  const fullPath = path.resolve(path.dirname(document.uri.fsPath), targetPath);

  // Fact #47: Path traversal check — ensure resolved path is within workspace
  const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
  if (!isPathWithinWorkspace(fullPath, workspaceRoot)) {
    throw new Error(`Include path resolves outside workspace: ${targetPath}`);
  }
  const targetDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
  const yamlDoc = YAML.parseDocument(targetDoc.getText());
  const parentYaml = YAML.parseDocument(document.getText());
  const nodePath = this.buildYamlPath(includeNode.path);
  parentYaml.setIn(nodePath, yamlDoc.toJS());
  const newText = parentYaml.toString();
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), newText);
  await vscode.workspace.applyEdit(edit);
  await document.save();
  if (deleteOriginal) {
    await vscode.workspace.fs.delete(vscode.Uri.file(fullPath), { useTrash: false });
  }
  return true;
}
```

### Step 2: Register `inlineThisFile` command in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.inlineThisFile', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    if (!treeItem) return;

    let doc: vscode.TextDocument;
    let node: any;

    if (treeItem instanceof CodexTreeItem) {
      // Fact #34: check includePath, not include
      if (!treeItem.codexNode.includePath) {
        vscode.window.showInformationMessage('This node is not an include reference');
        return;
      }
      doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
      node = treeItem.codexNode;
    } else if (treeItem instanceof IndexNodeTreeItem) {
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
      if (!resolved || !resolved.node.includePath) {
        vscode.window.showInformationMessage('This node is not an include reference');
        return;
      }
      doc = resolved.doc;
      node = resolved.node;
    } else {
      return;
    }

    const wsRoot = getWorkspaceRoot();
    if (!wsRoot) return;

    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Keep original file', value: false },
        { label: 'Delete original file', value: true },
      ],
      { placeHolder: 'What to do with the original file?' }
    );
    if (!choice) return;

    const { getStructureEditor } = await import('./structureEditor');
    const editor = getStructureEditor();
    const result = await editor.inlineThisFile(doc, node, wsRoot, choice.value);
    if (result) {
      // Disk mutation if deleteOriginal, otherwise YAML-only
      if (choice.value) {
        await regenerateAndReload(wsRoot);
      } else {
        await reloadTreeIndex();
      }
    }
  })
);
```

### Step 3: Register `addChildFolder` command

```typescript
'chapterwiseCodex.addChildFolder', async (treeItem?: IndexNodeTreeItem) => {
  if (!treeItem) return;
  const nodeKind = (treeItem.indexNode as any)._node_kind;
  if (nodeKind !== 'folder') return;
  const folderName = await vscode.window.showInputBox({ prompt: 'Enter subfolder name' });
  if (!folderName) return;
  // Sanitize folder name: reject path separators and traversal patterns
  if (/[/\\]/.test(folderName) || folderName === '..' || folderName === '.') {
    vscode.window.showErrorMessage('Invalid folder name');
    return;
  }
  // FIX R3-7: single getWorkspaceRoot() call, no duplicate const
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return;
  const parentPath = treeItem.indexNode._computed_path || '';
  const newFolderPath = path.join(wsRoot, parentPath, folderName);
  // Fact #47: verify resolved path stays within workspace
  const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
  if (!isPathWithinWorkspace(newFolderPath, wsRoot)) {
    vscode.window.showErrorMessage('Folder path resolves outside workspace');
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(newFolderPath));
  const { getOrderingManager } = await import('./orderingManager');
  const om = getOrderingManager(wsRoot);
  await om.addEntry(parentPath, { name: folderName, type: 'folder', children: [] });
  // Fact #48: new directory created on disk — regenerate index cache
  await regenerateAndReload(wsRoot);
}
```

### Step 4: Multi-select batch operations (R3-OQ)

VS Code TreeView passes `(item: T, selectedItems: T[])`, NOT variadic `...args`:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.batchMoveToTrash',
    async (item: CodexTreeItem | IndexNodeTreeItem, selectedItems: (CodexTreeItem | IndexNodeTreeItem)[]) => {
      const items = selectedItems || [item];
      const confirm = await vscode.window.showWarningMessage(
        `Move ${items.length} items to trash?`, { modal: true }, 'Move to Trash'
      );
      if (confirm !== 'Move to Trash') return;
      for (const ti of items) {
        await vscode.commands.executeCommand('chapterwiseCodex.moveToTrash', ti);
      }
      // Note: each moveToTrash call triggers its own regenerateAndReload.
      // Future optimization: batch the mutations, then regenerate once.
    }
  ),
  vscode.commands.registerCommand('chapterwiseCodex.batchAddTags',
    async (item: CodexTreeItem | IndexNodeTreeItem, selectedItems: (CodexTreeItem | IndexNodeTreeItem)[]) => {
      const items = selectedItems || [item];
      const tagsInput = await vscode.window.showInputBox({ prompt: `Add tags to ${items.length} items (comma-separated)` });
      if (!tagsInput) return;
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      const wsRoot = getWorkspaceRoot();
      for (const ti of items) {
        if (ti instanceof CodexTreeItem) {
          const doc = await vscode.workspace.openTextDocument(ti.documentUri);
          await editor.addTagsToNode(doc, ti.codexNode, tags);
        } else if (ti instanceof IndexNodeTreeItem) {
          if (!wsRoot) continue;
          const resolved = await resolveIndexNodeForEdit(ti, wsRoot);
          if (resolved) await editor.addTagsToNode(resolved.doc, resolved.node, tags);
        }
      }
      await reloadTreeIndex(); // YAML-only edits
    }
  )
);
```

> **Fact #38 CORRECTED:** `canSelectMany` is only enabled on the Navigator view (treeProvider.ts:1417). Master view (extension.ts:221) and stacked sub-index views Index0-7 (extension.ts:232) do NOT have it. **Must add `canSelectMany: true` to both** for batch ops to work in default stacked mode.

### Step 4b: Enable multi-select on Master + stacked views

In `src/extension.ts`, update the Master view creation (~line 221):
```typescript
const masterView = vscode.window.createTreeView('chapterwiseCodexMaster', {
  treeDataProvider: masterTreeProvider,
  showCollapseAll: true,
  canSelectMany: true  // Required for batch operations in stacked mode
});
```

And in the sub-index view creation loop (~line 232):
```typescript
const view = vscode.window.createTreeView(`chapterwiseCodexIndex${i}`, {
  treeDataProvider: provider,
  showCollapseAll: true,
  canSelectMany: true  // Required for batch operations in stacked mode
});
```

### Step 5: Add `inlineThisFile` to codexNode context menu

```json
{ "command": "chapterwiseCodex.inlineThisFile", "when": "viewItem == codexNode", "group": "4_navigate@5" }
```

### Step 6: Verify build + commit

```bash
npm run compile
git add src/structureEditor.ts src/extension.ts package.json
git commit -m "feat: add Inline This File, Add Subfolder, multi-select batch operations"
```

---

## Stage 7 Completion Checklist

- [ ] ClipboardManager wired to TreeProvider
- [ ] Cut nodes show "(cut)" description in tree
- [ ] `onDidChange` event triggers tree refresh
- [ ] `inlineThisFile` method on structureEditor works
- [ ] `inlineThisFile` includes `isPathWithinWorkspace()` check (Fact #47)
- [ ] `inlineThisFile` command registered with delete-original prompt
- [ ] `addChildFolder` command creates directory + updates index (no duplicate `const wsRoot`)
- [ ] `addChildFolder` sanitizes folder name and validates path within workspace (Fact #47)
- [ ] `canSelectMany: true` added to Master view creation (extension.ts ~line 221)
- [ ] `canSelectMany: true` added to sub-index view creation loop (extension.ts ~line 232)
- [ ] `batchMoveToTrash` uses `(item, selectedItems)` signature (not variadic)
- [ ] `batchAddTags` uses `(item, selectedItems)` signature
- [ ] `inlineThisFile` added to codexNode context menu
- [ ] `npm run compile` succeeds
- [ ] All changes committed
