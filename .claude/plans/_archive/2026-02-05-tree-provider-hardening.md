# Tree Provider & Navigation Hardening Plan (Comprehensive)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the tree provider with path traversal prevention, null safety, error handling, event disposal, type guards, and user feedback.

**Architecture:** Add path validation in resolveFilePath/getFilePath, type guard functions for IndexChildNode, try-catch wrappers for tree item creation, and event listener disposal.

**Tech Stack:** TypeScript, VS Code Extension API

---

## Summary of Changes

| Category | Changes |
|----------|---------|
| Security - Path Traversal | Validate resolved paths stay within workspaceRoot |
| Null Safety | Check workspaceRoot before path.join, clear state on parse failure |
| Resource Management | Store event listeners for disposal |
| Error Handling | Wrap tree item creation loops, handle individual item failures |
| Type Safety | Type guard for IndexChildNode private `_*` properties |
| UX | Show error/welcome items instead of empty arrays |

---

### Task 1: Add Path Traversal Validation and Null Safety

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Add path validation helper after imports (line 11)**

After line 11, add:

```typescript
/**
 * Validate that a resolved path stays within the workspace root.
 * Prevents path traversal via malicious _computed_path values.
 */
function isPathWithinRoot(resolvedPath: string, rootPath: string): boolean {
  const normalizedResolved = path.resolve(resolvedPath);
  const normalizedRoot = path.resolve(rootPath);
  return normalizedResolved.startsWith(normalizedRoot + path.sep) || normalizedResolved === normalizedRoot;
}
```

**Step 2: Update resolveFilePath (line 596-612) to validate path**

Replace the resolveFilePath method body to add validation:

```typescript
private resolveFilePath(computedPath: string): string {
  if (!this.currentContext.workspaceRoot) {
    log('[ChapterWise] resolveFilePath: No workspace root in context!');
    return computedPath;
  }

  // Reject obvious path traversal attempts
  if (computedPath.includes('..')) {
    log(`[ChapterWise] resolveFilePath: Rejected path with '..': ${computedPath}`);
    return path.join(this.currentContext.workspaceRoot, path.basename(computedPath));
  }

  const resolved = path.join(this.currentContext.workspaceRoot, computedPath);

  // Validate resolved path stays within workspace
  if (!isPathWithinRoot(resolved, this.currentContext.workspaceRoot)) {
    log(`[ChapterWise] resolveFilePath: Path traversal detected: ${computedPath} resolved to ${resolved}`);
    return path.join(this.currentContext.workspaceRoot, path.basename(computedPath));
  }

  return resolved;
}
```

**Step 3: Update getFilePath in IndexNodeTreeItem (lines 393-427) to validate**

Replace getFilePath method to add workspaceRoot null check and path validation:

```typescript
getFilePath(): string {
  if (!this.workspaceRoot) {
    log('[getFilePath] No workspaceRoot set - returning empty string');
    return '';
  }

  if (this.indexNode._computed_path) {
    if (this.pathResolver) {
      return this.pathResolver(this.indexNode._computed_path);
    }
    const resolvedPath = path.join(this.workspaceRoot, this.indexNode._computed_path);
    if (!isPathWithinRoot(resolvedPath, this.workspaceRoot)) {
      log(`[getFilePath] Path traversal rejected: ${this.indexNode._computed_path}`);
      return '';
    }
    return resolvedPath;
  }

  // Fallback: build from parent chain
  const parts: string[] = [];
  let current: IndexChildNode | undefined = this.indexNode;
  while (current) {
    const fileName = current._filename || current.name;
    if (fileName.includes('..')) {
      log(`[getFilePath] Path traversal in filename rejected: ${fileName}`);
      return '';
    }
    parts.unshift(fileName);
    current = current.parent;
  }

  const fallbackPath = path.join(this.workspaceRoot, ...parts);
  if (!isPathWithinRoot(fallbackPath, this.workspaceRoot)) {
    log(`[getFilePath] Fallback path traversal rejected: ${fallbackPath}`);
    return '';
  }
  return fallbackPath;
}
```

**Step 4: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 5: Commit**

```bash
git add src/treeProvider.ts
git commit -m "security(tree): add path traversal validation in tree provider

- Add isPathWithinRoot() helper for workspace boundary checks
- Validate resolveFilePath() rejects '..' and out-of-workspace paths
- Validate getFilePath() checks workspaceRoot null + path boundaries
- Reject malicious _computed_path and _filename values"
```

---

### Task 2: Add State Cleanup on Parse Failure and Error States in Tree View

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Update setContextFolder error handling (line 832-834)**

Replace the catch block to clear state:

```typescript
    } catch (error) {
      log(`[TreeProvider] Error loading context index: ${error}`);
      // Clear stale state on failure
      this.indexDoc = null;
      this.isIndexMode = false;
      this.isLoading = false;
      this.loadingMessage = null;
      vscode.window.showErrorMessage(`Failed to load index: ${error instanceof Error ? error.message : String(error)}`);
      this.refresh();
    }
```

**Step 2: Update getChildren to show feedback instead of empty arrays (lines 1000-1006)**

