# VS Code Extension Nested Index Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update VS Code extension's nested index handling to match web app's robust implementation, ensuring consistent behavior across platforms.

**Architecture:** Enhance `indexParser.ts` with hidden index detection, JSON parsing support, circular reference prevention, and correct path computation using directory names. Rename `_included_from` to `_subindex_path` for field name consistency with web app.

**Tech Stack:** TypeScript, VS Code Extension API, YAML parser, Node.js fs/path modules

---

## Background

The web app's `index_parser.py` now has a more robust nested index implementation than the VS Code extension. This plan brings the VS Code extension up to parity.

**Current Gaps:**
| Feature | VS Code | Web App | Status |
|---------|---------|---------|--------|
| Hidden index files (`.index.*`) | ❌ | ✅ | Gap |
| JSON parsing | ❌ | ✅ | Gap |
| Circular reference prevention | ❌ | ✅ | Gap |
| Directory name for paths | ❌ | ✅ | Gap |
| Marker field name | `_included_from` | `_subindex_path` | Inconsistent |

**Critical Files:**
- Modify: `/Users/phong/Projects/chapterwise-codex/src/indexParser.ts`

---

## Task 1: Add Hidden Index File Detection

**Files:**
- Modify: `src/indexParser.ts` (lines 248-250)

**Step 1: Update isSubIndexInclude function**

Current code:
```typescript
export function isSubIndexInclude(includePath: string): boolean {
  return includePath.endsWith('index.codex.yaml') || includePath.endsWith('index.codex.json');
}
```

Replace with:
```typescript
/**
 * Check if an include points to a sub-index file.
 * Supports both visible and hidden variants:
 * - index.codex.yaml (committed YAML)
 * - .index.codex.yaml (hidden cache YAML)
 * - index.codex.json (committed JSON)
 * - .index.codex.json (hidden cache JSON)
 */
export function isSubIndexInclude(includePath: string): boolean {
  const fileName = path.basename(includePath);
  return (
    fileName === 'index.codex.yaml' ||
    fileName === '.index.codex.yaml' ||
    fileName === 'index.codex.json' ||
    fileName === '.index.codex.json'
  );
}
```

**Step 2: Verify compile succeeds**

Run: `npm run compile:tsc`
Expected: No errors

**Step 3: Commit**

```bash
git add src/indexParser.ts
git commit -m "feat(parser): add hidden index file detection

Support .index.codex.yaml and .index.codex.json in isSubIndexInclude()
to match web app behavior.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add JSON Parsing Support

**Files:**
- Modify: `src/indexParser.ts` (lines 271-274)

**Step 1: Update sub-index loading to handle JSON**

Find this code in `resolveSubIndexIncludes`:
```typescript
const subContent = fs.readFileSync(subIndexPath, 'utf-8');
const subData = YAML.parse(subContent);
```

Replace with:
```typescript
const subContent = fs.readFileSync(subIndexPath, 'utf-8');
let subData: any;

if (subIndexPath.endsWith('.json')) {
  subData = JSON.parse(subContent);
} else {
  subData = YAML.parse(subContent);
}
```

**Step 2: Verify compile succeeds**

Run: `npm run compile:tsc`
Expected: No errors

**Step 3: Commit**

```bash
git add src/indexParser.ts
git commit -m "feat(parser): add JSON parsing support for sub-indexes

Handle both YAML and JSON sub-index files in resolveSubIndexIncludes()
to match web app behavior.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Circular Reference Prevention

**Files:**
- Modify: `src/indexParser.ts` (lines 260-341, 351-364)

**Step 1: Update resolveSubIndexIncludes signature**

Find the function signature:
```typescript
export function resolveSubIndexIncludes(children: any[], parentDir: string): IndexChildNode[] {
```

Replace with:
```typescript
export function resolveSubIndexIncludes(
  children: any[],
  parentDir: string,
  parsedIndexes: Set<string> = new Set()
): IndexChildNode[] {
```

**Step 2: Add circular reference check in sub-index loading**

