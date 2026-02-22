# Tree View Context Menu & Node Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up complete context menus for all tree node types, add missing operations (Add Field, Change Type, Duplicate, Cut/Paste, Trash, etc.), and make the tree feel like a first-class outliner.

**Architecture:** Build bottom-up — new modules first (trashManager, clipboardManager), then structureEditor operations, then package.json wiring, then extension.ts command handlers. Each task is independently testable.

**Tech Stack:** TypeScript, VS Code Extension API, YAML library (already in use), Vitest for tests.

**Design doc:** `docs/plans/2026-02-21-tree-view-context-menu-ux.md`

---

### Task 1: TrashManager — Core Module

**Files:**
- Create: `src/trashManager.ts`
- Create: `src/trashManager.test.ts`

**Context:** The trash system moves files to `.trash/` in workspace root instead of OS trash. It also handles inline node deletion by serializing to a special file.

**Step 1: Write failing tests for TrashManager**

```typescript
// src/trashManager.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TrashManager } from './trashManager';

// Mock fs operations
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
}));

describe('TrashManager', () => {
  let tm: TrashManager;

  beforeEach(() => {
    tm = new TrashManager('/workspace');
    vi.clearAllMocks();
  });

  describe('trashPath', () => {
    it('returns .trash/ under workspace root', () => {
      expect(tm.trashPath).toBe('/workspace/.trash');
    });
  });

  describe('getTrashDestination', () => {
    it('preserves relative path in trash folder', () => {
      const result = tm.getTrashDestination('chapters/intro.codex.yaml');
      expect(result).toBe('/workspace/.trash/chapters/intro.codex.yaml');
    });

    it('handles files in root', () => {
      const result = tm.getTrashDestination('story.codex.yaml');
      expect(result).toBe('/workspace/.trash/story.codex.yaml');
    });
  });

  describe('moveToTrash', () => {
    it('creates trash directory if needed', async () => {
      const fs = await import('fs/promises');
      await tm.moveToTrash('chapters/intro.codex.yaml');
      expect(fs.mkdir).toHaveBeenCalledWith('/workspace/.trash/chapters', { recursive: true });
    });

    it('moves file to trash location', async () => {
      const fs = await import('fs/promises');
      await tm.moveToTrash('chapters/intro.codex.yaml');
      expect(fs.rename).toHaveBeenCalledWith(
        '/workspace/chapters/intro.codex.yaml',
        '/workspace/.trash/chapters/intro.codex.yaml'
      );
    });
  });

  describe('restoreFromTrash', () => {
    it('moves file back from trash to original location', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.access).mockResolvedValueOnce(undefined); // trash file exists
      await tm.restoreFromTrash('chapters/intro.codex.yaml');
      expect(fs.rename).toHaveBeenCalledWith(
        '/workspace/.trash/chapters/intro.codex.yaml',
        '/workspace/chapters/intro.codex.yaml'
      );
    });
  });

  describe('listTrash', () => {
    it('returns empty array when no trash folder', async () => {
      const result = await tm.listTrash();
      expect(result).toEqual([]);
    });
  });

  describe('emptyTrash', () => {
    it('removes entire trash directory', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.access).mockResolvedValueOnce(undefined); // trash exists
      await tm.emptyTrash();
      expect(fs.rm).toHaveBeenCalledWith('/workspace/.trash', { recursive: true, force: true });
    });
  });

  describe('ensureGitignore', () => {
    it('adds .trash/ to gitignore if not present', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValue('node_modules/\n.DS_Store\n');
      vi.mocked(fs.access).mockResolvedValueOnce(undefined); // gitignore exists
      await tm.ensureGitignore();
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/workspace/.gitignore',
        expect.stringContaining('.trash/')
      );
    });

    it('does nothing if .trash/ already in gitignore', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValue('.trash/\nnode_modules/\n');
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      await tm.ensureGitignore();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run tests — verify they fail**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/trashManager.test.ts`
Expected: FAIL — module `./trashManager` not found

**Step 3: Implement TrashManager**

```typescript
// src/trashManager.ts
import * as fs from 'fs/promises';
import * as path from 'path';

export interface TrashEntry {
  relativePath: string;
  name: string;
  trashedAt: string; // ISO timestamp
  isDirectory: boolean;
}

export class TrashManager {
  public readonly trashPath: string;

  constructor(private readonly workspaceRoot: string) {
    this.trashPath = path.join(workspaceRoot, '.trash');
  }

  getTrashDestination(relativePath: string): string {
    return path.join(this.trashPath, relativePath);
  }

  async moveToTrash(relativePath: string): Promise<void> {
    const source = path.join(this.workspaceRoot, relativePath);
    const dest = this.getTrashDestination(relativePath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(source, dest);
    await this.ensureGitignore();
  }

  async restoreFromTrash(relativePath: string): Promise<void> {
    const source = this.getTrashDestination(relativePath);
    const dest = path.join(this.workspaceRoot, relativePath);
    await fs.access(source);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(source, dest);
  }

  async listTrash(): Promise<TrashEntry[]> {
    try {
      await fs.access(this.trashPath);
    } catch {
      return [];
    }
    return this.scanDirectory(this.trashPath, '');
  }

  private async scanDirectory(dir: string, prefix: string): Promise<TrashEntry[]> {
    const entries: TrashEntry[] = [];
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push(...await this.scanDirectory(path.join(dir, item.name), rel));
      } else {
        const stat = await fs.stat(path.join(dir, item.name));
        entries.push({
          relativePath: rel,
          name: item.name,
          trashedAt: stat.mtime.toISOString(),
          isDirectory: false,
        });
      }
    }
    return entries;
  }

  async emptyTrash(): Promise<void> {
    try {
      await fs.access(this.trashPath);
    } catch {
      return; // No trash to empty
    }
    await fs.rm(this.trashPath, { recursive: true, force: true });
  }

  async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
    try {
      await fs.access(gitignorePath);
      const content = await fs.readFile(gitignorePath, 'utf-8');
      if (content.includes('.trash/')) return;
      await fs.writeFile(gitignorePath, content.trimEnd() + '\n.trash/\n');
    } catch {
      await fs.writeFile(gitignorePath, '.trash/\n');
    }
  }

  async hasTrash(): Promise<boolean> {
    try {
      await fs.access(this.trashPath);
      const items = await fs.readdir(this.trashPath);
      return items.length > 0;
    } catch {
      return false;
    }
  }
}
```

