# Code Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address the 4 important issues and 1 suggestion from the latest code review of the writerView hardening and search cleanup commits.

**Architecture:** Pure cleanup/hardening pass. No new features. Replace all raw `panel.webview.postMessage()` with `safePostMessage()`, fix `isPathWithinWorkspace` to use static imports and `path.relative()`, add type guards on the `save` handler's optional fields, and remove the dead `highlightMatches` stub.

**Tech Stack:** TypeScript, VS Code Extension API

---

### Task 1: Complete `safePostMessage` adoption in manager.ts

**Files:**
- Modify: `src/writerView/manager.ts` (21 remaining raw `postMessage` calls)

**Context:** The `safePostMessage` wrapper was introduced to handle the race condition where a panel is disposed between an existence check and a `postMessage` call. It was applied to ~13 call sites inside `onDidReceiveMessage` handlers but missed ~21 others throughout the file. All raw `panel.webview.postMessage(...)` calls must become `safePostMessage(panel, ...)`.

**Step 1: Replace all raw postMessage calls**

Find-and-replace every instance of `panel.webview.postMessage(` with `safePostMessage(panel, ` throughout `manager.ts`. The call sites are at lines:
- 624, 638 (theme change listener in `openWriterView`)
- 1032, 1046 (theme change listener in `openWriterViewForField`)
- 1243, 1259, 1266, 1276, 1279 (`handleRenameName`)
- 1454, 1470 (`handleAddField`)
- 1497, 1530, 1541 (`handleOpenImageBrowser`, `handleAddExistingImage`)
- 1571, 1577 (`handleImportImage`)
- 1627, 1630 (`handleDeleteImage`)
- 1680, 1683 (`handleReorderImages`)
- 1804 (`promptDuplicateResolution`)

Each replacement follows the same pattern:
```typescript
// Before:
panel.webview.postMessage({ type: 'foo', data: bar });

// After:
safePostMessage(panel, { type: 'foo', data: bar });
```

**Step 2: Verify no raw postMessage calls remain**

Run: `grep -n "panel\.webview\.postMessage" src/writerView/manager.ts`
Expected: Zero matches.

Run: `grep -c "safePostMessage" src/writerView/manager.ts`
Expected: ~34 matches (13 existing + 21 converted).

**Step 3: Compile**

Run: `npm run compile`
Expected: Clean build, no errors.

**Step 4: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix(writerView): use safePostMessage for all panel.webview.postMessage calls"
```

---

### Task 2: Fix `isPathWithinWorkspace` — static import and path.relative

**Files:**
- Modify: `src/writerView/utils/helpers.ts`

**Context:** Two issues with the current implementation:
1. Uses `require('path')` instead of a static `import * as path from 'path'` (inconsistent with codebase conventions, worse for type inference)
2. Uses case-sensitive `startsWith` comparison which may fail on macOS case-insensitive APFS. The `path.relative()` approach used elsewhere in the codebase is more robust.

**Step 1: Add static path import and rewrite function**

```typescript
// At top of file (line 5, after crypto import):
import * as path from 'path';

// Replace isPathWithinWorkspace:
export function isPathWithinWorkspace(targetPath: string, workspaceRoot: string): boolean {
  if (!workspaceRoot) {
    return false;
  }
  const resolved = path.resolve(workspaceRoot, targetPath.replace(/^\//, ''));
  const relative = path.relative(workspaceRoot, resolved);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
```

**Step 2: Compile**

Run: `npm run compile`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/writerView/utils/helpers.ts
git commit -m "fix(writerView): use static import and path.relative in isPathWithinWorkspace"
```

---

### Task 3: Validate `message.field` and `message.newType` in `save` handler

**Files:**
- Modify: `src/writerView/manager.ts` (two `save` handlers — one in `openWriterView` ~line 391, one in `openWriterViewForField` ~line 811)

**Context:** The `save` handler validates `message.text` as a string but uses `message.field` and `message.newType` without validation. If a non-string truthy value arrives, it would be passed through to downstream functions. Add type coercion to be consistent with the validation pattern used on all other handlers.

**Step 1: Add validation to both save handlers**

In both `openWriterView` and `openWriterViewForField` message handlers, update the `save` case:

```typescript
case 'save': {
    if (typeof message.text !== 'string') { return; }
    const fieldToSave = (typeof message.field === 'string') ? message.field : currentField;
    const typeToSave = (typeof message.newType === 'string') ? message.newType : currentType;
    // ... rest unchanged
```

**Step 2: Compile**

Run: `npm run compile`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix(writerView): validate message.field and message.newType in save handler"
```

---

### Task 4: Remove dead `highlightMatches` stub from searchUI.ts

**Files:**
- Modify: `src/search/searchUI.ts`

**Context:** The `highlightMatches` function was reduced to a no-op (`return text`) in a prior commit because QuickPick doesn't render inline markdown. The function and its call site should be removed entirely rather than leaving dead code.

**Step 1: Remove function and inline the call**

In `formatResultItem` (~line 252), replace:
```typescript
const highlightedName = highlightMatches(result.name, query);
```
with:
```typescript
const highlightedName = result.name;
```

Then delete the entire `highlightMatches` function (lines 293-299).

Since `query` parameter is no longer used in `formatResultItem`, also remove it:

```typescript
// Before:
function formatResultItem(result: SearchResult, query: string): SearchResultItem {

// After:
function formatResultItem(result: SearchResult): SearchResultItem {
```

And update the 3 call sites in `formatResults` (~lines 216, 225, 234):
```typescript
// Before:
items.push(...titleResults.map(r => formatResultItem(r, query)));

// After:
items.push(...titleResults.map(r => formatResultItem(r)));
```

Since `query` is no longer used in `formatResults` either, remove that parameter too:
```typescript
// Before:
function formatResults(results: SearchResult[], query: string): SearchResultItem[]

// After:
function formatResults(results: SearchResult[]): SearchResultItem[]
```

And update the call site (~line 116):
```typescript
// Before:
quickPick.items = formatResults(results, value);

// After:
quickPick.items = formatResults(results);
```

**Step 2: Compile**

Run: `npm run compile`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/search/searchUI.ts
git commit -m "refactor(search): remove dead highlightMatches stub and unused query params"
```
