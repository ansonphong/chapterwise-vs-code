# Extension Hardening Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 15 bugs and 3 quality gaps from two code review passes — security flaws, data corruption risks, functional bugs, UX issues, listener leaks, and maintainability gaps.

**Architecture:** Each fix is isolated to 1-3 files. Tasks are ordered by severity: security first, then data corruption, functional bugs, UX bugs, and quality improvements. Every fix follows TDD — write/update failing tests before implementation.

**Tech Stack:** TypeScript, Vitest, VS Code extension API, `yaml` library

**Scope:** 18 tasks total. Tasks 1-10 from review pass 1, Tasks 11-18 from review pass 2.

---

## Task 1: Fix `isPathWithinWorkspace` Security Flaw

The helper strips leading `/` before resolving, so absolute paths like `/etc/passwd` are treated as relative — resolving inside the workspace. This defeats the path-traversal guard used by `gitSetup.ts` and image handlers.

**Files:**
- Modify: `src/writerView/utils/helpers.ts:41-48`
- Modify: `src/writerView/utils/helpers.test.ts:75-88`

**Step 1: Update the failing tests**

Change the two tests that currently bless the broken behavior to assert `false`:

```typescript
// src/writerView/utils/helpers.test.ts — replace lines 75-88

it('rejects absolute path outside workspace', () => {
  expect(isPathWithinWorkspace('/etc/passwd', root)).toBe(false);
});

it('rejects absolute path to another directory', () => {
  expect(isPathWithinWorkspace('/tmp/evil/file.md', root)).toBe(false);
});

it('accepts absolute path genuinely inside workspace', () => {
  expect(isPathWithinWorkspace('/workspace/project/chapter1.md', root)).toBe(true);
});

it('accepts absolute path to a subdirectory inside workspace', () => {
  expect(isPathWithinWorkspace('/workspace/project/subdir/file.md', root)).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 2 new tests FAIL (`/etc/passwd` returns `true` but we expect `false`)

**Step 3: Fix the implementation**

```typescript
// src/writerView/utils/helpers.ts — replace lines 41-48

