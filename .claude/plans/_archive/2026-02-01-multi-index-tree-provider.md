# Multi-Index Tree Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the ChapterWise Codex VS Code extension to discover and display multiple `index.codex.yaml` files as separate, collapsible stacked views in the sidebar, with a master index showing only orphan files not covered by sub-indexes.

**Architecture:** Pre-register a pool of view slots in package.json (e.g., 8 slots). A new `MultiIndexManager` class discovers indexes on context set, dynamically shows/hides view slots, and manages orphan detection. Each sub-index gets its own collapsible section. The master index filters out files claimed by sub-indexes.

**Tech Stack:** TypeScript, VS Code Extension API (TreeDataProvider, TreeView), YAML parsing

---

## Task 1: Add Configuration Setting

**Files:**
- Modify: `package.json:489-582` (configuration section)

**Step 1: Add the indexDisplayMode setting**

In `package.json`, add this property inside `contributes.configuration.properties`:

```json
"chapterwiseCodex.indexDisplayMode": {
  "type": "string",
  "enum": ["nested", "stacked", "tabs"],
  "enumDescriptions": [
    "Show all indexes merged into single tree (current behavior)",
    "Show each index as a separate collapsible section",
    "Show each index in a tabbed interface (future)"
  ],
  "default": "stacked",
  "description": "How to display multiple index.codex.yaml files in the navigator"
}
```

**Step 2: Verify the setting appears**

Run: `npm run compile && code --extensionDevelopmentPath=.`
Expected: Setting appears in VS Code settings under "ChapterWise Codex"

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat(tree): add indexDisplayMode setting"
```

---

## Task 2: Pre-Register View Slots in package.json

**Files:**
- Modify: `package.json:219-226` (views section)

**Step 1: Add pool of view slots**

Replace the current `views.chapterwiseCodex` array with:

```json
"views": {
  "chapterwiseCodex": [
    {
      "id": "chapterwiseCodexMaster",
      "name": "Master Index",
      "when": "chapterwiseCodex.hasMultipleIndexes"
    },
    {
      "id": "chapterwiseCodexIndex0",
      "name": "Index 1",
      "when": "chapterwiseCodex.index0Visible"
    },
    {
      "id": "chapterwiseCodexIndex1",
      "name": "Index 2",
      "when": "chapterwiseCodex.index1Visible"
    },
    {
      "id": "chapterwiseCodexIndex2",
      "name": "Index 3",
      "when": "chapterwiseCodex.index2Visible"
    },
    {
      "id": "chapterwiseCodexIndex3",
      "name": "Index 4",
      "when": "chapterwiseCodex.index3Visible"
    },
    {
      "id": "chapterwiseCodexIndex4",
      "name": "Index 5",
      "when": "chapterwiseCodex.index4Visible"
    },
    {
      "id": "chapterwiseCodexIndex5",
      "name": "Index 6",
      "when": "chapterwiseCodex.index5Visible"
    },
    {
      "id": "chapterwiseCodexIndex6",
      "name": "Index 7",
      "when": "chapterwiseCodex.index6Visible"
    },
    {
      "id": "chapterwiseCodexIndex7",
      "name": "Index 8",
      "when": "chapterwiseCodex.index7Visible"
    },
    {
      "id": "chapterwiseCodexNavigator",
      "name": "ChapterWise Codex Navigator",
      "when": "!chapterwiseCodex.hasMultipleIndexes"
    }
  ]
}
```

**Step 2: Update viewsWelcome for master index**

Add welcome content for the master index:

```json
"viewsWelcome": [
  {
    "view": "chapterwiseCodexMaster",
    "contents": "No orphan files found.\n\nAll files are organized within sub-indexes."
  },
  {
    "view": "chapterwiseCodexNavigator",
    "contents": "No Codex file is currently open.\n\nOpen a .codex.yaml or .codex.json file to see its structure here.\n\n[Open Codex File](command:workbench.action.files.openFile)"
  }
]
```

**Step 3: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat(tree): pre-register view slots for multi-index support"
```

