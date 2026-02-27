# Stage 1: Foundation — buildYamlPath Fix + Unified Ordering Migration

> **Master plan:** `00-master-plan.md` — execute via Ralph Loop
>
> **Shared reference:** See `codebase-facts.md` for all codebase facts.
> **Review findings addressed:** R1-6 (partial — defines helpers), R1-8, R1-9, R2-1, R2-2, R2-3, R2-14, R3-1, R3-2, R3-8

**Goal:** Fix the buildYamlPath bug that corrupts nested node operations, then migrate the entire ordering system from numeric `order` fields to `index.codex.yaml` array position.

**Architecture:** Two sequential tasks — bug fix first (Task 0), then ordering migration (Task 0.5). The ordering migration touches 7 files but is self-contained.

---

## Task 0: Fix buildYamlPath Bug

**Files:**
- Modify: `src/structureEditor.ts:1018-1030`
- Create/Modify: `src/structureEditor.test.ts`

**Step 1: Write failing test**

```typescript
// src/structureEditor.test.ts
import { describe, it, expect } from 'vitest';
import { CodexStructureEditor } from './structureEditor';

describe('CodexStructureEditor', () => {
  describe('buildYamlPath', () => {
    const editor = new CodexStructureEditor();
    const buildYamlPath = (editor as any).buildYamlPath.bind(editor);

    it('passes through empty path for root node', () => {
      expect(buildYamlPath([])).toEqual([]);
    });

    it('passes through first-level child path', () => {
      expect(buildYamlPath(['children', 0])).toEqual(['children', 0]);
    });

    it('passes through nested child path', () => {
      expect(buildYamlPath(['children', 0, 'children', 1])).toEqual(['children', 0, 'children', 1]);
    });

    it('handles deep nesting', () => {
      const input = ['children', 2, 'children', 0, 'children', 3];
      expect(buildYamlPath(input)).toEqual(input);
    });
  });
});
```

**Step 2: Run test — verify FAIL**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`
Expected: FAIL — `['children', 0]` produces `['children', 'children', 0]`

**Step 3: Fix buildYamlPath**

Replace at `src/structureEditor.ts:1018-1030`:

```typescript
/**
 * Build YAML path from PathSegment array.
 * node.path already contains 'children' segments from codexModel parsing,
 * so this is a simple pass-through.
 */
private buildYamlPath(pathSegments: PathSegment[]): PathSegment[] {
  return [...pathSegments];
}
```

**Step 4: Run test — verify PASS**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`
Expected: All PASS