Find this code:
```typescript
if (isSubIndexInclude(includePath)) {
  // Load and merge sub-index
  const subIndexPath = path.resolve(parentDir, includePath);

  if (fs.existsSync(subIndexPath)) {
```

Replace with:
```typescript
if (isSubIndexInclude(includePath)) {
  // Load and merge sub-index
  const subIndexPath = path.resolve(parentDir, includePath);
  const normalizedPath = path.normalize(subIndexPath);

  // Circular reference check
  if (parsedIndexes.has(normalizedPath)) {
    console.warn(`[IndexParser] Circular sub-index reference detected: ${subIndexPath}`);
    continue;
  }

  if (fs.existsSync(subIndexPath)) {
    // Add to parsed set before parsing (prevent infinite recursion)
    parsedIndexes.add(normalizedPath);
```

**Step 3: Update recursive call to pass parsedIndexes**

Find:
```typescript
subNode.children = resolveSubIndexIncludes(
  subData.children,
  path.dirname(subIndexPath)
);
```

Replace with:
```typescript
subNode.children = resolveSubIndexIncludes(
  subData.children,
  path.dirname(subIndexPath),
  parsedIndexes
);
```

**Step 4: Update regular node recursive call**

Find:
```typescript
node.children = resolveSubIndexIncludes(child.children, childDir);
```

Replace with:
```typescript
node.children = resolveSubIndexIncludes(child.children, childDir, parsedIndexes);
```

**Step 5: Update parseIndexFileWithIncludes to initialize parsedIndexes**

Find:
```typescript
export function parseIndexFileWithIncludes(
  content: string,
  indexDir: string
): IndexDocument | null {
  const doc = parseIndexFile(content);
  if (!doc) {return null;}

  // Resolve any include directives in children
  if (doc.children && Array.isArray(doc.children)) {
    doc.children = resolveSubIndexIncludes(doc.children, indexDir);
  }

  return doc;
}
```

Replace with:
```typescript
export function parseIndexFileWithIncludes(
  content: string,
  indexDir: string,
  indexPath?: string
): IndexDocument | null {
  const doc = parseIndexFile(content);
  if (!doc) {return null;}

  // Initialize parsed indexes set with current index
  const parsedIndexes = new Set<string>();
  if (indexPath) {
    parsedIndexes.add(path.normalize(indexPath));
  }

  // Resolve any include directives in children
  if (doc.children && Array.isArray(doc.children)) {
    doc.children = resolveSubIndexIncludes(doc.children, indexDir, parsedIndexes);
  }

  return doc;
}
```

**Step 6: Verify compile succeeds**

Run: `npm run compile:tsc`
Expected: No errors

**Step 7: Commit**

```bash
git add src/indexParser.ts
git commit -m "feat(parser): add circular reference prevention

Track parsed index paths in a Set to prevent infinite recursion when
sub-indexes reference each other. Matches web app behavior.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Fix Path Computation with Directory Name

**Files:**
- Modify: `src/indexParser.ts` (lines 278-283)

**Step 1: Set _filename to directory name**

Find this code:
```typescript
// Merge sub-index as a node
const subNode: IndexChildNode = {
  id: subData.id || path.basename(path.dirname(subIndexPath)),
  type: subData.type || 'folder',
  name: subData.name || path.basename(path.dirname(subIndexPath)),
  _included_from: includePath,
};
```

Replace with:
```typescript
// Get directory name for correct path computation
const dirName = path.basename(path.dirname(subIndexPath));

// Merge sub-index as a node
const subNode: IndexChildNode = {
  id: subData.id || dirName,
  type: subData.type || 'folder',
  name: subData.name || dirName,
  // IMPORTANT: Set _filename to directory name for correct path computation
  // This ensures paths like "book-1/chapters/..." instead of "Book One/chapters/..."
  _filename: dirName,
  _subindex_path: subIndexPath, // Renamed from _included_from for web app parity
};
```

**Step 2: Verify compile succeeds**

Run: `npm run compile:tsc`
Expected: No errors

**Step 3: Commit**

```bash
git add src/indexParser.ts
git commit -m "feat(parser): fix path computation using directory name