Replace the empty return at lines 1000-1006 with informative items:

```typescript
    // No active document and no index - show welcome message
    if (!this.activeDocument && !this.indexDoc) {
      return [new CodexFileHeaderItem(
        vscode.Uri.file(''),
        false,
        'Right-click a folder → Set as Codex Context'
      )];
    }

    // Document failed to parse - show error state
    return [new CodexFileHeaderItem(
      vscode.Uri.file(''),
      false,
      'Failed to parse document'
    )];
```

**Step 3: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 4: Commit**

```bash
git add src/treeProvider.ts
git commit -m "fix(tree): clear state on parse failure and show user feedback

- Clear indexDoc/isIndexMode/loading on setContextFolder errors
- Show welcome message when no context set (instead of empty tree)
- Show error message when document parse fails
- Stringify error objects properly in error messages"
```

---

### Task 3: Store Event Listeners for Disposal

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Add disposables array to class and update constructor**

Add private field after line 558:

```typescript
private disposables: vscode.Disposable[] = [];
```

**Step 2: Update constructor event listeners (lines 625-643) to store in disposables**

```typescript
constructor() {
  console.log('[ChapterWise Codex] TreeProvider constructor called');

  // Watch for document changes
  this.disposables.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      try {
        if (this.activeDocument && e.document.uri.toString() === this.activeDocument.uri.toString()) {
          this.updateCodexDoc();
        }
      } catch (error) {
        console.error('[ChapterWise] Error in onDidChangeTextDocument:', error);
      }
    })
  );

  // Watch for active editor changes
  this.disposables.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      console.log('[ChapterWise Codex] Active editor changed:', editor?.document?.fileName);
    })
  );

  // Watch for documents opening
  this.disposables.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      console.log('[ChapterWise Codex] Document opened:', doc.fileName);
    })
  );

  console.log('[ChapterWise Codex] TreeProvider initialized - context empty until explicitly set');
}
```

**Step 3: Add dispose method to CodexTreeProvider**

Add after the constructor:

```typescript
/**
 * Dispose all event listeners and resources
 */
dispose(): void {
  for (const d of this.disposables) {
    d.dispose();
  }
  this.disposables.length = 0;
  this._onDidChangeTreeData.dispose();
}
```

**Step 4: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 5: Commit**

```bash
git add src/treeProvider.ts
git commit -m "fix(tree): store event listeners for proper disposal

- Add disposables array to CodexTreeProvider
- Store all event listeners in disposables for cleanup
- Add dispose() method to CodexTreeProvider
- Wrap onDidChangeTextDocument in try-catch to prevent silent crashes"
```

---

### Task 4: Wrap Tree Item Creation Loops in Try-Catch + Children Bounds Checks

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Update getIndexChildren root loop (lines 1160-1163)**

Replace the for loop:

```typescript
      // Add top-level children from index
      for (const child of this.indexDoc.children) {
        try {
          items.push(this.createIndexTreeItem(child, workspaceRoot, uri));
        } catch (error) {
          log(`[TreeProvider] Error creating tree item for ${child?.name || 'unknown'}: ${error}`);
        }
      }
```

**Step 2: Update getIndexChildren child expansion (lines 1186-1188)**

Replace the map:

```typescript
        const childItems: CodexTreeItemType[] = [];
        for (const child of element.indexNode.children) {
          try {
            childItems.push(this.createIndexTreeItem(child, workspaceRoot, uri));
          } catch (error) {
            log(`[TreeProvider] Error creating child tree item for ${child?.name || 'unknown'}: ${error}`);
          }
        }
        return childItems;
```

**Step 3: Fix children bounds checks in getCodexChildren**

At lines 1052 and 1056, change `root.children.length` to use optional chaining:

```typescript
// Line 1052
items.push(new CodexTreeItem(root, uri, (root.children?.length ?? 0) > 0, true, nodeHasFields(root)));

// Line 1055-1057
items.push(...root.children.map(
  (child) => new CodexTreeItem(child, uri, (child.children?.length ?? 0) > 0, true, nodeHasFields(child))
));
```

And at lines 1115-1123:

```typescript
items.push(...node.children.map(
  (child) => new CodexTreeItem(
    child,
    uri,
    (child.children?.length ?? 0) > 0,
    false,
    childHasFields && (child.availableFields.length > 0 || child.hasAttributes || child.hasContentSections)
  )
));
```

Also at lines 1274-1278 in getCodexFileStructure:

```typescript
const items = root.children.map(child =>
  new CodexTreeItem(
    child,
    fileUri,
    (child.children?.length ?? 0) > 0,
    false,
    false
  )
);
```

**Step 4: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 5: Commit**

```bash
git add src/treeProvider.ts
git commit -m "fix(tree): error handling in tree item loops and children bounds checks

- Wrap tree item creation loops in try-catch (skip bad items)
- Use optional chaining for children.length checks throughout
- One malformed node no longer breaks entire tree view"
```

---

### Task 5: Add Type Guard for IndexChildNode Private Properties

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Add type guard function after isPathWithinRoot helper**