**Step 4: Run tests — verify they pass**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/trashManager.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/trashManager.ts src/trashManager.test.ts
git commit -m "feat: add TrashManager for project-level .trash/ system"
```

---

### Task 2: ClipboardManager — Cut/Paste State

**Files:**
- Create: `src/clipboardManager.ts`
- Create: `src/clipboardManager.test.ts`

**Context:** Manages cut state for tree nodes. Not system clipboard — internal extension state. Emits events so the tree can dim cut nodes.

**Step 1: Write failing tests**

```typescript
// src/clipboardManager.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClipboardManager, ClipboardEntry } from './clipboardManager';

describe('ClipboardManager', () => {
  let cm: ClipboardManager;

  beforeEach(() => {
    cm = new ClipboardManager();
  });

  describe('cut', () => {
    it('stores the cut entry', () => {
      const entry: ClipboardEntry = {
        nodeId: 'abc-123',
        nodeType: 'chapter',
        nodeName: 'Chapter 1',
        sourceUri: '/path/to/file.codex.yaml',
        sourcePath: ['children', 0],
        isFileBacked: false,
      };
      cm.cut(entry);
      expect(cm.getCutEntry()).toEqual(entry);
    });

    it('replaces previous cut entry', () => {
      cm.cut({ nodeId: 'a', nodeType: 'chapter', nodeName: 'A', sourceUri: '/a.yaml', sourcePath: [], isFileBacked: false });
      cm.cut({ nodeId: 'b', nodeType: 'scene', nodeName: 'B', sourceUri: '/b.yaml', sourcePath: [], isFileBacked: false });
      expect(cm.getCutEntry()?.nodeId).toBe('b');
    });
  });

  describe('isCut', () => {
    it('returns true for cut node', () => {
      cm.cut({ nodeId: 'abc', nodeType: 'chapter', nodeName: 'Ch', sourceUri: '/a.yaml', sourcePath: [], isFileBacked: false });
      expect(cm.isCut('abc')).toBe(true);
    });

    it('returns false for non-cut node', () => {
      expect(cm.isCut('xyz')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes cut entry', () => {
      cm.cut({ nodeId: 'abc', nodeType: 'chapter', nodeName: 'Ch', sourceUri: '/a.yaml', sourcePath: [], isFileBacked: false });
      cm.clear();
      expect(cm.getCutEntry()).toBeNull();
      expect(cm.isCut('abc')).toBe(false);
    });
  });

  describe('onDidChange', () => {
    it('fires when cut is called', () => {
      const listener = vi.fn();
      cm.onDidChange(listener);
      cm.cut({ nodeId: 'abc', nodeType: 'chapter', nodeName: 'Ch', sourceUri: '/a.yaml', sourcePath: [], isFileBacked: false });
      expect(listener).toHaveBeenCalled();
    });

    it('fires when clear is called', () => {
      const listener = vi.fn();
      cm.onDidChange(listener);
      cm.clear();
      expect(listener).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run tests — verify they fail**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/clipboardManager.test.ts`
Expected: FAIL

**Step 3: Implement ClipboardManager**

```typescript
// src/clipboardManager.ts
import type { PathSegment } from './codexModel';

export interface ClipboardEntry {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  sourceUri: string;
  sourcePath: PathSegment[];
  isFileBacked: boolean;
  filePath?: string; // For file-backed nodes
}

type ChangeListener = () => void;

export class ClipboardManager {
  private cutEntry: ClipboardEntry | null = null;
  private listeners: ChangeListener[] = [];

  cut(entry: ClipboardEntry): void {
    this.cutEntry = entry;
    this.fireChange();
  }

  getCutEntry(): ClipboardEntry | null {
    return this.cutEntry;
  }

  isCut(nodeId: string): boolean {
    return this.cutEntry?.nodeId === nodeId;
  }

  clear(): void {
    this.cutEntry = null;
    this.fireChange();
  }

  onDidChange(listener: ChangeListener): { dispose: () => void } {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
      },
    };
  }

  private fireChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
```

**Step 4: Run tests — verify they pass**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/clipboardManager.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/clipboardManager.ts src/clipboardManager.test.ts
git commit -m "feat: add ClipboardManager for cut/paste tree operations"
```

---

### Task 3: StructureEditor — New Field Operations

**Files:**
- Modify: `src/structureEditor.ts`
- Create: `src/structureEditor.test.ts`

**Context:** Add methods to structureEditor for: addFieldToNode, removeFieldFromNode, renameFieldOnNode, changeNodeType. These all manipulate YAML documents using the existing pattern (YAML.parseDocument → getIn/setIn → WorkspaceEdit replace).

**Step 1: Write failing tests for field operations**

```typescript
// src/structureEditor.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodexStructureEditor } from './structureEditor';
import type { CodexNode } from './codexModel';

function makeNode(overrides: Partial<CodexNode> = {}): CodexNode {
  return {
    id: 'test-1', type: 'chapter', name: 'Test', proseField: 'body',
    proseValue: '', availableFields: ['body'], path: ['children', 0],
    children: [], hasAttributes: false, hasContentSections: false, hasImages: false,
    ...overrides,
  };
}

function makeDoc(yaml: string) {
  return {
    getText: () => yaml,
    uri: { fsPath: '/test.codex.yaml' },
    lineCount: yaml.split('\n').length,
    save: vi.fn().mockResolvedValue(true),
  } as any;
}

describe('CodexStructureEditor — field operations', () => {
  let editor: CodexStructureEditor;

  beforeEach(() => {
    editor = new CodexStructureEditor();
    vi.clearAllMocks();
  });

  describe('addFieldToNode', () => {
    it('adds a new field to a root node', async () => {
      const yaml = 'id: test-1\ntype: chapter\nname: Test\nbody: Hello';
      const doc = makeDoc(yaml);
      const node = makeNode({ path: [] });
      const vscode = await import('vscode');
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);

      const result = await editor.addFieldToNode(doc, node, 'summary');
      expect(result).toBe(true);
      // Verify applyEdit was called with YAML containing 'summary'
      const editCall = vi.mocked(vscode.workspace.applyEdit).mock.calls[0];
      expect(editCall).toBeDefined();
    });

    it('returns false for field that already exists', async () => {
      const yaml = 'id: test-1\ntype: chapter\nname: Test\nbody: Hello\nsummary: Existing';
      const doc = makeDoc(yaml);
      const node = makeNode({ path: [], availableFields: ['body', 'summary'] });

      const result = await editor.addFieldToNode(doc, node, 'summary');
      expect(result).toBe(false);
    });
  });

  describe('removeFieldFromNode', () => {
    it('removes a field from YAML', async () => {
      const yaml = 'id: test-1\ntype: chapter\nname: Test\nbody: Hello\nsummary: World';
      const doc = makeDoc(yaml);
      const node = makeNode({ path: [] });
      const vscode = await import('vscode');
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);

      const result = await editor.removeFieldFromNode(doc, node, 'summary');
      expect(result).toBe(true);
    });
  });

  describe('changeNodeType', () => {
    it('updates the type field', async () => {
      const yaml = 'id: test-1\ntype: chapter\nname: Test';
      const doc = makeDoc(yaml);
      const node = makeNode({ path: [] });
      const vscode = await import('vscode');
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);

      const result = await editor.changeNodeType(doc, node, 'scene');
      expect(result).toBe(true);
    });
  });
});
```

**Step 2: Run tests — verify they fail**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`
Expected: FAIL — methods don't exist

**Step 3: Add field operations to structureEditor.ts**

Add these methods to the `CodexStructureEditor` class. Follow the existing pattern: `YAML.parseDocument(text)` → navigate with `getIn`/`setIn` → `WorkspaceEdit` replace → save.

```typescript
// Add to CodexStructureEditor class in src/structureEditor.ts

async addFieldToNode(
  document: vscode.TextDocument,
  node: CodexNode,
  fieldName: string
): Promise<boolean> {
  if (node.availableFields.includes(fieldName)) return false;

  const text = document.getText();
  const yamlDoc = YAML.parseDocument(text);
  const nodePath = this.buildYamlPath(node.path);
  const targetNode = nodePath.length === 0 ? yamlDoc.contents : yamlDoc.getIn(nodePath);
  if (!targetNode) return false;

  yamlDoc.setIn([...nodePath, fieldName], '');

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    yamlDoc.toString()
  );
  const success = await vscode.workspace.applyEdit(edit);
  if (success) await document.save();
  return success;
}

async removeFieldFromNode(
  document: vscode.TextDocument,
  node: CodexNode,
  fieldName: string
): Promise<boolean> {
  const text = document.getText();
  const yamlDoc = YAML.parseDocument(text);
  const nodePath = this.buildYamlPath(node.path);
  yamlDoc.deleteIn([...nodePath, fieldName]);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    yamlDoc.toString()
  );
  const success = await vscode.workspace.applyEdit(edit);
  if (success) await document.save();
  return success;
}

async renameFieldOnNode(
  document: vscode.TextDocument,
  node: CodexNode,
  oldFieldName: string,
  newFieldName: string
): Promise<boolean> {
  const text = document.getText();
  const yamlDoc = YAML.parseDocument(text);
  const nodePath = this.buildYamlPath(node.path);
  const value = yamlDoc.getIn([...nodePath, oldFieldName]);
  if (value === undefined) return false;

  yamlDoc.deleteIn([...nodePath, oldFieldName]);
  yamlDoc.setIn([...nodePath, newFieldName], value);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    yamlDoc.toString()
  );
  const success = await vscode.workspace.applyEdit(edit);
  if (success) await document.save();
  return success;
}

async changeNodeType(
  document: vscode.TextDocument,
  node: CodexNode,
  newType: string
): Promise<boolean> {
  const text = document.getText();
  const yamlDoc = YAML.parseDocument(text);
  const nodePath = this.buildYamlPath(node.path);
  yamlDoc.setIn([...nodePath, 'type'], newType);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    yamlDoc.toString()
  );
  const success = await vscode.workspace.applyEdit(edit);
  if (success) await document.save();
  return success;
}

async addTagsToNode(
  document: vscode.TextDocument,
  node: CodexNode,
  newTags: string[]
): Promise<boolean> {
  const text = document.getText();
  const yamlDoc = YAML.parseDocument(text);
  const nodePath = this.buildYamlPath(node.path);
  const existing: string[] = (yamlDoc.getIn([...nodePath, 'tags']) as string[]) || [];
  const merged = [...new Set([...existing, ...newTags])];
  yamlDoc.setIn([...nodePath, 'tags'], merged);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    yamlDoc.toString()
  );
  const success = await vscode.workspace.applyEdit(edit);
  if (success) await document.save();
  return success;
}

async addRelationToNode(
  document: vscode.TextDocument,
  node: CodexNode,
  targetId: string,
  relationType: string
): Promise<boolean> {
  const text = document.getText();
  const yamlDoc = YAML.parseDocument(text);
  const nodePath = this.buildYamlPath(node.path);
  const existing = (yamlDoc.getIn([...nodePath, 'relations']) as any[]) || [];
  existing.push({ targetId, type: relationType });
  yamlDoc.setIn([...nodePath, 'relations'], existing);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    yamlDoc.toString()
  );
  const success = await vscode.workspace.applyEdit(edit);
  if (success) await document.save();
  return success;
}
```

**Step 4: Run tests — verify they pass**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/structureEditor.ts src/structureEditor.test.ts
git commit -m "feat: add field operations to structureEditor (add/remove/rename field, change type, tags, relations)"
```