---

## Task 3: Create MultiIndexManager Class

**Files:**
- Create: `src/multiIndexManager.ts`

**Step 1: Create the file with interface definitions**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseIndexFile, IndexDocument } from './indexParser';

/**
 * Represents a discovered index file
 */
export interface DiscoveredIndex {
  /** Absolute path to the index file */
  path: string;
  /** Relative path from workspace root */
  relativePath: string;
  /** Parsed index document */
  document: IndexDocument;
  /** Display name for the view */
  displayName: string;
  /** Files/folders this index claims ownership of */
  coveredPaths: Set<string>;
  /** Assigned view slot (0-7) */
  viewSlot?: number;
}

/**
 * Manages discovery and display of multiple index.codex.yaml files
 */
export class MultiIndexManager {
  private discoveredIndexes: Map<string, DiscoveredIndex> = new Map();
  private masterOrphans: string[] = [];
  private workspaceRoot: string | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Discover all index.codex.yaml files in the workspace
   */
  async discoverIndexes(workspaceRoot: string): Promise<DiscoveredIndex[]> {
    this.workspaceRoot = workspaceRoot;
    this.discoveredIndexes.clear();

    // Find all index.codex.yaml files (excluding hidden .index.codex.yaml)
    const pattern = new vscode.RelativePattern(
      workspaceRoot,
      '**/index.codex.yaml'
    );

    const indexFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

    for (const uri of indexFiles) {
      await this.loadIndex(uri.fsPath);
    }

    // Calculate orphans for master index
    this.calculateOrphans();

    // Update visibility context
    this.updateViewVisibility();

    return Array.from(this.discoveredIndexes.values());
  }