**Step 5: Run full test suite**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm test`

**Step 6: Commit**

```bash
git add src/structureEditor.ts src/structureEditor.test.ts
git commit -m "fix: buildYamlPath was injecting duplicate 'children' segments (match colorManager pattern)"
```

---

## Task 0.5: Migrate to Unified Ordering System

**Files:**
- Create: `src/orderingManager.ts`
- Create: `src/orderingManager.test.ts`
- Modify: `src/indexGenerator.ts`
- Modify: `src/structureEditor.ts`
- Modify: `src/dragDropController.ts`
- Modify: `src/extension.ts`
- Modify: `src/indexParser.ts`
- Modify: `package.json`

> **Prerequisite:** Task 0 (buildYamlPath fix) must be complete.

### Step 1: Create OrderingManager

Create `src/orderingManager.ts` with `OrderingManager` class:
- `readIndex()` / `writeIndex()` — read/write `index.codex.yaml`
- `generateFromFilesystem()` — initial scan
- `syncWithFilesystem()` — auto-discover new files, prune removed
- `findFolderChildren()` — navigate tree by path
- `moveUp()` / `moveDown()` — swap adjacent siblings
- `moveToPosition()` — drag-and-drop (remove + insert at index)
- `moveToFolder()` — cross-folder move
- `addEntry()` / `removeEntry()` — create/delete entries

Singleton: `getOrderingManager(workspaceRoot)` / `disposeOrderingManager()`.

**IMPORTANT (Fact #25, R3-8):** `scanDirectory()` must check `.codex.yaml`, `.codex.json`, AND `.md` files. `syncFolder()` auto-discovery must also check all three extensions, not just `.codex.yaml`.

**Implementation details:** The `OrderingManager` class must be fully implemented inline. Key methods:
- `readIndex()`: reads `index.codex.yaml` via `YAML.parse(fs.readFileSync(...))`, returns parsed object or `null`
- `writeIndex(data)`: writes via `fs.writeFileSync(path, YAML.stringify(data))`
- `generateFromFilesystem()`: scans workspace root recursively, builds `index.codex.yaml` tree structure from directory listing
- `syncWithFilesystem()`: reads existing `index.codex.yaml`, compares against actual files on disk, adds new files not in index, removes entries for deleted files. Must scan `.codex.yaml`, `.codex.json`, AND `.md` files (Fact #25)
- `findFolderChildren(folderPath)`: navigates the tree by splitting path segments, returns children array at that level
- `moveUp(folderPath, name)` / `moveDown(folderPath, name)`: find item in parent's children array, swap with adjacent sibling
- `moveToPosition(folderPath, name, newIndex)`: remove from current position, insert at `newIndex`
- `moveToFolder(sourcePath, destFolder)`: remove from source parent, add to destination parent's children
- `addEntry(folderPath, entry)` / `removeEntry(folderPath, name)`: add/remove from parent's children array
- Singleton via `getOrderingManager(wsRoot)` / `disposeOrderingManager()`

### Step 2: Write OrderingManager tests

Create `src/orderingManager.test.ts` with tests for:
- `findFolderChildren` (empty path, valid path, non-existent)
- `moveUp` (swap, first item returns false)
- `moveDown` (swap)
- `moveToPosition` (drag-drop reorder)
- `moveToFolder` (cross-folder)
- `addEntry` / `removeEntry`

**Test implementation:** Write tests using vitest with `vi.mock('fs')` and `vi.mock('path')` as needed. Key test cases:
- `findFolderChildren('')` returns root children
- `findFolderChildren('Chapters')` returns children of a nested folder
- `findFolderChildren('nonexistent')` returns empty array
- `moveUp('', 'second-item')` swaps with previous sibling, returns `true`
- `moveUp('', 'first-item')` returns `false` (already at top)
- `moveDown('', 'first-item')` swaps with next sibling
- `moveToPosition('', 'item', 2)` moves item to index 2
- `moveToFolder('Chapters/scene.codex.yaml', 'Archive')` removes from Chapters, adds to Archive
- `addEntry('', { name: 'new.codex.yaml', type: 'file' })` adds to root children
- `removeEntry('', 'old.codex.yaml')` removes from root children
- Use a mock `index.codex.yaml` structure for all tests

### Step 3: Run tests — verify pass

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/orderingManager.test.ts`

### Step 4: Modify indexGenerator.ts