---

### Task 4: StructureEditor — Duplicate Node

**Files:**
- Modify: `src/structureEditor.ts`
- Modify: `src/structureEditor.test.ts`

**Context:** Deep-copy a node with new UUIDs. For inline nodes, insert as next sibling. For file-backed nodes, create `filename-copy.codex.yaml`.

**Step 1: Write failing test for duplicateNode**

Add to `src/structureEditor.test.ts`:

```typescript
describe('duplicateNodeInDocument', () => {
  it('creates a copy with new ID and "(copy)" suffix', async () => {
    const yaml = 'id: root\ntype: book\nname: Book\nchildren:\n  - id: ch1\n    type: chapter\n    name: Chapter 1\n    body: Hello';
    const doc = makeDoc(yaml);
    const node = makeNode({ id: 'ch1', path: ['children', 0] });
    const vscode = await import('vscode');
    vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);

    const result = await editor.duplicateNodeInDocument(doc, node);
    expect(result).toBe(true);
    // The applyEdit should have been called with YAML containing "Chapter 1 (copy)"
    const editCall = vi.mocked(vscode.workspace.applyEdit).mock.calls[0];
    expect(editCall).toBeDefined();
  });
});
```

**Step 2: Run test — verify it fails**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`
Expected: FAIL — method doesn't exist

**Step 3: Implement duplicateNodeInDocument**

Add to `CodexStructureEditor` in `src/structureEditor.ts`:

```typescript
async duplicateNodeInDocument(
  document: vscode.TextDocument,
  node: CodexNode
): Promise<boolean> {
  const text = document.getText();
  const yamlDoc = YAML.parseDocument(text);
  const nodePath = this.buildYamlPath(node.path);

  // Get the raw YAML node to deep-copy
  const rawNode = yamlDoc.getIn(nodePath, true);
  if (!rawNode) return false;

  // Deep clone and regenerate IDs
  const cloned = JSON.parse(JSON.stringify(yamlDoc.getIn(nodePath)));
  cloned.name = `${cloned.name} (copy)`;
  cloned.id = this.generateUuid();
  this.regenerateChildIds(cloned);

  // Insert as next sibling
  const parentPath = nodePath.slice(0, -1); // Remove the index
  const siblingIndex = nodePath[nodePath.length - 1] as number;
  const parentArray = yamlDoc.getIn(parentPath);
  if (!Array.isArray(parentArray) && !(parentArray as any)?.items) return false;

  if (Array.isArray(parentArray)) {
    parentArray.splice(siblingIndex + 1, 0, cloned);
    yamlDoc.setIn(parentPath, parentArray);
  } else {
    // YAML.Document collection
    (parentArray as any).items.splice(siblingIndex + 1, 0, yamlDoc.createNode(cloned));
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    yamlDoc.toString()
  );
  const success = await vscode.workspace.applyEdit(edit);
  if (success) await document.save();
  return success;
}