Set _filename to actual directory name (e.g., 'book-1') instead of
relying on display name (e.g., 'Book One') for correct path computation.

Also rename _included_from to _subindex_path for web app consistency.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Rename _included_from to _subindex_path Throughout

**Files:**
- Modify: `src/indexParser.ts`

**Step 1: Update IndexChildNode interface**

Find:
```typescript
_included_from?: string; // V2: Path this node was included from (for tracking)
```

Replace with:
```typescript
_subindex_path?: string; // V2: Absolute path to the sub-index file this node was expanded from
```

**Step 2: Update regular file include**

Find (in regular file include section):
```typescript
_included_from: includePath,
```

Replace with:
```typescript
_subindex_path: path.resolve(parentDir, includePath),
```

**Step 3: Verify compile succeeds**

Run: `npm run compile:tsc`
Expected: No errors

**Step 4: Commit**

```bash
git add src/indexParser.ts
git commit -m "refactor(parser): rename _included_from to _subindex_path

Align field naming with web app's index_parser.py for consistency.
The field now stores absolute path to sub-index file.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update isIndexFile to Match isSubIndexInclude

**Files:**
- Modify: `src/indexParser.ts` (lines 168-176)

**Step 1: Verify isIndexFile already includes all variants**

Check that `isIndexFile` matches `isSubIndexInclude`:

Current code (should already be correct):
```typescript
export function isIndexFile(fileName: string): boolean {
  const base = path.basename(fileName);
  return (
    base === 'index.codex.yaml' ||
    base === '.index.codex.yaml' ||
    base === 'index.codex.json' ||
    base === '.index.codex.json'
  );
}
```

If correct, no changes needed. If missing variants, add them.

**Step 2: Verify compile succeeds**

Run: `npm run compile:tsc`
Expected: No errors

**Step 3: Commit (if changes made)**

```bash
git add src/indexParser.ts
git commit -m "fix(parser): ensure isIndexFile matches isSubIndexInclude variants

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update Callers of parseIndexFileWithIncludes

**Files:**
- Search for callers in `src/` directory

**Step 1: Find all callers**

Run: `grep -rn "parseIndexFileWithIncludes" src/`

**Step 2: Update each caller to pass indexPath**

For each caller, add the third `indexPath` parameter:

Before:
```typescript
parseIndexFileWithIncludes(content, indexDir)
```

After:
```typescript
parseIndexFileWithIncludes(content, indexDir, indexPath)
```

**Step 3: Verify compile succeeds**

Run: `npm run compile:tsc`
Expected: No errors

**Step 4: Commit**

```bash
git add src/
git commit -m "fix(parser): update callers to pass indexPath for circular detection

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Final Verification

**Step 1: Full compile check**

Run: `npm run compile:tsc`
Expected: No errors

**Step 2: Lint check**

Run: `npm run lint`
Expected: No errors (or only pre-existing ones)

**Step 3: Package build**

Run: `npm run compile`
Expected: Successful build

**Step 4: Final commit**

```bash
git add .
git commit -m "feat(parser): complete nested index parity with web app

VS Code extension now matches web app's index_parser.py:
- Hidden index file detection (.index.codex.yaml, .index.codex.json)
- JSON parsing support
- Circular reference prevention
- Directory name for path computation
- Consistent _subindex_path field naming

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `isSubIndexInclude()` detects all 4 variants (yaml/json, visible/hidden)
- [ ] JSON sub-indexes parse correctly
- [ ] Circular references logged and skipped (no infinite loop)
- [ ] `_filename` set to directory name for correct paths
- [ ] `_subindex_path` field used consistently (not `_included_from`)
- [ ] TypeScript compiles without errors
- [ ] Extension packages successfully

---

## Completion Criteria

- [ ] All 8 tasks completed
- [ ] All compilation checks pass
- [ ] Field naming matches web app (`_subindex_path`)
- [ ] Behavior matches web app for all edge cases
