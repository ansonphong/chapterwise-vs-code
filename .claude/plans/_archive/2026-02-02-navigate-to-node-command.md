# Navigate To Node Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the missing `navigateToNode` command handler so clicking on nested nodes in the tree view opens them in Writer View.

**Architecture:** Follow the exact pattern of `navigateToField` (lines 722-793 in extension.ts). Extract `_parent_file` and node ID from the tree item, resolve the file path, parse it, find the target node by ID, and open Writer View focused on that node.

**Tech Stack:** VS Code Extension API, TypeScript, existing writerViewManager

---

## Background Context

The tree view displays nodes from the generated `.index.codex.json` with `_node_kind` discriminator:
- `'file'` → opens file in Writer View (works via `openIndexFileInWriterView`)
- `'field'` → opens specific field in Writer View (works via `navigateToField`)
- `'node'` → **BROKEN** - command defined in treeProvider.ts but no handler in extension.ts

**Reference code in treeProvider.ts (lines 221-227):**
```typescript
} else if (isNode) {
  this.command = {
    command: 'chapterwiseCodex.navigateToNode',
    title: '',
    arguments: [this],
  };
}
```

---

## Task 1: Add navigateToNode Command Handler

**Files:**
- Modify: `src/extension.ts:793` (insert after `navigateToField` handler)

**Step 1: Locate insertion point**

Open `src/extension.ts` and find line 793 (the closing of `navigateToField` handler):
```typescript
    )
  );

  // Navigate to Node in Code View (alternative to Writer View)
```

Insert the new handler between line 793 and line 795.

**Step 2: Add the command handler**

Insert this code after line 793:

```typescript
  // Navigate to a specific node within a codex file (from index tree)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.navigateToNode',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No node selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const entityId = node.id;

        if (!parentFile || !entityId) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or node ID');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        // Resolve file path
        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        // Parse file to create CodexDocument
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const codexDoc = parseCodex(fileContent);

        if (!codexDoc || !codexDoc.rootNode) {
          vscode.window.showErrorMessage('Failed to parse codex file');
          return;
        }

        // Find the target node by ID
        const targetNode = findNodeById(codexDoc.rootNode, entityId);

        if (!targetNode) {
          vscode.window.showErrorMessage(`Node ${entityId} not found in file`);
          return;
        }

        // Create document URI and tree item for Writer View
        const documentUri = vscode.Uri.file(filePath);
        const tempTreeItem = new CodexTreeItem(
          targetNode,
          documentUri,
          targetNode.children.length > 0,
          false,
          false
        );

        // Open Writer View focused on this node
        await writerViewManager.openWriterView(tempTreeItem);
      }
    )
  );
```

**Step 3: Verify compile**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat(extension): add navigateToNode command handler

When clicking on nested nodes (_node_kind === 'node') in the tree view,
opens the Writer View focused on that specific node.

Follows the same pattern as navigateToField handler.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Manual Verification

**Step 1: Launch extension in debug mode**

Run: Press F5 in VS Code (or Run → Start Debugging)
Expected: New VS Code window opens with extension loaded

**Step 2: Generate index for test folder**

1. Open a folder containing `.codex.yaml` files with nested nodes
2. Run command: "ChapterWise: Generate Index"
3. Verify `.index.codex.json` is created

**Step 3: Set context and expand tree**

1. Right-click folder in Explorer → "Set as Codex Context"
2. In Codex Navigator sidebar, expand a file node
3. Observe nested nodes with `_node_kind === 'node'` appear as children

**Step 4: Test node click**

1. Click on a nested node (not a file, not a field)
2. Expected: Writer View opens, focused on that specific node
3. Verify the node's fields (summary, body, etc.) are displayed

**Step 5: Verify error handling**

1. Test with invalid node (if possible)
2. Expected: Appropriate error message shown

---

## Verification Checklist

After implementation:

- [ ] `npm run compile` - zero errors
- [ ] Click on file node → Writer View opens (existing behavior preserved)
- [ ] Click on field node → Writer View opens to specific field (existing behavior preserved)
- [ ] Click on nested node (`_node_kind === 'node'`) → Writer View opens focused on that node
- [ ] Error messages appear for edge cases (missing file, missing node ID)

---

## Files Summary

| File | Change | Lines |
|------|--------|-------|
| `src/extension.ts` | Add `navigateToNode` command handler | Insert ~55 lines after line 793 |

---

## Dependencies

This handler depends on:
- `IndexNodeTreeItem` from `./treeProvider` (already imported)
- `CodexTreeItem` from `./treeProvider` (already imported)
- `findNodeById` helper (already exists in extension.ts)
- `writerViewManager` (already instantiated)
- `parseCodex` from `./codexModel` (already imported)