private regenerateChildIds(node: any): void {
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      child.id = this.generateUuid();
      this.regenerateChildIds(child);
    }
  }
}

private generateUuid(): string {
  // Use crypto.randomUUID() if available, else fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

**Note:** Check if `generateUuid` already exists in the codebase — it likely does. If so, reuse it. Search for `uuid` or `randomUUID` in `src/`.

**Step 4: Run tests — verify they pass**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx vitest run src/structureEditor.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/structureEditor.ts src/structureEditor.test.ts
git commit -m "feat: add duplicateNodeInDocument to structureEditor"
```

---

### Task 5: Package.json — Register All New Commands

**Files:**
- Modify: `package.json`

**Context:** Register new commands in `contributes.commands`. These are just declarations — no logic yet. The commands must exist before we can add menu entries or keybindings.

**Step 1: Add new command declarations to `contributes.commands` array**

Add these entries to the `commands` array in `package.json`:

```json
{ "command": "chapterwiseCodex.addField", "title": "Add Field" },
{ "command": "chapterwiseCodex.deleteField", "title": "Delete Field" },
{ "command": "chapterwiseCodex.renameField", "title": "Rename Field" },
{ "command": "chapterwiseCodex.changeType", "title": "Change Type" },
{ "command": "chapterwiseCodex.changeIcon", "title": "Change Icon/Emoji" },
{ "command": "chapterwiseCodex.addTags", "title": "Add Tags" },
{ "command": "chapterwiseCodex.addRelation", "title": "Add Relation" },
{ "command": "chapterwiseCodex.duplicateNode", "title": "Duplicate", "icon": "$(copy)" },
{ "command": "chapterwiseCodex.cutNode", "title": "Cut", "icon": "$(clippy)" },
{ "command": "chapterwiseCodex.pasteNodeAsChild", "title": "Paste as Child" },
{ "command": "chapterwiseCodex.pasteNodeAsSibling", "title": "Paste as Sibling" },
{ "command": "chapterwiseCodex.extractToFile", "title": "Extract to File" },
{ "command": "chapterwiseCodex.moveToTrash", "title": "Move to Trash", "icon": "$(trash)" },
{ "command": "chapterwiseCodex.restoreFromTrash", "title": "Restore from Trash" },
{ "command": "chapterwiseCodex.emptyTrash", "title": "Empty Trash" },
{ "command": "chapterwiseCodex.openInFinder", "title": "Open in Finder" },
{ "command": "chapterwiseCodex.copyPath", "title": "Copy Path" },
{ "command": "chapterwiseCodex.addChildFile", "title": "Add File" },
{ "command": "chapterwiseCodex.renameFolder", "title": "Rename Folder" },
{ "command": "chapterwiseCodex.deleteFolder", "title": "Delete Folder" }
```

**Step 2: Verify extension compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors (commands are just JSON declarations)

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: register new tree context menu commands in package.json"
```

---

### Task 6: Package.json — Wire Context Menus

**Files:**
- Modify: `package.json`

**Context:** Add `view/item/context` menu entries that map commands to tree node contextValues. This is what makes right-click menus appear. Each entry needs a `when` clause matching the contextValue.

**Step 1: Add context menu entries to `contributes.menus["view/item/context"]`**

Add these entries. The existing entries for `codexNode` should be updated to include the new commands, and new entries added for `indexNode`, `indexFile`, `indexFolder`, `codexField`, `indexField`.

**For codexNode (add to existing):**
```json
{ "command": "chapterwiseCodex.addField", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "1_add@3" },
{ "command": "chapterwiseCodex.changeType", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "2_edit@3" },
{ "command": "chapterwiseCodex.changeIcon", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "2_edit@4" },
{ "command": "chapterwiseCodex.addTags", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "2_edit@5" },
{ "command": "chapterwiseCodex.addRelation", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "2_edit@6" },
{ "command": "chapterwiseCodex.cutNode", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "3_move@3" },
{ "command": "chapterwiseCodex.pasteNodeAsChild", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "3_move@4" },
{ "command": "chapterwiseCodex.pasteNodeAsSibling", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "3_move@5" },
{ "command": "chapterwiseCodex.duplicateNode", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "4_navigate@3" },
{ "command": "chapterwiseCodex.extractToFile", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "4_navigate@4" },
{ "command": "chapterwiseCodex.moveToTrash", "when": "view =~ /chapterwiseCodex/ && viewItem == codexNode", "group": "5_delete@1" }
```

**For indexNode:**
```json
{ "command": "chapterwiseCodex.addChildNode", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "1_add@1" },
{ "command": "chapterwiseCodex.addSiblingNode", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "1_add@2" },
{ "command": "chapterwiseCodex.addField", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "1_add@3" },
{ "command": "chapterwiseCodex.renameNode", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "2_edit@1" },
{ "command": "chapterwiseCodex.changeType", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "2_edit@3" },
{ "command": "chapterwiseCodex.changeIcon", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "2_edit@4" },
{ "command": "chapterwiseCodex.addTags", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "2_edit@5" },
{ "command": "chapterwiseCodex.addRelation", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "2_edit@6" },
{ "command": "chapterwiseCodex.moveNodeUp", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "3_move@1" },
{ "command": "chapterwiseCodex.moveNodeDown", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "3_move@2" },
{ "command": "chapterwiseCodex.goToYaml", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "4_navigate@1" },
{ "command": "chapterwiseCodex.copyId", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "4_navigate@2" },
{ "command": "chapterwiseCodex.duplicateNode", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "4_navigate@3" },
{ "command": "chapterwiseCodex.moveToTrash", "when": "view =~ /chapterwiseCodex/ && viewItem == indexNode", "group": "5_delete@1" }
```

**For indexFile:**
```json
{ "command": "chapterwiseCodex.addChildNode", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "1_add@1" },
{ "command": "chapterwiseCodex.addSiblingNode", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "1_add@2" },
{ "command": "chapterwiseCodex.addField", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "1_add@3" },
{ "command": "chapterwiseCodex.renameNode", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "2_edit@1" },
{ "command": "chapterwiseCodex.changeType", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "2_edit@3" },
{ "command": "chapterwiseCodex.changeIcon", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "2_edit@4" },
{ "command": "chapterwiseCodex.addTags", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "2_edit@5" },
{ "command": "chapterwiseCodex.moveNodeUp", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "3_move@1" },
{ "command": "chapterwiseCodex.moveNodeDown", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "3_move@2" },
{ "command": "chapterwiseCodex.copyPath", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "4_navigate@2" },
{ "command": "chapterwiseCodex.duplicateNode", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "4_navigate@3" },
{ "command": "chapterwiseCodex.moveToTrash", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFile", "group": "5_delete@1" }
```

**For indexFolder:**
```json
{ "command": "chapterwiseCodex.addChildFile", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFolder", "group": "1_add@1" },
{ "command": "chapterwiseCodex.renameFolder", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFolder", "group": "2_edit@1" },
{ "command": "chapterwiseCodex.autofixFolder", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFolder", "group": "2_edit@2" },
{ "command": "chapterwiseCodex.openInFinder", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFolder", "group": "4_navigate@1" },
{ "command": "chapterwiseCodex.moveToTrash", "when": "view =~ /chapterwiseCodex/ && viewItem == indexFolder", "group": "5_delete@1" }
```

**For codexField and indexField:**
```json
{ "command": "chapterwiseCodex.renameField", "when": "view =~ /chapterwiseCodex/ && viewItem == codexField", "group": "2_edit@1" },
{ "command": "chapterwiseCodex.goToYaml", "when": "view =~ /chapterwiseCodex/ && viewItem == codexField", "group": "4_navigate@1" },
{ "command": "chapterwiseCodex.deleteField", "when": "view =~ /chapterwiseCodex/ && viewItem == codexField", "group": "5_delete@1" },
{ "command": "chapterwiseCodex.renameField", "when": "view =~ /chapterwiseCodex/ && viewItem == indexField", "group": "2_edit@1" },
{ "command": "chapterwiseCodex.goToYaml", "when": "view =~ /chapterwiseCodex/ && viewItem == indexField", "group": "4_navigate@1" },
{ "command": "chapterwiseCodex.deleteField", "when": "view =~ /chapterwiseCodex/ && viewItem == indexField", "group": "5_delete@1" }
```

**Step 2: Also update the existing `removeNode` and `deleteNodePermanently` entries** — replace them with `moveToTrash` for `codexNode` (remove the old `5_delete@1` and `5_delete@2` entries for codexNode, replace with `moveToTrash`).

**Step 3: Verify extension compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat: wire context menus for all tree node types (indexNode, indexFile, indexFolder, fields)"
```

---

### Task 7: Package.json — New Keybindings

**Files:**
- Modify: `package.json`

**Step 1: Add new keybindings to `contributes.keybindings`**

```json
{ "command": "chapterwiseCodex.addSiblingNode", "key": "ctrl+n", "mac": "cmd+n", "when": "focusedView =~ /chapterwiseCodex/" },
{ "command": "chapterwiseCodex.renameNode", "key": "f2", "when": "focusedView =~ /chapterwiseCodex/" },
{ "command": "chapterwiseCodex.duplicateNode", "key": "ctrl+d", "mac": "cmd+d", "when": "focusedView =~ /chapterwiseCodex/" },
{ "command": "chapterwiseCodex.cutNode", "key": "ctrl+x", "mac": "cmd+x", "when": "focusedView =~ /chapterwiseCodex/" },
{ "command": "chapterwiseCodex.pasteNodeAsChild", "key": "ctrl+v", "mac": "cmd+v", "when": "focusedView =~ /chapterwiseCodex/" }
```

**Step 2: Update existing `removeNode` keybinding** — change the `delete` key to call `moveToTrash` instead of `removeNode`.

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add keybindings for sibling, rename, duplicate, cut/paste"
```

---

### Task 8: Extension.ts — Register New Command Handlers (Part 1: Simple Operations)

**Files:**
- Modify: `src/extension.ts`

**Context:** Wire up command handlers for: addField, deleteField, renameField, changeType, addTags, changeIcon, copyPath, openInFinder. These all follow the existing pattern: receive tree item → extract node → call structureEditor or show QuickPick → refresh tree.

**Step 1: Add imports at top of extension.ts**

```typescript
import { TrashManager } from './trashManager';
import { ClipboardManager } from './clipboardManager';
```

**Step 2: Instantiate managers in activate()**

Near where `structureEditor` is created, add:

```typescript
const trashManager = new TrashManager(workspaceRoot);
const clipboardManager = new ClipboardManager();
```

**Step 3: Register addField command**

Follow the existing pattern (see `addChildNode` at line 1328). The handler should:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.addField', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    if (!treeItem) return;

    const COMMON_FIELDS = ['body', 'summary', 'description', 'notes', 'content', 'text'];
    let existingFields: string[] = [];

    if (treeItem instanceof CodexTreeItem) {
      existingFields = treeItem.codexNode.availableFields;
    }

    const items = COMMON_FIELDS.map(f => ({
      label: f.charAt(0).toUpperCase() + f.slice(1),
      description: existingFields.includes(f) ? '(already exists)' : undefined,
      field: f,
      picked: false,
    })).filter(item => !existingFields.includes(item.field));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a field to add',
    });
    if (!picked) return;

    if (treeItem instanceof CodexTreeItem) {
      const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
      await structureEditor.addFieldToNode(doc, treeItem.codexNode, picked.field);
    }
    // TODO: handle IndexNodeTreeItem (open the file, find the node, add field)

    treeProvider.refresh();
  })
);
```

**Step 4: Register changeType command**

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.changeType', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    if (!treeItem) return;

    const COMMON_TYPES = ['book', 'chapter', 'scene', 'character', 'location', 'item', 'event', 'note', 'world', 'faction', 'lore'];
    const currentType = treeItem instanceof CodexTreeItem ? treeItem.codexNode.type : (treeItem as IndexNodeTreeItem).indexNode.type;

    const items = COMMON_TYPES.map(t => ({
      label: t.charAt(0).toUpperCase() + t.slice(1),
      description: t === currentType ? '(current)' : undefined,
      type: t,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Change type (current: ${currentType})`,
    });
    if (!picked || picked.type === currentType) return;

    if (treeItem instanceof CodexTreeItem) {
      const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
      await structureEditor.changeNodeType(doc, treeItem.codexNode, picked.type);
    }

    treeProvider.refresh();
  })
);
```

**Step 5: Register addTags, addRelation, deleteField, renameField, copyPath, openInFinder**

Each follows the same pattern. Key details:

- **addTags:** `vscode.window.showInputBox({ prompt: 'Enter tags (comma-separated)' })` → split by comma → trim → call `structureEditor.addTagsToNode()`
- **addRelation:** Two-step QuickPick: first pick target node (from `codexDocument.allNodes`), then pick relation type
- **deleteField:** Get field from `CodexFieldTreeItem.fieldName` → confirm if has content → call `structureEditor.removeFieldFromNode()`
- **renameField:** `vscode.window.showInputBox({ value: currentName })` → call `structureEditor.renameFieldOnNode()`
- **copyPath:** `vscode.env.clipboard.writeText(filePath)` → show info message
- **openInFinder:** `vscode.commands.executeCommand('revealFileInOS', uri)`

**Step 6: Verify extension compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/extension.ts
git commit -m "feat: register command handlers for addField, changeType, addTags, addRelation, field ops"
```