  /**
   * Load and parse a single index file
   */
  private async loadIndex(indexPath: string): Promise<void> {
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const document = parseIndexFile(content);

      if (!this.workspaceRoot) return;

      const relativePath = path.relative(this.workspaceRoot, indexPath);
      const indexDir = path.dirname(indexPath);

      // Calculate covered paths (the directory containing this index)
      const coveredPaths = new Set<string>();
      coveredPaths.add(indexDir);

      // Also add any explicitly included paths
      this.collectCoveredPaths(document.children, indexDir, coveredPaths);

      const discovered: DiscoveredIndex = {
        path: indexPath,
        relativePath,
        document,
        displayName: document.name || path.basename(path.dirname(indexPath)),
        coveredPaths
      };

      this.discoveredIndexes.set(indexPath, discovered);
    } catch (error) {
      console.error(`[MultiIndexManager] Failed to load index: ${indexPath}`, error);
    }
  }

  /**
   * Recursively collect paths covered by an index
   */
  private collectCoveredPaths(
    children: any[],
    baseDir: string,
    coveredPaths: Set<string>
  ): void {
    if (!children) return;

    for (const child of children) {
      if (child.include) {
        const includePath = path.resolve(baseDir, child.include);
        coveredPaths.add(includePath);

        // If it's a directory include, add the directory
        if (!child.include.includes('.')) {
          coveredPaths.add(includePath);
        }
      }

      if (child.children) {
        this.collectCoveredPaths(child.children, baseDir, coveredPaths);
      }
    }
  }

  /**
   * Calculate orphan files (not covered by any sub-index)
   */
  private calculateOrphans(): void {
    if (!this.workspaceRoot) return;

    // Find the master index (at workspace root)
    const masterIndexPath = path.join(this.workspaceRoot, 'index.codex.yaml');
    const masterIndex = this.discoveredIndexes.get(masterIndexPath);

    if (!masterIndex) {
      this.masterOrphans = [];
      return;
    }

    // Get all children from master index
    const masterChildren = masterIndex.document.children || [];

    // Filter to only orphans
    this.masterOrphans = masterChildren
      .filter(child => {
        // Skip sub-index includes
        if (child.include?.endsWith('index.codex.yaml')) {
          return false;
        }

        // Check if any sub-index claims this path
        const childPath = child.include
          ? path.resolve(this.workspaceRoot!, child.include)
          : null;

        if (!childPath) return true; // Inline children are orphans

        return !this.isClaimedBySubIndex(childPath);
      })
      .map(child => child.include || child.name);
  }

  /**
   * Check if a path is claimed by any sub-index
   */
  private isClaimedBySubIndex(filePath: string): boolean {
    for (const [indexPath, index] of this.discoveredIndexes) {
      // Skip the master index itself
      if (indexPath === path.join(this.workspaceRoot!, 'index.codex.yaml')) {
        continue;
      }

      for (const coveredPath of index.coveredPaths) {
        if (filePath.startsWith(coveredPath)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Update VS Code context for view visibility
   */
  private updateViewVisibility(): void {
    const indexes = Array.from(this.discoveredIndexes.values());
    const subIndexes = indexes.filter(idx =>
      idx.path !== path.join(this.workspaceRoot!, 'index.codex.yaml')
    );

    // Set hasMultipleIndexes context
    const hasMultiple = subIndexes.length > 0;
    vscode.commands.executeCommand(
      'setContext',
      'chapterwiseCodex.hasMultipleIndexes',
      hasMultiple
    );

    // Assign view slots and set visibility
    subIndexes.forEach((index, i) => {
      if (i < 8) {
        index.viewSlot = i;
        vscode.commands.executeCommand(
          'setContext',
          `chapterwiseCodex.index${i}Visible`,
          true
        );
      }
    });

    // Hide unused slots
    for (let i = subIndexes.length; i < 8; i++) {
      vscode.commands.executeCommand(
        'setContext',
        `chapterwiseCodex.index${i}Visible`,
        false
      );
    }
  }

  /**
   * Get discovered indexes (excluding master)
   */
  getSubIndexes(): DiscoveredIndex[] {
    if (!this.workspaceRoot) return [];

    const masterPath = path.join(this.workspaceRoot, 'index.codex.yaml');
    return Array.from(this.discoveredIndexes.values())
      .filter(idx => idx.path !== masterPath);
  }

  /**
   * Get the master index
   */
  getMasterIndex(): DiscoveredIndex | undefined {
    if (!this.workspaceRoot) return undefined;

    const masterPath = path.join(this.workspaceRoot, 'index.codex.yaml');
    return this.discoveredIndexes.get(masterPath);
  }

  /**
   * Get orphan file paths for master index display
   */
  getOrphanPaths(): string[] {
    return this.masterOrphans;
  }

  /**
   * Check if multi-index mode is active
   */
  isMultiIndexMode(): boolean {
    const config = vscode.workspace.getConfiguration('chapterwiseCodex');
    const mode = config.get<string>('indexDisplayMode', 'stacked');
    return mode === 'stacked' && this.getSubIndexes().length > 0;
  }
}
```

**Step 2: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/multiIndexManager.ts
git commit -m "feat(tree): add MultiIndexManager for multi-index discovery"
```

---

## Task 4: Create SubIndexTreeProvider Class

**Files:**
- Create: `src/subIndexTreeProvider.ts`

**Step 1: Create the sub-index tree provider**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { DiscoveredIndex } from './multiIndexManager';
import { IndexChildNode } from './indexParser';
import { IndexNodeTreeItem, CodexTreeItemType } from './treeProvider';

/**
 * Tree provider for a single sub-index
 */
export class SubIndexTreeProvider implements vscode.TreeDataProvider<CodexTreeItemType> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CodexTreeItemType | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private index: DiscoveredIndex | null = null;

  constructor(private viewId: string) {}

  /**
   * Set the index to display
   */
  setIndex(index: DiscoveredIndex | null): void {
    this.index = index;
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Get the current index
   */
  getIndex(): DiscoveredIndex | null {
    return this.index;
  }

  getTreeItem(element: CodexTreeItemType): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CodexTreeItemType): vscode.ProviderResult<CodexTreeItemType[]> {
    if (!this.index) {
      return [];
    }

    const workspaceRoot = path.dirname(this.index.path);
    const uri = vscode.Uri.file(this.index.path);

    if (!element) {
      // Root level - return children of this index
      return this.index.document.children.map(child =>
        this.createTreeItem(child, workspaceRoot, uri)
      );
    }

    // Return children of the element
    if (element instanceof IndexNodeTreeItem && element.indexNode.children) {
      return element.indexNode.children.map(child =>
        this.createTreeItem(child, workspaceRoot, uri)
      );
    }

    return [];
  }

  private createTreeItem(
    node: IndexChildNode,
    workspaceRoot: string,
    documentUri: vscode.Uri
  ): IndexNodeTreeItem {
    const isFolder = node.type === 'folder';
    const hasChildren = node.children && node.children.length > 0;

    return new IndexNodeTreeItem(
      node,
      workspaceRoot,
      documentUri,
      isFolder,
      !!hasChildren,
      (computedPath: string) => path.join(workspaceRoot, computedPath)
    );
  }

  /**
   * Refresh the tree
   */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
```

**Step 2: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/subIndexTreeProvider.ts
git commit -m "feat(tree): add SubIndexTreeProvider for individual index views"
```

---

## Task 5: Create MasterIndexTreeProvider Class

**Files:**
- Create: `src/masterIndexTreeProvider.ts`

**Step 1: Create the master index tree provider (orphans only)**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { MultiIndexManager, DiscoveredIndex } from './multiIndexManager';
import { IndexChildNode } from './indexParser';
import { IndexNodeTreeItem, CodexTreeItemType, CodexFileHeaderItem } from './treeProvider';

/**
 * Tree provider for the master index (shows only orphans)
 */
export class MasterIndexTreeProvider implements vscode.TreeDataProvider<CodexTreeItemType> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CodexTreeItemType | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private manager: MultiIndexManager | null = null;
  private workspaceRoot: string | null = null;

  constructor() {}

  /**
   * Set the multi-index manager
   */
  setManager(manager: MultiIndexManager, workspaceRoot: string): void {
    this.manager = manager;
    this.workspaceRoot = workspaceRoot;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: CodexTreeItemType): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CodexTreeItemType): vscode.ProviderResult<CodexTreeItemType[]> {
    if (!this.manager || !this.workspaceRoot) {
      return [];
    }

    const masterIndex = this.manager.getMasterIndex();
    if (!masterIndex) {
      return [];
    }

    const uri = vscode.Uri.file(masterIndex.path);

    if (!element) {
      // Root level - show header + orphan files only
      const items: CodexTreeItemType[] = [];

      // Add header
      items.push(new CodexFileHeaderItem(uri, true, 'Orphan Files'));

      // Get orphan paths
      const orphanPaths = this.manager.getOrphanPaths();

      // Filter master index children to only orphans
      const orphanChildren = masterIndex.document.children.filter(child => {
        // Skip sub-index includes
        if (child.include?.endsWith('index.codex.yaml')) {
          return false;
        }

        // Check if this child is in orphan paths
        const childPath = child.include || child.name;
        return orphanPaths.includes(childPath);
      });

      // Create tree items for orphans
      for (const child of orphanChildren) {
        items.push(this.createTreeItem(child, this.workspaceRoot, uri));
      }

      return items;
    }

    // Header has no children
    if (element instanceof CodexFileHeaderItem) {
      return [];
    }

    // Return children of the element
    if (element instanceof IndexNodeTreeItem && element.indexNode.children) {
      return element.indexNode.children.map(child =>
        this.createTreeItem(child, this.workspaceRoot!, uri)
      );
    }

    return [];
  }

  private createTreeItem(
    node: IndexChildNode,
    workspaceRoot: string,
    documentUri: vscode.Uri
  ): IndexNodeTreeItem {
    const isFolder = node.type === 'folder';
    const hasChildren = node.children && node.children.length > 0;

    return new IndexNodeTreeItem(
      node,
      workspaceRoot,
      documentUri,
      isFolder,
      !!hasChildren,
      (computedPath: string) => path.join(workspaceRoot, computedPath)
    );
  }

  /**
   * Refresh the tree
   */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
```

**Step 2: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/masterIndexTreeProvider.ts
git commit -m "feat(tree): add MasterIndexTreeProvider for orphan files"
```

---

## Task 6: Update Extension to Register Multiple Tree Views

**Files:**
- Modify: `src/extension.ts`

**Step 1: Import new classes**

Add imports at the top of extension.ts:

```typescript
import { MultiIndexManager } from './multiIndexManager';
import { SubIndexTreeProvider } from './subIndexTreeProvider';
import { MasterIndexTreeProvider } from './masterIndexTreeProvider';
```

**Step 2: Add properties for multi-index support**

In the activate function, add:

```typescript
// Multi-index support
let multiIndexManager: MultiIndexManager | undefined;
let masterTreeProvider: MasterIndexTreeProvider | undefined;
const subIndexProviders: SubIndexTreeProvider[] = [];
const subIndexViews: vscode.TreeView<CodexTreeItemType>[] = [];
```

**Step 3: Create and register tree views**

After the existing treeProvider creation, add:

```typescript
// Create multi-index manager
multiIndexManager = new MultiIndexManager(context);

// Create master index tree provider
masterTreeProvider = new MasterIndexTreeProvider();
const masterView = vscode.window.createTreeView('chapterwiseCodexMaster', {
  treeDataProvider: masterTreeProvider,
  showCollapseAll: true
});
context.subscriptions.push(masterView);

// Create sub-index tree providers (8 slots)
for (let i = 0; i < 8; i++) {
  const provider = new SubIndexTreeProvider(`chapterwiseCodexIndex${i}`);
  subIndexProviders.push(provider);

  const view = vscode.window.createTreeView(`chapterwiseCodexIndex${i}`, {
    treeDataProvider: provider,
    showCollapseAll: true
  });
  subIndexViews.push(view);
  context.subscriptions.push(view);
}
```

**Step 4: Update setContextFolder to use multi-index**

In the setContextFolder command handler, add logic to discover and assign indexes:

```typescript
// After setting context folder, discover indexes
if (multiIndexManager && workspaceRoot) {
  const config = vscode.workspace.getConfiguration('chapterwiseCodex');
  const displayMode = config.get<string>('indexDisplayMode', 'stacked');

  if (displayMode === 'stacked') {
    const indexes = await multiIndexManager.discoverIndexes(workspaceRoot);

    // Update master tree provider
    if (masterTreeProvider) {
      masterTreeProvider.setManager(multiIndexManager, workspaceRoot);
    }

    // Assign sub-indexes to view slots
    const subIndexes = multiIndexManager.getSubIndexes();
    subIndexes.forEach((index, i) => {
      if (i < subIndexProviders.length) {
        subIndexProviders[i].setIndex(index);
        // Update view title
        subIndexViews[i].title = index.displayName;
      }
    });

    // Clear unused slots
    for (let i = subIndexes.length; i < subIndexProviders.length; i++) {
      subIndexProviders[i].setIndex(null);
    }
  }
}
```

**Step 5: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 6: Commit**

```bash
git add src/extension.ts
git commit -m "feat(tree): register multiple tree views in extension"
```

---

## Task 7: Add Dynamic View Title Updates

**Files:**
- Modify: `src/subIndexTreeProvider.ts`
- Modify: `src/extension.ts`

**Step 1: Add title property to SubIndexTreeProvider**

In subIndexTreeProvider.ts, add a title property:

```typescript
export class SubIndexTreeProvider implements vscode.TreeDataProvider<CodexTreeItemType> {
  // ... existing code ...

  private _title: string = 'Index';

  get title(): string {
    return this._title;
  }

  /**
   * Set the index to display
   */
  setIndex(index: DiscoveredIndex | null): void {
    this.index = index;
    this._title = index?.displayName || 'Index';
    this._onDidChangeTreeData.fire(undefined);
  }
```

**Step 2: Update view titles when indexes change**

In extension.ts, after assigning indexes:

```typescript
// Update view titles
subIndexes.forEach((index, i) => {
  if (i < subIndexViews.length) {
    subIndexViews[i].title = index.displayName;
  }
});
```

**Step 3: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/subIndexTreeProvider.ts src/extension.ts
git commit -m "feat(tree): dynamic view title updates for sub-indexes"
```

---

## Task 8: Integration Testing

**Step 1: Build the extension**

Run: `npm run compile`
Expected: No errors

**Step 2: Launch extension host**

Run: Press F5 in VS Code
Expected: Extension host window opens

**Step 3: Open the test import project**

In the extension host:
1. Open `/tmp/test-import` folder (from previous Scrivener import test)
2. Right-click on the folder → "Set as Codex Context Folder"

**Step 4: Verify stacked views appear**

Expected:
- "Master Index" view shows at top with only orphan files
- Separate views for each book (11l02-book-1, 11l02-book-2, etc.)
- Each view is collapsible
- View titles match index names

**Step 5: Test orphan detection**

Expected:
- Master index shows only `novel-format.md` (files not in book folders)
- Book indexes show their respective chapters

**Step 6: Test nested mode setting**

1. Open Settings → ChapterWise Codex
2. Change "Index Display Mode" to "nested"
3. Refresh context

Expected: Returns to single-tree view (original behavior)

**Step 7: Verify no regressions**

1. Open a regular .codex.yaml file
2. Verify tree navigation works
3. Verify Writer View opens correctly

**Step 8: Commit test verification**

```bash
git add -A
git commit -m "test(tree): verify multi-index stacked views"
```

---

## Task 9: Update Tree Provider for Mode Switching

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Add display mode awareness**

In CodexTreeProvider class, add:

```typescript
/**
 * Get the current display mode
 */
getDisplayMode(): string {
  const config = vscode.workspace.getConfiguration('chapterwiseCodex');
  return config.get<string>('indexDisplayMode', 'stacked');
}

/**
 * Check if we should use the legacy single-tree view
 */
shouldUseLegacyView(): boolean {
  return this.getDisplayMode() === 'nested';
}
```

**Step 2: Update getIndexChildren to respect mode**

At the start of `getIndexChildren`:

```typescript
private getIndexChildren(element?: CodexTreeItemType): CodexTreeItemType[] {
  // In stacked mode, this provider only handles single-file mode
  // Multi-index is handled by separate providers
  if (!this.shouldUseLegacyView() && this.discoveredIndexes.size > 1) {
    return []; // Let the stacked providers handle it
  }

  // ... rest of existing code ...
}
```

**Step 3: Verify compilation**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/treeProvider.ts
git commit -m "feat(tree): add display mode awareness to main provider"
```

---

## Task 10: Final Integration and Cleanup

**Files:**
- Review: All modified files

**Step 1: Run full compile**

Run: `npm run compile`
Expected: No errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: No significant errors (fix any that appear)

**Step 3: Test full workflow**

1. Open fresh VS Code with extension
2. Open a project with nested indexes (Scrivener import)
3. Set as Codex Context
4. Verify stacked views work
5. Switch to nested mode
6. Verify single-tree works
7. Open regular codex file
8. Verify file mode works

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(tree): complete multi-index stacked views implementation"
```

---

## Summary

This plan implements:

1. **Configuration setting** (`indexDisplayMode`) with three modes: nested, stacked, tabs
2. **Pre-registered view slots** (8 sub-index slots + master + legacy navigator)
3. **MultiIndexManager** class for discovering and tracking indexes
4. **SubIndexTreeProvider** for individual index views
5. **MasterIndexTreeProvider** for orphan files only
6. **Dynamic view visibility** via VS Code context commands
7. **Mode switching** between stacked and nested views

The architecture is designed to be extensible for future "tabs" mode implementation.