**4a:** `sortChildrenRecursive()` (line 1039-1058) → no-op (array position IS order). **Legacy compat (Fact #50):** If `index.codex.yaml` doesn't exist yet (pre-migration project), fall back to sorting by existing `order` field, then auto-generate `index.codex.yaml` from the result. This ensures existing projects don't break on upgrade.
**4b:** `buildHierarchy()` → read `index.codex.yaml`, apply YAML order via `applyYamlOrder()` helper. If no `index.codex.yaml` exists, the `OrderingManager.syncWithFilesystem()` (called at startup, Step 8) will auto-generate one from disk scan — so legacy projects get migrated on first launch.
**4c:** Remove `applyPerFolderOrders()` (line 492-518)
**4d:** Update `mergePerFolderIndexes()` — remove order-merging logic
**4e:** Update `generatePerFolderIndex()` (line 1171) — stop assigning sequential `order` values (line ~1259). Per-folder index is cache-only; inherits order from `index.codex.yaml`.
**4f:** Verify `cascadeRegenerateIndexes()` (line 1299) — calls `generatePerFolderIndex()` + `generateIndex()`. After 4e, cascade still works but no longer writes `order` values. Verify output.
**4g:** Verify `generateFolderHierarchy()` (line 1334) — recursively calls `generatePerFolderIndex()`. Same: verify output is correct after 4e.
**4h:** Verify `setContextFolder` command (extension.ts:1881) — calls `generateFolderHierarchy()` then `treeProvider.setContextFolder()`. Full flow: user clicks folder → regenerate cache from `index.codex.yaml` → tree reads cache → correct order. Must test end-to-end.

**4i:** Update `src/indexParser.ts` — mark `order` field as deprecated on `IndexChildNode` interface (line 27). Add JSDoc `@deprecated Use index.codex.yaml array position instead.` to the `order?: number` field. This file is listed in Fact #17 as a key ordering file. The field is kept for backward compat (Fact #50) but must be marked deprecated so no new code relies on it.

> **Fact #26:** indexGenerator.ts is function-based. `applyYamlOrder()` must be a standalone function.

### Step 5: Modify structureEditor.ts — rewrite ordering methods

**5a:** Replace `reorderFileInIndex()` → delegates to `om.moveToPosition()`
**5b:** Replace `moveFileUp()` → delegates to `om.moveUp()`
**5c:** Replace `moveFileDown()` → delegates to `om.moveDown()`
**5d:** REMOVE `autofixFolderOrder()` (line 1344-1442)

### Step 6: Modify dragDropController.ts

**6a:** Remove `calculateNewOrder()` (line 620-667)
**6b:** Update `handleIndexDrop()` → calculate target array index, call `editor.reorderFileInIndex()`

### Step 7: Remove autofixFolderOrder from package.json AND extension.ts

- Remove command from `package.json` contributes.commands
- Remove context menu entry from contributes.menus
- Remove keybinding (if any)
- **Remove handler at extension.ts:1700** (Fact #39)

### Step 8: Add shared helpers to extension.ts

Add at module scope (used by ALL later stages):

```typescript
/** Get the first workspace folder's root path. */
function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Resolve an IndexNodeTreeItem to its backing document + CodexNode. */
async function resolveIndexNodeForEdit(treeItem: any, wsRoot: string): Promise<{ doc: vscode.TextDocument; node: any } | null> {
  const nodeKind = treeItem.indexNode?._node_kind;
  if (nodeKind === 'file') {
    const computedPath = treeItem.indexNode._computed_path;
    if (!computedPath) return null;
    const fullPath = path.join(wsRoot, computedPath);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
    const { parseCodex } = await import('./codexModel');
    const codexDoc = parseCodex(doc.getText());
    if (!codexDoc || !codexDoc.rootNode) return null;  // Fact #33: rootNode not root
    return { doc, node: codexDoc.rootNode };
  }
  const parentFile = treeItem.indexNode?._parent_file;
  if (!parentFile) {
    if (treeItem.resourceUri) {
      const doc = await vscode.workspace.openTextDocument(treeItem.resourceUri);
      const { parseCodex } = await import('./codexModel');
      const codexDoc = parseCodex(doc.getText());
      if (!codexDoc) return null;
      const node = codexDoc.allNodes.find((n: any) => n.id === treeItem.indexNode.id);
      return node ? { doc, node } : null;
    }
    return null;
  }
  const fullPath = path.join(wsRoot, parentFile);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
  const { parseCodex } = await import('./codexModel');
  const codexDoc = parseCodex(doc.getText());
  if (!codexDoc) return null;
  const node = codexDoc.allNodes.find((n: any) => n.id === treeItem.indexNode.id);
  return node ? { doc, node } : null;
}

/** Reload the tree index from disk. Safe for null contextFolder (R3-2).
 *  WARNING (Fact #48): This only READS existing .index.codex.json cache.
 *  If files were mutated on disk, call regenerateAndReload() instead. */
async function reloadTreeIndex(): Promise<void> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) return;
  const contextFolder = treeProvider.getContextFolder();
  if (contextFolder) {
    await treeProvider.setContextFolder(contextFolder, wsRoot);
  } else if (treeProvider.getNavigationMode() === 'index') {
    await treeProvider.setContextFolder('.', wsRoot);
  } else {
    treeProvider.refresh();
  }
}

/** Regenerate .index.codex.json cache from disk, THEN reload tree + stacked views.
 *  Use after operations that mutate files on disk (create/delete/move/rename/duplicate).
 *  Fact #52: generateIndex() alone only rebuilds TOP-LEVEL index. Must use
 *  cascadeRegenerateIndexes() for per-folder indexes, and refresh stacked views. */
async function regenerateAndReload(wsRoot: string): Promise<void> {
  const contextFolder = treeProvider.getContextFolder();
  const folderToRegenerate = contextFolder || '.';

  // Step 1: Regenerate per-folder + top-level indexes (NOT just generateIndex)
  const { cascadeRegenerateIndexes } = await import('./indexGenerator');
  await cascadeRegenerateIndexes(wsRoot, folderToRegenerate);

  // Step 2: Reload Navigator tree from regenerated cache
  await reloadTreeIndex();

  // Step 3: Refresh stacked views (Master + Index0-7) if in stacked mode
  if (multiIndexManager && masterTreeProvider) {
    await multiIndexManager.discoverIndexes(wsRoot);
    masterTreeProvider.setManager(multiIndexManager, wsRoot);
    const subIndexes = multiIndexManager.getSubIndexes();
    subIndexes.forEach((index: any, i: number) => {
      if (i < subIndexProviders.length) {
        subIndexProviders[i].setIndex(index);
      }
    });
    for (let i = subIndexes.length; i < subIndexProviders.length; i++) {
      subIndexProviders[i].setIndex(null);
    }
  }
}
```

Add startup sync in `activate()` (Fact #30 — sync, use async IIFE):

```typescript
const wsRoot = getWorkspaceRoot();
if (wsRoot) {
  void (async () => {
    try {
      const { getOrderingManager } = await import('./orderingManager');
      const om = getOrderingManager(wsRoot);
      await om.syncWithFilesystem();
    } catch (e) {
      console.error('[ChapterWise Codex] Failed to sync ordering index:', e);
    }
  })();
}
```

### Step 9: Verify build + run tests

Run: `cd /Users/phong/Projects/chapterwise-codex && npm test && npm run compile`

### Step 10: Commit

```bash
git add src/orderingManager.ts src/orderingManager.test.ts src/indexGenerator.ts src/structureEditor.ts src/dragDropController.ts src/extension.ts src/indexParser.ts package.json
git commit -m "feat: migrate to unified ordering system (index.codex.yaml array position = source of truth)"
```

---

## Stage 1 Completion Checklist

- [ ] `buildYamlPath` returns pass-through (tests pass)
- [ ] `OrderingManager` created with full test coverage
- [ ] `indexGenerator.ts` reads order from `index.codex.yaml`
- [ ] `structureEditor.ts` ordering methods delegate to OrderingManager
- [ ] `dragDropController.ts` uses array position, not fractional `order`
- [ ] `indexParser.ts` `IndexChildNode.order` marked `@deprecated`
- [ ] `autofixFolderOrder` removed from package.json, extension.ts, structureEditor.ts
- [ ] `getWorkspaceRoot()`, `resolveIndexNodeForEdit()`, `reloadTreeIndex()`, `regenerateAndReload()` added to extension.ts
- [ ] `regenerateAndReload()` uses `cascadeRegenerateIndexes()` (NOT bare `generateIndex()`) — Fact #52
- [ ] `regenerateAndReload()` refreshes stacked views (Master + Index0-7) after index regeneration — Fact #52
- [ ] Startup sync via async IIFE in `activate()`
- [ ] `cascadeRegenerateIndexes()` produces correct cache without `order` values
- [ ] `generateFolderHierarchy()` produces correct cache without `order` values
- [ ] `setContextFolder` command (extension.ts:1881) end-to-end flow verified
- [ ] `npm test` passes
- [ ] `npm run compile` succeeds
- [ ] All changes committed