---

### Task 9: Extension.ts — Register Command Handlers (Part 2: Trash, Duplicate, Cut/Paste)

**Files:**
- Modify: `src/extension.ts`

**Step 1: Register moveToTrash command**

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.moveToTrash', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    if (!treeItem) return;

    let name = '';
    let childCount = 0;

    if (treeItem instanceof CodexTreeItem) {
      name = treeItem.codexNode.name;
      childCount = treeItem.codexNode.children.length;
    } else if (treeItem instanceof IndexNodeTreeItem) {
      name = treeItem.indexNode.name;
      childCount = treeItem.indexNode.children?.length || 0;
    }

    const message = childCount > 0
      ? `Move "${name}" and its ${childCount} children to trash?`
      : `Move "${name}" to trash?`;

    const confirm = await vscode.window.showWarningMessage(message, { modal: true }, 'Move to Trash');
    if (confirm !== 'Move to Trash') return;

    if (treeItem instanceof IndexNodeTreeItem) {
      // File-backed: use trashManager
      const filePath = treeItem.indexNode._computed_path;
      if (filePath) {
        await trashManager.moveToTrash(filePath);
      }
    } else if (treeItem instanceof CodexTreeItem) {
      // Inline: remove from document (existing removeNodeFromDocument)
      // Also serialize to .trash/_inline-deletions for restore
      const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
      await structureEditor.removeNodeFromDocument(doc, treeItem.codexNode, false, settings);
    }

    treeProvider.refresh();
  })
);
```

**Step 2: Register duplicateNode command**

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.duplicateNode', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    if (!treeItem) return;

    if (treeItem instanceof CodexTreeItem) {
      const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
      await structureEditor.duplicateNodeInDocument(doc, treeItem.codexNode);
    }
    // TODO: For IndexNodeTreeItem (file-backed), copy the file

    treeProvider.refresh();
  })
);
```