export function isPathWithinWorkspace(targetPath: string, workspaceRoot: string): boolean {
  if (!workspaceRoot) {
    return false;
  }
  const resolved = path.resolve(workspaceRoot, targetPath);
  const relative = path.relative(workspaceRoot, resolved);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
```

The only change is removing `.replace(/^\//, '')`. With this fix, `path.resolve('/workspace/project', '/etc/passwd')` yields `/etc/passwd`, `path.relative` yields `../../etc/passwd`, and `startsWith('..')` catches it.

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: ALL tests PASS

**Step 5: Commit**

```bash
git add src/writerView/utils/helpers.ts src/writerView/utils/helpers.test.ts
git commit -m "fix: remove leading-slash strip from isPathWithinWorkspace

Absolute paths like /etc/passwd were incorrectly accepted as 'inside
workspace' because the leading / was stripped before path.resolve,
making them resolve relative to workspace root."
```

---

## Task 2: Fix Drag/Drop Path Mismatch (Absolute vs Relative)

`handleDrag` serializes `item.getFilePath()` (absolute) into `DragData.filePath`, but all consumers (`reorderFileInIndex`, `moveFileInIndex`, `getDropPosition`) expect workspace-relative paths. Result: reorder silently fails, sibling detection never fires, and move works only by accident on POSIX.

**Files:**
- Modify: `src/dragDropController.ts:117`

**Step 1: Fix the serialization**

```typescript
// src/dragDropController.ts line 117 — change:
filePath: item.getFilePath(),

// to:
filePath: item.indexNode._computed_path || '',
```

`_computed_path` is always workspace-relative (e.g. `chapters/act1.codex.yaml`). All downstream consumers already expect relative paths. This single-line fix repairs:
- Reorder: `reorderFileInIndex` receives a relative path, `orderingManager.moveToPosition` can match folder segments
- Move: `moveFileInIndex` receives relative paths, `path.join(workspaceRoot, sourceFilePath)` produces correct absolute paths
- Sibling detection: `path.dirname(item.filePath)` now matches `path.dirname(target.indexNode._computed_path)` because both are relative
- Sibling lookup: `path.join(workspaceRoot, folderPath, ...)` no longer double-joins

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no type changes — both `getFilePath()` and `_computed_path` are `string`)

**Step 3: Run tests**

Run: `npm test`
Expected: ALL tests PASS

**Step 4: Commit**

```bash
git add src/dragDropController.ts
git commit -m "fix: use workspace-relative _computed_path in drag serialization

getFilePath() returns absolute paths but all consumers (reorder,
move, sibling detection) expect workspace-relative. Using
_computed_path directly fixes silent reorder failures and broken
sibling detection."
```

---

## Task 3: Make Image Mutations Format-Safe for JSON

All 5 image mutation handlers (`updateImageCaption`, `handleDeleteImage`, `handleReorderImages`, `addImagesToNode`, and the caption handler) blindly use `YAML.parseDocument()` + `doc.toString()`. When the file is `.codex.json`, `doc.toString()` emits YAML syntax, permanently corrupting the JSON file.

**Files:**
- Modify: `src/writerView/manager.ts` (5 mutation handlers)
- Modify: `src/codexModel.ts` (export `isJsonContent` if not already exported)

**Step 1: Verify `isJsonContent` is accessible**

Check if `isJsonContent` is exported from `codexModel.ts`. If not, export it:

```typescript
// src/codexModel.ts — ensure this function is exported
export function isJsonContent(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
```

**Step 2: Create a shared format-aware write helper in manager.ts**

Add this private helper to `WriterViewManager`:

```typescript
/**
 * Read, mutate, and write a codex file in a format-safe way.
 * For YAML: uses YAML AST surgery (preserves formatting).
 * For JSON: parses as object, calls mutator, writes JSON.
 * For Markdown: rejects (images not supported).
 */
private async mutateNodeImages(
  documentUri: vscode.Uri,
  node: CodexNode,
  yamlMutator: (doc: YAML.Document, targetNode: YAML.YAMLMap) => void,
  jsonMutator: (obj: any, nodePath: string[]) => void
): Promise<void> {
  const filePath = documentUri.fsPath;

  if (isMarkdownFile(filePath)) {
    vscode.window.showErrorMessage('Image editing is not supported for Markdown files.');
    return;
  }

  const text = await fsPromises.readFile(filePath, 'utf-8');
  let newText: string;

  if (isJsonContent(text)) {
    const obj = JSON.parse(text);
    const nodePath = this.getNodePathSegments(node);
    jsonMutator(obj, nodePath);
    newText = JSON.stringify(obj, null, 2);
  } else {
    const doc = YAML.parseDocument(text);
    const targetNode = this.findNodeInYamlDoc(doc, node);
    if (!targetNode) {
      vscode.window.showErrorMessage('Could not find node in document');
      return;
    }
    yamlMutator(doc, targetNode);
    newText = doc.toString();
  }

  await fsPromises.writeFile(filePath, newText);
}
```

**Step 3: Add `getNodePathSegments` helper**

This helper navigates a parsed JSON object to find the target node by matching `node.id` or `node.name`:

```typescript
private getNodePathSegments(node: CodexNode): string[] {
  // Build path segments to locate node in JSON structure
  // The node's id or name is used to find it
  return [node.id || node.name];
}
```

**Step 4: Refactor `updateImageCaption` to use the helper**

Replace the body of the caption-save handler (inside `withFileLock`) to use `mutateNodeImages` with both YAML and JSON mutators. The YAML mutator iterates `images.items` to find the matching URL and sets/deletes the caption. The JSON mutator finds the node's `images` array and updates the caption by URL.

**Step 5: Refactor `handleDeleteImage` similarly**

Replace `YAML.parseDocument`/`doc.toString()` with `mutateNodeImages`, providing both a YAML mutator (splice from `YAMLSeq`) and a JSON mutator (filter the images array).

**Step 6: Refactor `handleReorderImages` similarly**

Both mutators reorder the images array by the given URL order.

**Step 7: Refactor `addImagesToNode` similarly**

Both mutators append new image objects to the images array.

**Step 8: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 9: Commit**

```bash
git add src/writerView/manager.ts src/codexModel.ts
git commit -m "fix: make image mutations format-safe for .codex.json files

All image handlers (caption, delete, reorder, add) previously used
YAML.parseDocument + doc.toString unconditionally, corrupting JSON
files. Now detects format and uses JSON.parse/stringify for JSON files."
```

---

## Task 4: Convert Direct Disk Writes to WorkspaceEdit

`handleRenameName` and 4 image mutation handlers use `fsPromises.readFile`/`writeFile` directly, bypassing VS Code's document model. If the same file is open and dirty in a text editor, these writes operate on stale on-disk contents and can clobber unsaved edits.

**Files:**
- Modify: `src/writerView/manager.ts` (5 handlers)

**Step 1: Refactor `handleRenameName` to use WorkspaceEdit**

Replace `fsPromises.readFile`/`writeFile` with the same `openTextDocument` → `WorkspaceEdit` → `applyEdit` → `document.save()` pattern used by `handleSave`:

```typescript
// src/writerView/manager.ts handleRenameName — replace lines 1111-1131

const document = await vscode.workspace.openTextDocument(documentUri);
const originalText = document.getText();
const fileName = documentUri.fsPath.toLowerCase();
let newDocText: string | null = null;

if (isMarkdownFile(fileName)) {
  newDocText = setMarkdownFrontmatterField(originalText, 'name', trimmed);
} else {
  const codexDoc = parseCodex(originalText);
  if (!codexDoc) {
    safePostMessage(panel, { type: 'nameUpdateError', error: 'Unable to parse document for renaming.' });
    return;
  }
  newDocText = setNodeName(codexDoc, node, trimmed);
}

if (!newDocText) {
  safePostMessage(panel, { type: 'nameUpdateError', error: 'Rename failed: could not update text.' });
  return;
}

const edit = new vscode.WorkspaceEdit();
const fullRange = new vscode.Range(
  document.positionAt(0),
  document.positionAt(originalText.length)
);
edit.replace(documentUri, fullRange, newDocText);
const success = await vscode.workspace.applyEdit(edit);
if (success) {
  await document.save();
}
```

**Step 2: Update `mutateNodeImages` helper (from Task 3) to use WorkspaceEdit**

If Task 3 was done first, update the helper's write path. Replace `fsPromises.readFile` with `openTextDocument().getText()` and `fsPromises.writeFile` with `WorkspaceEdit.replace` + `applyEdit` + `save`:

```typescript
const document = await vscode.workspace.openTextDocument(documentUri);
const text = document.getText();
// ... compute newText as before ...
const edit = new vscode.WorkspaceEdit();
edit.replace(documentUri, new vscode.Range(
  document.positionAt(0),
  document.positionAt(text.length)
), newText);
const success = await vscode.workspace.applyEdit(edit);
if (success) {
  await document.save();
}
```

Keep `withFileLock` wrappers — they are still needed to prevent interleaved edits from concurrent webview messages.

**Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix: convert direct disk writes to WorkspaceEdit

handleRenameName and image mutation handlers previously bypassed VS
Code's document model with fsPromises.readFile/writeFile. Now uses
openTextDocument + WorkspaceEdit + applyEdit + save, preventing
stale-read clobber when the file is open in a text editor."
```

---

## Task 5: Fix Search Navigation for Structural Results

The search command passes `result.id` (a plain string) to `chapterwiseCodex.navigateToNode`, but the handler immediately returns unless it receives an `IndexNodeTreeItem` with `.indexNode`. Structural search hits (folders, books, indexes) silently do nothing.

**Files:**
- Modify: `src/commands/navigation.ts:210-213`
- Modify: `src/commands/search.ts:72-75`

**Step 1: Widen the `navigateToNode` handler to accept string ID + path**

Change the handler to accept either an `IndexNodeTreeItem` or a `{ nodeId: string, parentFile: string }` object:

```typescript
// src/commands/navigation.ts line 210 — replace guard

async (arg?: IndexNodeTreeItem | { nodeId: string; parentFile: string }) => {
  let nodeId: string | undefined;
  let parentFile: string | undefined;

  if (arg && 'indexNode' in arg) {
    // Called from tree context menu with IndexNodeTreeItem
    const indexNode = (arg as IndexNodeTreeItem).indexNode as any;
    nodeId = indexNode.id;
    parentFile = indexNode._parent_file;
  } else if (arg && 'nodeId' in arg) {
    // Called from search with plain object
    nodeId = arg.nodeId;
    parentFile = arg.parentFile;
  }

  if (!parentFile) {
    vscode.window.showWarningMessage('Cannot navigate: No parent file found');
    return;
  }

  // ... rest of handler unchanged from line 223 onward,
  // but use `nodeId` variable instead of `node.id`
  // and `parentFile` variable instead of `node._parent_file`
```

**Step 2: Update the search command call site**

```typescript
// src/commands/search.ts lines 72-75 — replace:

await vscode.commands.executeCommand(
  'chapterwiseCodex.navigateToNode',
  result.id
);

// with:

await vscode.commands.executeCommand(
  'chapterwiseCodex.navigateToNode',
  { nodeId: result.id, parentFile: result.path }
);
```

**Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/commands/navigation.ts src/commands/search.ts
git commit -m "fix: enable search navigation for structural results

navigateToNode now accepts { nodeId, parentFile } objects in addition
to IndexNodeTreeItem, so search results for folders/books/indexes
can navigate to the Writer View instead of silently failing."
```

---

## Task 6: Fix Markdown Type Changes Being Silently Dropped

When a user changes the node type on a `.md` file, `handleSave` calls `parseCodex(newDocText)` which returns `null` for markdown content — silently skipping the type update.

**Files:**
- Modify: `src/writerView/manager.ts:975-982`

**Step 1: Add markdown branch to the type-update block**

```typescript
// src/writerView/manager.ts — replace lines 975-982

// Update type if changed
if (newType && newType !== node.type) {
  if (isMarkdownFile(fileName)) {
    newDocText = setMarkdownFrontmatterField(newDocText, 'type', newType);
    node.type = newType;
  } else {
    const codexDocWithType = parseCodex(newDocText);
    if (codexDocWithType) {
      newDocText = setNodeType(codexDocWithType, node, newType);
      node.type = newType;
    }
  }
}
```

`setMarkdownFrontmatterField` already exists in `codexModel.ts` and handles inserting/updating any frontmatter key. It is already imported in `manager.ts` and used in the prose-save markdown branch above.

**Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix: persist type changes for Markdown/Codex Lite files

Type updates used parseCodex() unconditionally, which returns null
for .md files. Now uses setMarkdownFrontmatterField for markdown,
matching how name and summary are already handled."
```

---

## Task 7: Fix Overview Save-State Dirty Tracking

The `'saved'` message handler only clears `isDirty` regardless of which field was saved. `checkAllClean()` omits `summaryDirty` and `bodyDirty` from its condition. Result: save indicator shows "saved" prematurely, and `summaryDirty`/`bodyDirty` flags are never cleared by the per-field save path.

**Files:**
- Modify: `src/writerView/manager.ts:422` (add field to 'saved' response)
- Modify: `src/writerView/script.ts:1160-1164` (clear correct flag)
- Modify: `src/writerView/script.ts:1846-1856` (include summary/body in condition)

**Step 1: Include the saved field name in the 'saved' response**

```typescript
// src/writerView/manager.ts line 422 — change:
safePostMessage(panel, { type: 'saved' });

// to:
safePostMessage(panel, { type: 'saved', field: fieldToSave });
```

**Step 2: Update the 'saved' handler to clear the correct flag**

```javascript
// src/writerView/script.ts lines 1160-1164 — replace:

case 'saved':
  isDirty = false;
  isSaving = false;
  if (saveGuardTimer) { clearTimeout(saveGuardTimer); saveGuardTimer = null; }
  checkAllClean();
  break;

// with:

case 'saved': {
  const savedField = message.field;
  if (savedField === 'summary') {
    summaryDirty = false;
  } else if (savedField === 'body') {
    bodyDirty = false;
  } else {
    isDirty = false;
  }
  isSaving = false;
  if (saveGuardTimer) { clearTimeout(saveGuardTimer); saveGuardTimer = null; }
  checkAllClean();
  break;
}
```

**Step 3: Include summary/body in `checkAllClean` condition**

```javascript
// src/writerView/script.ts line 1847 — replace:
if (!isDirty && !attributesDirty && !contentSectionsDirty && !imagesDirty) {

// with:
if (!isDirty && !attributesDirty && !contentSectionsDirty && !summaryDirty && !bodyDirty && !imagesDirty) {
```

**Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/writerView/manager.ts src/writerView/script.ts
git commit -m "fix: correct overview save-state dirty tracking

The 'saved' handler now clears the specific dirty flag (summary,
body, or prose) based on the field that was saved. checkAllClean
now includes summaryDirty and bodyDirty in its condition, preventing
premature 'All changes saved' display."
```

---

## Task 8: Fix `navigateToNode` Sync File I/O

While fixing search navigation in Task 5, also replace `fs.existsSync` and `fs.readFileSync` with async equivalents in the `navigateToNode` handler (lines 231, 237).

**Files:**
- Modify: `src/commands/navigation.ts:231-237`

**Step 1: Replace sync calls with async**

```typescript
// src/commands/navigation.ts — replace lines 231-237

// Old:
if (!fs.existsSync(fullPath)) {
  ...
}
const fileContent = fs.readFileSync(fullPath, 'utf-8');

// New:
try {
  await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
} catch {
  vscode.window.showWarningMessage(`File not found: ${parentFile}`);
  return;
}

const uri = vscode.Uri.file(fullPath);
const fileContentBytes = await vscode.workspace.fs.readFile(uri);
const fileContent = Buffer.from(fileContentBytes).toString('utf-8');
```

**Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/commands/navigation.ts
git commit -m "fix: replace sync file I/O with async in navigateToNode

fs.existsSync and fs.readFileSync block the extension host thread.
Now uses vscode.workspace.fs.stat and readFile."
```

---

## Task 9: Lazy Extension Activation

The extension activates on `onStartupFinished` for every workspace, even those with no Codex files. This creates 9+ tree views, scans the workspace, and registers 50+ commands unconditionally.

**Files:**
- Modify: `package.json:26-28` (activation events)

**Step 1: Replace `onStartupFinished` with targeted activation**

```json
"activationEvents": [
  "workspaceContains:**/*.codex.yaml",
  "workspaceContains:**/*.codex.json",
  "workspaceContains:**/*.codex"
]
```

The `onView:*` events are implicit from the view contributions in `package.json` (VS Code 1.74+). Command activation events are implicit from registered commands. Language activation is implicit from `languages` contributions. Together these cover all entry points:

- **Workspace has Codex files** → `workspaceContains` fires at startup
- **User clicks sidebar** → implicit `onView` fires
- **User runs command from palette** → implicit `onCommand` fires
- **User opens a `.codex.yaml`** → implicit `onLanguage` fires

**Step 2: Run integration tests to verify activation still works**

Run: `npm run typecheck && npm test`
Expected: PASS (unit tests don't test activation; integration tests will verify in CI)

**Step 3: Commit**

```bash
git add package.json
git commit -m "perf: lazy activation — only activate when Codex files exist

Replace onStartupFinished with workspaceContains globs. Combined
with implicit onView, onCommand, and onLanguage events from VS Code
1.74+, the extension activates on-demand instead of on every startup."
```

---

## Task 10: Fix Lint Errors (Autofix + Manual)

18 lint errors, 10 auto-fixable. Clean up the errors (not warnings — those are lower priority).

**Files:**
- Multiple files (see lint output)

**Step 1: Run auto-fix**

Run: `npx eslint --fix src/`

This fixes the 10 `prefer-const` and similar auto-fixable errors.

**Step 2: Fix the `require()` import in builder.ts**

```typescript
// src/writerView/html/builder.ts line 57 — replace:
const path = require('path');

// with (add to top-level imports):
import * as path from 'path';
```

Remove the inline `require` since `path` should already be imported at the top of the file, or add it to the existing imports.

**Step 3: Fix remaining manual lint errors**

Address remaining non-auto-fixable errors individually. Most are `prefer-const` that weren't caught by `--fix` or stray `any` types.

**Step 4: Run lint to verify zero errors**

Run: `npm run lint 2>&1 | grep "error" | tail -5`
Expected: 0 errors (warnings are acceptable for now)

**Step 5: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: fix all 18 lint errors

Auto-fixed prefer-const violations. Replaced require() with ES
import in builder.ts. Remaining warnings are non-blocking."
```

---

## Execution Order

| Priority | Task | Risk | Files Changed |
|----------|------|------|---------------|
| P0 — Security | Task 1: Path traversal fix | Exploitable path validation bypass | 2 |
| P1 — Data corruption | Task 2: Drag/drop paths | Silent reorder failure, broken sibling detection | 1 |
| P1 — Data corruption | Task 3: JSON format safety | Permanent file corruption for .codex.json | 2 |
| P1 — Data integrity | Task 4: WorkspaceEdit conversion | Stale-read clobber of unsaved edits | 1 |
| P2 — Functional | Task 5: Search navigation | Structural results do nothing on click | 2 |
| P2 — Functional | Task 6: Markdown type persist | Type changes silently lost for .md files | 1 |
| P2 — UX | Task 7: Dirty tracking | Premature "saved" indicator, flags never cleared | 2 |
| P3 — Quality | Task 8: Async file I/O | Thread blocking in navigation | 1 |
| P3 — Performance | Task 9: Lazy activation | Unnecessary activation cost for non-Codex workspaces | 1 |
| P3 — Quality | Task 10: Lint errors | 18 lint errors in CI | multiple |

**Dependencies:** Tasks 3 and 4 overlap in `manager.ts` image handlers — do Task 3 first (format safety), then Task 4 (WorkspaceEdit conversion) builds on top. Task 11 depends on Task 1 being done first (same helper). All other tasks are independent and can be done in any order.

---

## Task 11: Harden `fileOps.ts` Path Validation

The `isPathWithinWorkspace` fix in Task 1 also affects `fileOps.ts`, which uses the same helper. Additionally, `renameFolder` never validates `oldFullPath`, and `openInFinder` has no validation at all.

**Files:**
- Modify: `src/commands/fileOps.ts:26,63,86,97,197`

**Depends on:** Task 1 (the helper fix)

**Step 1: Add validation for `oldFullPath` in `renameFolder`**

```typescript
// src/commands/fileOps.ts renameFolder — after line 97, before fs.rename:

if (!isPathWithinWorkspace(oldFullPath, wsRoot)) {
  vscode.window.showErrorMessage('Source path is outside workspace.');
  return;
}
```

Currently only `newFullPath` is validated (line 100). The `oldFullPath` is derived from raw `_computed_path` and passed directly to `fsPromises.rename` without any check.

**Step 2: Add validation for `openInFinder`**

```typescript
// src/commands/fileOps.ts openInFinder — after computing fullPath:

if (!isPathWithinWorkspace(fullPath, wsRoot)) {
  vscode.window.showErrorMessage('Path is outside workspace.');
  return;
}
```

Currently at line 197-199, `_computed_path` is joined with `wsRoot` and passed directly to `revealFileInOS` with zero validation.

**Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/commands/fileOps.ts
git commit -m "fix: add missing path validation in fileOps

renameFolder now validates oldFullPath before fs.rename.
openInFinder now validates the path before revealFileInOS.
Both previously trusted raw _computed_path without checks."
```

---

## Task 12: Fix Save As from Markdown to YAML/JSON

`handleSaveAs` in `manager.ts:1047` feeds markdown content to `YAML.parse(content)`, which throws on the `---` frontmatter delimiters (multi-document stream). The fix is to detect markdown source files and use the existing `CodexMarkdownConverter` to convert properly.

**Files:**
- Modify: `src/writerView/manager.ts:1040-1048`

**Step 1: Add markdown branch to the source-format detection**

```typescript
// src/writerView/manager.ts — replace lines 1043-1048

// Old (broken):
if (currentPath.toLowerCase().endsWith('.json')) {
    data = JSON.parse(content);
} else {
    data = YAML.parse(content);
}

// New (fixed):
if (currentPath.toLowerCase().endsWith('.json')) {
    data = JSON.parse(content);
} else if (isMarkdownFile(currentPath)) {
    // Convert markdown frontmatter + body to Codex object
    const codexDoc = parseMarkdownAsCodex(content, currentPath);
    if (!codexDoc || !codexDoc.rootNode) {
      vscode.window.showErrorMessage('Unable to parse Markdown document for conversion.');
      return;
    }
    // Build a Codex-compatible data object from the parsed node
    const node = codexDoc.rootNode;
    data = {
      name: node.name,
      type: node.type || 'document',
      id: node.id,
      metadata: codexDoc.metadata || {},
    };
    if (node.summary) data.summary = node.summary;
    if (node.body) data.body = node.body;
    if (node.attributes && node.attributes.length > 0) data.attributes = node.attributes;
    if (node.contentSections && node.contentSections.length > 0) data.content = node.contentSections;
} else {
    data = YAML.parse(content);
}
```

`isMarkdownFile` and `parseMarkdownAsCodex` are already imported in `manager.ts`.

**Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix: handle Save As from Markdown to YAML/JSON

Markdown files with frontmatter were fed to YAML.parse() which
throws on multi-document streams. Now uses parseMarkdownAsCodex
to extract a proper Codex object before format conversion."
```

---

## Task 13: Guard Markdown Files from Attribute/Content Mutations

`handleSaveAttributes` and `handleSaveContentSections` call `parseCodex()` unconditionally, which misparses markdown. `handleAddField` for `attributes`/`content` cases calls `setNodeAttributes`/`setNodeContentSections` which run YAML AST surgery on markdown text, corrupting the file.

**Files:**
- Modify: `src/writerView/manager.ts` (`handleSaveAttributes:1147`, `handleSaveContentSections:1184`, `handleAddField:1266-1287`)

**Step 1: Add markdown early-return to `handleSaveAttributes`**

```typescript
// src/writerView/manager.ts handleSaveAttributes — add before parseCodex call:

const fileName = documentUri.fsPath;
if (isMarkdownFile(fileName)) {
  vscode.window.showWarningMessage('Attributes are not yet supported for Markdown/Codex Lite files.');
  return;
}
```

**Step 2: Add markdown early-return to `handleSaveContentSections`**

```typescript
// src/writerView/manager.ts handleSaveContentSections — add before parseCodex call:

const fileName = documentUri.fsPath;
if (isMarkdownFile(fileName)) {
  vscode.window.showWarningMessage('Content sections are not yet supported for Markdown/Codex Lite files.');
  return;
}
```

**Step 3: Add markdown guard to `handleAddField` for attributes/content cases**

```typescript
// src/writerView/manager.ts handleAddField — in case 'attributes' and case 'content':

case 'attributes':
  if (isMarkdownFile(fileName)) {
    vscode.window.showWarningMessage('Attributes are not yet supported for Markdown files.');
    return;
  }
  // ... existing code ...

case 'content':
  if (isMarkdownFile(fileName)) {
    vscode.window.showWarningMessage('Content sections are not yet supported for Markdown files.');
    return;
  }
  // ... existing code ...
```

This is the safe fix — reject the operation with a clear message rather than silently corrupting the file. Full markdown support for structured data can be added later.

**Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix: guard markdown files from attribute/content mutations

handleSaveAttributes, handleSaveContentSections, and handleAddField
for attributes/content now reject markdown files with a warning
instead of silently corrupting them via YAML AST surgery on
markdown text."
```

---

## Task 14: Add Auto-Save for Overview Prose Fields

Only the main prose editor has a 2-second inactivity auto-save timer and blur-save. The overview `summary` and `body` editors only set dirty flags — the user must press Ctrl+S manually.

**Files:**
- Modify: `src/writerView/script.ts` (~lines 1058-1070)

**Step 1: Add auto-save timers to overview prose change handlers**

```javascript
// src/writerView/script.ts — replace handleSummaryChange and handleBodyChange:

let summaryAutoSaveTimer = null;
let bodyAutoSaveTimer = null;

function handleSummaryChange() {
  if (summaryEditorContent && summaryEditorContent.innerText !== originalSummary) {
    summaryDirty = true;
    updateDirtyIndicator();
    // Auto-save after 2 seconds of inactivity
    if (summaryAutoSaveTimer) clearTimeout(summaryAutoSaveTimer);
    summaryAutoSaveTimer = setTimeout(() => { save(); }, 2000);
  }
}

function handleBodyChange() {
  if (bodyEditorContent && bodyEditorContent.innerText !== originalBody) {
    bodyDirty = true;
    updateDirtyIndicator();
    // Auto-save after 2 seconds of inactivity
    if (bodyAutoSaveTimer) clearTimeout(bodyAutoSaveTimer);
    bodyAutoSaveTimer = setTimeout(() => { save(); }, 2000);
  }
}
```

**Step 2: Add blur-save to overview prose editors**

Find where `summaryEditorContent` and `bodyEditorContent` event listeners are set up, and add blur handlers:

```javascript
if (summaryEditorContent) {
  summaryEditorContent.addEventListener('blur', () => {
    if (summaryDirty) save();
  });
}
if (bodyEditorContent) {
  bodyEditorContent.addEventListener('blur', () => {
    if (bodyDirty) save();
  });
}
```

**Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/writerView/script.ts
git commit -m "fix: add auto-save for overview summary/body editors

Summary and body fields in overview mode now have 2-second
inactivity auto-save timers and blur-save, matching the main
prose editor behavior."
```

---

## Task 15: Wrap Image Import in File Lock

`importImage` bypasses `withFileLock` unlike all other image operations. If an import races with a concurrent image operation (delete, reorder, caption), the unguarded `addImagesToNode` read-modify-write can overwrite the concurrent operation's changes.

**Files:**
- Modify: `src/writerView/manager.ts` (~line 1453)

**Step 1: Wrap the importImage dispatch in `withFileLock`**

```typescript
// src/writerView/manager.ts — in the message handler switch, change:

case 'importImage':
    await this.handleImportImage(panel, documentUri, node, workspaceRoot);
    return true;

// to:

case 'importImage':
    await this.withFileLock(documentUri.fsPath, async () => {
      await this.handleImportImage(panel, documentUri, node, workspaceRoot);
    });
    return true;
```

This matches how `addExistingImage`, `deleteImage`, and `reorderImages` are wrapped. The lock serializes the entire import operation (file copy + YAML update), preventing race conditions.

**Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix: wrap importImage in withFileLock

importImage was the only image mutation not using the file lock,
allowing race conditions with concurrent caption/delete/reorder
operations on the same document."
```

---

## Task 16: Fix Toolbar Document Listener Leak

`initAddDropdown()` attaches a new `document.addEventListener('click', ...)` every time the user switches to the overview context. These anonymous listeners are never removed, accumulating with each context switch.

**Files:**
- Modify: `src/writerView/toolbar/toolbarScript.ts:329-334,405-410`

**Step 1: Move the outside-click handler to a single top-level registration**

Remove lines 329-334 from `initAddDropdown()`:

```javascript
// REMOVE from initAddDropdown():
// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!addDropdown.contains(e.target)) {
    closeAddDropdown();
  }
});
```

Add a single top-level listener at the end of the script (before `window.updateToolbarForField`), outside any function:

```javascript
// Single document-level click handler — registered once, queries DOM at call time
document.addEventListener('click', (e) => {
  const addDropdown = document.getElementById('toolbarAddDropdown');
  if (addDropdown && !addDropdown.contains(e.target)) {
    closeAddDropdown();
  }
});
```

This approach queries the DOM at call time rather than closing over a stale reference, so it works correctly even when the toolbar DOM is rebuilt by `updateToolbarContext`.

**Step 2: Remove redundant `initAddDropdown()` call from `initToolbar()`**

```javascript
// src/writerView/toolbar/toolbarScript.ts initToolbar — remove the direct call:

function initToolbar() {
  // initFormattingButtons();   ← REMOVE (updateToolbarContext handles this)
  // initAddDropdown();         ← REMOVE (updateToolbarContext handles this)
  updateToolbarContext(currentToolbarContext);
}
```

`updateToolbarContext` at line 410 already calls `initFormattingButtons()` or `initAddDropdown()` based on context. The direct calls at lines 406-407 cause double initialization.

**Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/writerView/toolbar/toolbarScript.ts
git commit -m "fix: eliminate toolbar document listener leak

initAddDropdown registered a new document click listener on every
context switch, accumulating indefinitely. Now uses a single
top-level listener registered once at script load."
```

---

## Task 17: Deduplicate Writer View Panel Bootstrap

The panel creation and message wiring is duplicated almost verbatim between `openWriterView` (lines 342-603) and `openWriterViewForField` (lines 684-930). Additionally, `openWriterViewForField` is missing `renameName` and `addField` message handlers — a functional bug.

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Extract shared bootstrap into a private method**

Create a new private method that encapsulates the shared panel setup:

```typescript
private async bootstrapPanel(
  node: CodexNode,
  documentUri: vscode.Uri,
  initialField: string,
  panelKey: string,
  codexDoc: CodexDocument,
  context: vscode.ExtensionContext
): Promise<void> {
  // All the shared logic: panel creation, HTML building, message
  // handler switch (including renameName + addField), dispose cleanup,
  // theme/config change listeners
}
```

**Step 2: Refactor `openWriterView` to use the shared method**

Keep only the field-selection algorithm (lines 269-292) and the existing-panel check, then call `bootstrapPanel`.

**Step 3: Refactor `openWriterViewForField` to use the shared method**

Keep only the existing-panel check (with `switchToField` post-message) and the `targetField` passthrough, then call `bootstrapPanel`.

**Step 4: Ensure `renameName` and `addField` are in the shared handler**

These two message cases exist in block 1 (lines 451-459) but are missing from block 2. The shared `bootstrapPanel` includes them, fixing the bug where panels opened via `openWriterViewForField` cannot rename or add fields.

**Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "refactor: deduplicate Writer View panel bootstrap

Extract shared panel setup from openWriterView and
openWriterViewForField into bootstrapPanel. Fixes missing
renameName and addField handlers in the openWriterViewForField
path."
```

---

## Task 18: Fix README Version Drift

README shows VS Code 1.85.0 but `package.json` declares `^1.80.0`. README shows `chapterwise-codex-0.1.0.vsix` but version is `0.3.2`.

**Files:**
- Modify: `README.md`

**Step 1: Update version references**

Replace all occurrences of `0.1.0` with `0.3.2` in README install instructions. Update the VS Code minimum version to match `package.json` (`1.80.0`).

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README version references

Fix VS Code minimum version (1.80.0, matching package.json engines).
Fix extension version in install commands (0.3.2)."
```

---

## Updated Execution Order

### Must Fix Before Publish

| Priority | Task | Risk | Files |
|----------|------|------|-------|
| P0 — Security | Task 1: Path traversal fix | Exploitable path validation bypass | 2 |
| P0 — Security | Task 11: fileOps path validation | Unvalidated paths in rename/reveal | 1 |
| P1 — Data corruption | Task 2: Drag/drop paths | Silent reorder failure, broken sibling detection | 1 |
| P1 — Data corruption | Task 3: JSON format safety | Permanent file corruption for .codex.json | 2 |
| P1 — Data corruption | Task 12: Save As markdown→YAML | Throws on markdown frontmatter | 1 |
| P1 — Data corruption | Task 13: Guard markdown structured edits | Silent file corruption on attribute/content save | 1 |
| P1 — Data integrity | Task 4: WorkspaceEdit conversion | Stale-read clobber of unsaved edits | 1 |
| P1 — Data integrity | Task 15: Image import file lock | Race condition on concurrent image ops | 1 |
| P2 — Functional | Task 5: Search navigation | Structural results do nothing on click | 2 |
| P2 — Functional | Task 6: Markdown type persist | Type changes silently lost for .md files | 1 |
| P2 — UX | Task 7: Dirty tracking | Premature "saved" indicator | 2 |
| P2 — UX | Task 14: Overview auto-save | Summary/body don't auto-save | 1 |
| P2 — UX | Task 16: Toolbar listener leak | Accumulating event listeners | 1 |

### Cleanup / Refactor Later

| Priority | Task | Risk | Files |
|----------|------|------|-------|
| P3 — Quality | Task 8: Async file I/O | Thread blocking in navigation | 1 |
| P3 — Performance | Task 9: Lazy activation | Unnecessary activation cost | 1 |
| P3 — Quality | Task 10: Lint errors | 18 lint errors in CI | multiple |
| P3 — Maintainability | Task 17: Deduplicate panel bootstrap | Fixes drift + missing handlers | 1 |
| P3 — Docs | Task 18: README version drift | Misleading install instructions | 1 |

**Dependencies:**
- Tasks 3 and 4 overlap in `manager.ts` image handlers — do Task 3 first, then Task 4 builds on top.
- Task 11 depends on Task 1 (same `isPathWithinWorkspace` helper).
- Task 7 and Task 14 both modify `script.ts` dirty tracking — do Task 7 first, then Task 14 extends it.
- Task 17 touches the same `manager.ts` code as Tasks 3, 4, 6, 12, 13, 15 — do it last among `manager.ts` tasks to avoid merge conflicts.