```typescript
/**
 * Safe accessor for IndexChildNode private properties.
 * Avoids unsafe `as any` casts throughout tree provider.
 */
function getNodeKind(node: IndexChildNode): string | undefined {
  return (node as Record<string, unknown>)._node_kind as string | undefined;
}

function getNodeParentFile(node: IndexChildNode): string | undefined {
  return (node as Record<string, unknown>)._parent_file as string | undefined;
}

function getNodeFieldName(node: IndexChildNode): string | undefined {
  return (node as Record<string, unknown>)._field_name as string | undefined;
}

function getNodeFieldType(node: IndexChildNode): string | undefined {
  return (node as Record<string, unknown>)._field_type as string | undefined;
}

function getNodeParentEntity(node: IndexChildNode): string | undefined {
  return (node as Record<string, unknown>)._parent_entity as string | undefined;
}

function getNodeDepth(node: IndexChildNode): number | undefined {
  return (node as Record<string, unknown>)._depth as number | undefined;
}

function getNodeErrorMessage(node: IndexChildNode): string | undefined {
  return (node as Record<string, unknown>)._error_message as string | undefined;
}

function getNodeOriginalInclude(node: IndexChildNode): string | undefined {
  return (node as Record<string, unknown>)._original_include as string | undefined;
}
```

**Step 2: Replace `as any` casts in IndexNodeTreeItem constructor (lines 149-314)**

Replace all `(indexNode as any)._node_kind` → `getNodeKind(indexNode)`, etc.

Key replacements:
- Line 149: `const nodeKind = getNodeKind(indexNode);`
- Line 207: `const parentFile = getNodeParentFile(indexNode);`
- Line 258: Replace `const node = this.indexNode as any;` with individual accessor calls
- Line 314: Same pattern in getIcon()

**Step 3: Replace `as any` in getIndexChildren (line 1175-1176)**

```typescript
const nodeKind = getNodeKind(element.indexNode);
```

**Step 4: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 5: Commit**

```bash
git add src/treeProvider.ts
git commit -m "refactor(tree): replace unsafe 'as any' casts with type guard accessors

- Add getNodeKind/getNodeParentFile/etc. accessor functions
- Replace all (indexNode as any)._node_kind patterns
- Centralized type access makes properties easier to validate
- No runtime behavior change, purely type safety improvement"
```

---

### Task 6: Remove console.log Statements from getFilePath

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Remove or convert console.log to log() in getFilePath**

The excessive console.log statements (lines 394-397, 403, 408, 424-425) should be removed from the already-updated getFilePath method (they were removed in Task 1).

**Step 2: Verify no other production console.log remain**

Check for unnecessary console.log statements in tree provider and convert to `log()` where needed.

**Step 3: Commit** (combine with Task 5 if small change)

---

### Task 7: Update META-DEV-PROMPT

**Files:**
- Modify: `/Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md`

**Step 1: Mark Tree Provider & Navigation as complete**

Find line with Tree Provider & Navigation and change:

```
| 21 | Tree Provider & Navigation | ⬜ | 3 | | | FILES mode, INDEX mode |
```

To:

```
| 21 | Tree Provider & Navigation | ✅ | 3 | 2026-02-05 | | Path traversal fix, type guards, error handling, disposal |
```

**Step 2: Add decision log entry**

Add to NOTES & DECISIONS LOG section:

```markdown
### 2026-02-05 - Tree Provider & Navigation Hardening (#21) [chapterwise-codex]
Decision: Comprehensive hardening for tree provider and navigation system
Changes:
- Path traversal prevention: isPathWithinRoot() validates all resolved paths
- Null safety: workspaceRoot checked before all path.join operations
- State cleanup: clear indexDoc/isIndexMode on parse failures
- Event disposal: store all event listeners in disposables array
- Error handling: tree item creation loops wrapped in try-catch
- Type guards: replace unsafe `as any` casts with accessor functions
- UX: show welcome/error messages instead of empty tree
- Bounds checks: optional chaining on children.length throughout
Deferred (Low priority):
- Large tree pagination/lazy loading
- Consistent error message formatting
- JSDoc documentation for unsafe casts
```

**Step 3: Commit**

```bash
git add /Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md
git commit -m "docs: mark Tree Provider & Navigation as hardened"
```

---

## Verification Checklist

Before marking complete:

- [ ] isPathWithinRoot() helper function added
- [ ] resolveFilePath() validates path boundaries
- [ ] getFilePath() checks workspaceRoot null + validates paths
- [ ] setContextFolder clears state on error
- [ ] getChildren shows welcome/error instead of empty arrays
- [ ] Event listeners stored in disposables array
- [ ] dispose() method added to CodexTreeProvider
- [ ] onDidChangeTextDocument wrapped in try-catch
- [ ] Tree item creation loops wrapped in try-catch
- [ ] children.length uses optional chaining throughout
- [ ] Type guard accessor functions replace `as any` casts
- [ ] console.log removed from getFilePath
- [ ] Extension compiles without errors
- [ ] META-DEV-PROMPT updated