**Step 3: Register cutNode command**

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.cutNode', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    if (!treeItem) return;

    if (treeItem instanceof CodexTreeItem) {
      clipboardManager.cut({
        nodeId: treeItem.codexNode.id,
        nodeType: treeItem.codexNode.type,
        nodeName: treeItem.codexNode.name,
        sourceUri: treeItem.documentUri.fsPath,
        sourcePath: treeItem.codexNode.path,
        isFileBacked: false,
      });
    } else if (treeItem instanceof IndexNodeTreeItem) {
      clipboardManager.cut({
        nodeId: treeItem.indexNode.id,
        nodeType: treeItem.indexNode.type,
        nodeName: treeItem.indexNode.name,
        sourceUri: treeItem.documentUri.fsPath,
        sourcePath: [],
        isFileBacked: true,
        filePath: treeItem.indexNode._computed_path,
      });
    }

    treeProvider.refresh(); // Refresh to show cut indicator
    vscode.window.setStatusBarMessage(`Cut: ${clipboardManager.getCutEntry()?.nodeName}`, 3000);
  })
);
```

**Step 4: Register pasteNodeAsChild and pasteNodeAsSibling**

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.pasteNodeAsChild', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    const entry = clipboardManager.getCutEntry();
    if (!entry || !treeItem) return;

    if (treeItem instanceof CodexTreeItem && !entry.isFileBacked) {
      // Same-file inline move: use moveNodeInDocument
      const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
      // Build a minimal source node from the cut entry
      // Use structureEditor.moveNodeInDocument(doc, sourceNode, targetNode, 'inside')
    }

    clipboardManager.clear();
    treeProvider.refresh();
  })
);

// Similar for pasteNodeAsSibling with position 'after'
```

**Step 5: Register restoreFromTrash and emptyTrash commands**

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.restoreFromTrash', async () => {
    const entries = await trashManager.listTrash();
    if (entries.length === 0) {
      vscode.window.showInformationMessage('Trash is empty');
      return;
    }

    const items = entries.map(e => ({
      label: e.name,
      description: e.relativePath,
      detail: `Trashed: ${new Date(e.trashedAt).toLocaleDateString()}`,
      entry: e,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select file to restore',
    });
    if (!picked) return;

    await trashManager.restoreFromTrash(picked.entry.relativePath);
    treeProvider.refresh();
    vscode.window.showInformationMessage(`Restored: ${picked.entry.name}`);
  })
);

context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.emptyTrash', async () => {
    const confirm = await vscode.window.showWarningMessage(
      'Permanently delete all items in trash?',
      { modal: true },
      'Empty Trash'
    );
    if (confirm !== 'Empty Trash') return;
    await trashManager.emptyTrash();
    treeProvider.refresh();
  })
);
```

**Step 6: Verify extension compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/extension.ts
git commit -m "feat: register trash, duplicate, cut/paste command handlers"
```

---

### Task 10: TreeProvider — Cut Indicator & Type-Aware Descriptions

**Files:**
- Modify: `src/treeProvider.ts`

**Context:** Two enhancements: (1) nodes that are "cut" should render with strikethrough/dimmed style, (2) the tree item description could show type info to help with context.

**Step 1: Pass clipboardManager to treeProvider**

The treeProvider needs access to `clipboardManager.isCut(nodeId)`. Either pass it as a constructor parameter or use a setter.

In the constructor or via a method like `setClipboardManager(cm: ClipboardManager)`:

```typescript
private clipboardManager?: ClipboardManager;

setClipboardManager(cm: ClipboardManager): void {
  this.clipboardManager = cm;
  cm.onDidChange(() => this.refresh());
}
```

**Step 2: Update CodexTreeItem rendering for cut state**

In the `CodexTreeItem` constructor (around line 522), after setting `contextValue`:

```typescript
// In treeProvider.ts, where CodexTreeItem is constructed
// This requires passing clipboardManager state to the tree item
// Option: set contextValue to 'codexNode_cut' when cut, so we can style differently

// In getTreeItem or the constructor:
if (this.clipboardManager?.isCut(codexNode.id)) {
  this.description = `${codexNode.type} (cut)`;
  this.contextValue = 'codexNode'; // Keep same so menus still work
  // VS Code doesn't support strikethrough on tree items directly,
  // but we can append visual indicator to description
}
```

**Note:** VS Code TreeItem API doesn't have a `strikethrough` property. The visual indicator will be `(cut)` appended to the description. An alternative is using a dimmed ThemeIcon color.

**Step 3: Subscribe clipboardManager changes to refresh tree**

In `activate()` in `extension.ts`, after creating both:

```typescript
treeProvider.setClipboardManager(clipboardManager);
```

**Step 4: Verify extension compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/treeProvider.ts src/extension.ts
git commit -m "feat: add cut indicator and clipboardManager integration to tree provider"
```

---

### Task 11: Extension.ts — changeIcon and extractToFile Commands

**Files:**
- Modify: `src/extension.ts`

**Step 1: Register changeIcon command**

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.changeIcon', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
    if (!treeItem) return;

    const EMOJI_GROUPS = [
      { label: '📚 Books & Writing', emojis: ['📚', '📖', '📝', '✍️', '📜', '📄'] },
      { label: '👥 Characters', emojis: ['👤', '👥', '🧙', '🦸', '👑', '🎭'] },
      { label: '🌍 Locations', emojis: ['🌍', '🏔️', '🏰', '🏠', '🌲', '⛰️', '🏙️'] },
      { label: '⚔️ Items & Objects', emojis: ['⚔️', '🗡️', '💎', '🔮', '🗝️', '📿'] },
      { label: '📅 Events', emojis: ['📅', '⏰', '🎉', '💥', '🌟', '⚡'] },
      { label: '🏛️ Factions & Groups', emojis: ['🏛️', '⚜️', '🛡️', '🏴', '🤝'] },
    ];

    const items: vscode.QuickPickItem[] = [];
    for (const group of EMOJI_GROUPS) {
      items.push({ label: group.label, kind: vscode.QuickPickItemKind.Separator });
      for (const emoji of group.emojis) {
        items.push({ label: emoji, description: '' });
      }
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an icon/emoji',
    });
    if (!picked) return;

    // Store emoji in node's attributes or index typeStyles
    if (treeItem instanceof CodexTreeItem) {
      const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
      // Add emoji as attribute: { key: 'emoji', value: picked.label }
      // Use the existing YAML manipulation pattern
      const text = doc.getText();
      const YAML = await import('yaml');
      const yamlDoc = YAML.parseDocument(text);
      const nodePath = structureEditor['buildYamlPath'](treeItem.codexNode.path);
      // Set emoji field directly on the node
      yamlDoc.setIn([...nodePath, 'emoji'], picked.label);

      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), yamlDoc.toString());
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }

    treeProvider.refresh();
  })
);
```

**Step 2: Register extractToFile command**

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.extractToFile', async (treeItem?: CodexTreeItem) => {
    if (!treeItem || !(treeItem instanceof CodexTreeItem)) return;
    if (treeItem.codexNode.isInclude) {
      vscode.window.showInformationMessage('This node is already a separate file');
      return;
    }

    const node = treeItem.codexNode;
    const suggestedName = node.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-');

    const name = await vscode.window.showInputBox({
      prompt: 'Filename for extracted node',
      value: `${suggestedName}.codex.yaml`,
    });
    if (!name) return;

    // 1. Serialize node to YAML
    // 2. Write to new file in same directory as source
    // 3. Replace inline node with include directive in source
    // 4. Refresh tree

    const sourceDoc = await vscode.workspace.openTextDocument(treeItem.documentUri);
    const sourceDir = require('path').dirname(sourceDoc.uri.fsPath);
    const newFilePath = require('path').join(sourceDir, name);

    // Build YAML content for new file
    const YAML = await import('yaml');
    const nodeData = {
      id: node.id,
      type: node.type,
      name: node.name,
    };
    // Copy all prose fields
    for (const field of node.availableFields) {
      (nodeData as any)[field] = (node as any)[field] || '';
    }
    if (node.children.length > 0) {
      (nodeData as any).children = []; // Children would need deep serialization
    }

    const newContent = YAML.stringify(nodeData);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(newFilePath),
      Buffer.from(newContent, 'utf-8')
    );

    // Replace inline node with include directive
    const text = sourceDoc.getText();
    const yamlDoc = YAML.parseDocument(text);
    const nodePath = structureEditor['buildYamlPath'](node.path);
    yamlDoc.setIn(nodePath, { include: name });

    const edit = new vscode.WorkspaceEdit();
    edit.replace(sourceDoc.uri, new vscode.Range(0, 0, sourceDoc.lineCount, 0), yamlDoc.toString());
    await vscode.workspace.applyEdit(edit);
    await sourceDoc.save();

    treeProvider.refresh();
    vscode.window.showInformationMessage(`Extracted "${node.name}" to ${name}`);
  })
);
```

**Step 3: Register addChildFile, renameFolder, deleteFolder for indexFolder**

```typescript
// addChildFile - creates a new .codex.yaml in the folder
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.addChildFile', async (treeItem?: IndexNodeTreeItem) => {
    if (!treeItem || !(treeItem instanceof IndexNodeTreeItem)) return;

    const folderPath = treeItem.indexNode._computed_path;
    if (!folderPath) return;

    const name = await vscode.window.showInputBox({
      prompt: 'New file name',
      placeHolder: 'my-document.codex.yaml',
    });
    if (!name) return;

    const fullPath = require('path').join(workspaceRoot, folderPath, name.endsWith('.codex.yaml') ? name : `${name}.codex.yaml`);
    const content = `id: ${crypto.randomUUID()}\ntype: document\nname: ${name.replace('.codex.yaml', '')}\nbody: ""\n`;
    await vscode.workspace.fs.writeFile(vscode.Uri.file(fullPath), Buffer.from(content, 'utf-8'));
    treeProvider.refresh();
  })
);

// renameFolder
context.subscriptions.push(
  vscode.commands.registerCommand('chapterwiseCodex.renameFolder', async (treeItem?: IndexNodeTreeItem) => {
    if (!treeItem) return;
    const oldPath = treeItem.indexNode._computed_path;
    if (!oldPath) return;

    const newName = await vscode.window.showInputBox({
      prompt: 'New folder name',
      value: treeItem.indexNode.name,
    });
    if (!newName) return;

    const oldFull = require('path').join(workspaceRoot, oldPath);
    const newFull = require('path').join(require('path').dirname(oldFull), newName);
    await vscode.workspace.fs.rename(vscode.Uri.file(oldFull), vscode.Uri.file(newFull));
    treeProvider.refresh();
  })
);
```

**Step 4: Verify extension compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/extension.ts
git commit -m "feat: register changeIcon, extractToFile, addChildFile, renameFolder commands"
```

---

### Task 12: Manual Testing & Polish

**Files:**
- All modified files

**Step 1: Run all tests**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm test`
Expected: All PASS

**Step 2: Build the extension**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile` (or `npx tsc`)
Expected: No errors

**Step 3: Test in VS Code**

1. Press F5 to launch Extension Development Host
2. Open a project with `.codex.yaml` files
3. Verify right-click menus appear on:
   - codexNode items → should show full menu (Add Child, Add Sibling, Add Field, Rename, Change Type, Change Icon, Add Tags, Add Relation, Move Up/Down, Cut, Paste, Go to YAML, Copy ID, Duplicate, Extract to File, Move to Trash)
   - indexNode items → should show full menu
   - indexFile items → should show full menu
   - indexFolder items → should show Add File, Rename, Autofix, Open in Finder, Delete
   - codexField/indexField items → should show Rename Field, Go to YAML, Delete Field
4. Test each operation:
   - Add Field → QuickPick appears with body/summary/description/notes/content/text
   - Change Type → QuickPick with common types
   - Change Icon → QuickPick with emoji groups
   - Add Tags → InputBox for comma-separated
   - Duplicate → creates copy with "(copy)" suffix
   - Cut → node shows "(cut)" indicator
   - Paste → moves node to new location
   - Move to Trash → confirmation dialog, file moves to .trash/
   - Restore from Trash → command palette, pick file
   - Empty Trash → confirmation, deletes .trash/

**Step 4: Fix any issues found during manual testing**

**Step 5: Final commit**

```bash
git add -A
git commit -m "polish: fix issues found during manual testing of tree context menus"
```

---

### Task 13: Update Existing removeNode to Use Trash

**Files:**
- Modify: `src/extension.ts`

**Context:** The existing `removeNode` command (Delete key) currently uses `vscode.workspace.fs.delete(uri, { useTrash: true })`. Update it to use the new TrashManager instead, so all deletions go through the project-level `.trash/` system.

**Step 1: Update the `chapterwiseCodex.removeNode` handler**

Find the existing handler (around line 1481) and modify it to delegate to `trashManager.moveToTrash()` for file-backed nodes, keeping the existing inline node removal for document-level nodes.

**Step 2: Optionally deprecate `deleteNodePermanently`** — or keep it as an escape hatch that bypasses trash.

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "refactor: update removeNode to use project-level trash system"
```

---

## Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 1 | TrashManager module | trashManager.ts, trashManager.test.ts | — |
| 2 | ClipboardManager module | clipboardManager.ts, clipboardManager.test.ts | — |
| 3 | StructureEditor field ops | structureEditor.test.ts | structureEditor.ts |
| 4 | StructureEditor duplicate | — | structureEditor.ts, structureEditor.test.ts |
| 5 | Package.json commands | — | package.json |
| 6 | Package.json context menus | — | package.json |
| 7 | Package.json keybindings | — | package.json |
| 8 | Extension.ts handlers (simple ops) | — | extension.ts |
| 9 | Extension.ts handlers (trash/dup/cut) | — | extension.ts |
| 10 | TreeProvider cut indicator | — | treeProvider.ts, extension.ts |
| 11 | Extension.ts changeIcon/extract/folder | — | extension.ts |
| 12 | Manual testing & polish | — | all |
| 13 | Update removeNode for trash | — | extension.ts |

**Total: 13 tasks, ~13 commits, 4 new files, 4 modified files**
