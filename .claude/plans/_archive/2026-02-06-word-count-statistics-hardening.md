# Word Count & Statistics (#34) Hardening Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the Word Count & Statistics system against path traversal, symlink attacks, stack overflows, sync I/O blocking, and information disclosure.

**Architecture:** The word count system has two parts: (1) `WordCounter` class in `wordCount.ts` that recursively traverses codex files updating `word_count` attributes, and (2) real-time stats in `writerView/utils/stats.ts` + `manager.ts` for the Writer View status bar. The Writer View stats are already hardened (#22). This plan focuses on `wordCount.ts`.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js `fs.promises`, `path`, YAML library

---

### Task 1: Add path traversal prevention for include directives

**Files:**
- Modify: `src/wordCount.ts:81-147` (updateWordCountInObject)
- Modify: `src/wordCount.ts:152-193` (processIncludedFile)

**Context:** Include paths from user-controlled YAML data are resolved against `parentDir` with no workspace boundary check. A malicious `include: "../../../../etc/passwd"` would be read and processed. Same bug class fixed in #22, #25, #26, #30.

**Step 1: Add workspace root parameter and boundary validation**

Add `workspaceRoot` as a class property, set it in `updateWordCounts()`. In `updateWordCountInObject()`, validate all resolved include paths stay within workspace root before processing.

```typescript
// Add to class properties (after line 42):
private workspaceRoot: string = '';

// Add helper (after countWords method):
private isPathWithinRoot(resolvedPath: string): boolean {
  const normalizedResolved = path.resolve(resolvedPath);
  const normalizedRoot = path.resolve(this.workspaceRoot);
  return normalizedResolved.startsWith(normalizedRoot + path.sep) || normalizedResolved === normalizedRoot;
}
```

In `updateWordCountInObject()`, after resolving `fullPath` (line 127), add:

```typescript
// Validate path stays within workspace
if (!this.isPathWithinRoot(fullPath)) {
  this.errors.push(`Include path escapes workspace boundary: ${path.basename(fullPath)}`);
  continue;
}
```

In `updateWordCounts()`, set workspace root from document URI:

```typescript
// After line 325 (inputPath):
const workspaceFolders = vscode.workspace.workspaceFolders;
if (workspaceFolders) {
  this.workspaceRoot = workspaceFolders[0].uri.fsPath;
} else {
  this.workspaceRoot = path.dirname(inputPath);
}
```

**Step 2: Compile and verify**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/wordCount.ts
git commit -m "fix(word-count): add path traversal prevention for include directives"
```

---

### Task 2: Add symlink protection for included files

**Files:**
- Modify: `src/wordCount.ts:152-193` (processIncludedFile)

**Context:** `processIncludedFile()` follows symlinks without checking, potentially reading files outside the workspace. Same pattern fixed in #25, #26.

**Step 1: Add symlink check before reading include files**

In `processIncludedFile()`, after the `existsSync` check (line 156), add:

```typescript
// Reject symlinks
try {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    this.errors.push(`Skipping symlink include: ${path.basename(filePath)}`);
    return;
  }
} catch {
  this.errors.push(`Cannot stat include file: ${path.basename(filePath)}`);
  return;
}
```

**Step 2: Compile and verify**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/wordCount.ts
git commit -m "fix(word-count): reject symlinked include files"
```

---

### Task 3: Add recursion depth limit

**Files:**
- Modify: `src/wordCount.ts:81-147` (updateWordCountInObject)
- Modify: `src/wordCount.ts:198-232` (writeCodexFile/setBlockStyle)

**Context:** `updateWordCountInObject()` recurses through children with no depth limit. A deeply nested file causes stack overflow. Other systems use `MAX_SUB_INDEX_DEPTH=8`.

**Step 1: Add depth limit constant and parameter**

```typescript
// Add after imports (around line 14):
const MAX_RECURSION_DEPTH = 50;
```

Update `updateWordCountInObject` signature to accept `depth` parameter:

```typescript
private updateWordCountInObject(
  obj: Record<string, unknown>,
  parentDir: string,
  options: WordCountOptions,
  depth: number = 0
): boolean {
  if (depth > MAX_RECURSION_DEPTH) {
    this.errors.push(`Maximum recursion depth (${MAX_RECURSION_DEPTH}) exceeded — skipping deeper children`);
    return false;
  }
```

Pass `depth + 1` in recursive calls (line 135):

```typescript
const childModified = this.updateWordCountInObject(
  child as Record<string, unknown>,
  parentDir,
  options,
  depth + 1
);
```

Also add depth guard to `setBlockStyle` in `writeCodexFile` (line 207):

```typescript
const setBlockStyle = (node: unknown, depth: number = 0): void => {
  if (depth > MAX_RECURSION_DEPTH) { return; }
  // ... existing logic, pass depth + 1 to recursive calls
```

**Step 2: Compile and verify**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/wordCount.ts
git commit -m "fix(word-count): add recursion depth limit to prevent stack overflow"
```

---

### Task 4: Convert synchronous I/O to async

**Files:**
- Modify: `src/wordCount.ts` (multiple methods)

**Context:** 6 calls to `readFileSync`/`writeFileSync` block the VS Code extension host. The entry point `updateWordCounts()` is already async. Same fix applied in #22, #30.

**Step 1: Add fs.promises import**

```typescript
// Change existing import:
import * as fs from 'fs';
// Add:
const fsPromises = fs.promises;
```

**Step 2: Convert processIncludedFile to async**

Change signature to `private async processIncludedFile(...)`.

Replace:
- `fs.existsSync(filePath)` → use try/catch around `await fsPromises.access(filePath)`
- `fs.readFileSync(filePath, 'utf-8')` → `await fsPromises.readFile(filePath, 'utf-8')`
- `fs.lstatSync(filePath)` → `await fsPromises.lstat(filePath)`

Update caller in `updateWordCountInObject` — since this method is not async, collect include paths and process them after. Alternative: make `updateWordCountInObject` async too.

**Recommended approach:** Make `updateWordCountInObject` async, `await` the include processing.

```typescript
private async updateWordCountInObject(
  obj: Record<string, unknown>,
  parentDir: string,
  options: WordCountOptions,
  depth: number = 0
): Promise<boolean> {
```

Update all callers to await.

**Step 3: Convert writeCodexFile to async**

Replace `fs.writeFileSync` with `await fsPromises.writeFile`. Change signature to async.

**Step 4: Convert updateWordCountInMarkdown to async**

Replace `fs.readFileSync` and `fs.writeFileSync` with async equivalents.

**Step 5: Convert updateWordCounts**

Replace `fs.readFileSync` at line 352 with `await fsPromises.readFile`.
Replace `fs.existsSync` at line 326 with `await fsPromises.access` in try/catch.

**Step 6: Compile and verify**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors

**Step 7: Commit**

```bash
git add src/wordCount.ts
git commit -m "perf(word-count): convert all sync I/O to async fs.promises"
```

---

### Task 5: Sanitize error messages (remove internal path exposure)

**Files:**
- Modify: `src/wordCount.ts` (error strings throughout)

**Context:** Error messages expose full file system paths to users via `showErrorMessage`. Same issue fixed in #22.

**Step 1: Use basename in user-facing errors, full paths only in output channel**

Replace internal path exposure in error push calls:

```typescript
// Before (line 157):
this.errors.push(`Include file not found: ${filePath}`);
// After:
this.errors.push(`Include file not found: ${path.basename(filePath)}`);

// Before (line 166):
this.errors.push(`Include is not a valid codex file: ${filePath}`);
// After:
this.errors.push(`Include is not a valid codex file: ${path.basename(filePath)}`);

// Before (line 191):
this.errors.push(`Failed to process include "${filePath}": ${e}`);
// After:
this.errors.push(`Failed to process include "${path.basename(filePath)}"`);

// Before (line 305):
this.errors.push(`Failed to update markdown file "${filePath}": ${e}`);
// After:
this.errors.push(`Failed to update markdown file "${path.basename(filePath)}"`);
```

In `runUpdateWordCount` (line 585-587), the first error is shown to the user — these are now sanitized.

The output channel (line 540) can keep the full path since it's developer-facing (shown only on "Show Details").

**Step 2: Compile and verify**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/wordCount.ts
git commit -m "fix(word-count): sanitize error messages to hide internal paths"
```

---

### Task 6: Add atomic writes for file safety

**Files:**
- Modify: `src/wordCount.ts` (writeCodexFile, updateWordCountInMarkdown)

**Context:** Direct `writeFile` can corrupt files on crash. Write to temp file then rename for atomicity.

**Step 1: Update writeCodexFile to use atomic write pattern**

```typescript
private async writeCodexFile(
  filePath: string,
  data: Record<string, unknown>,
  format: 'yaml' | 'json'
): Promise<void> {
  const tmpPath = filePath + '.tmp';
  try {
    let content: string;
    if (format === 'yaml') {
      const doc = new YAML.Document(data);
      // ... setBlockStyle logic ...
      content = doc.toString({ lineWidth: 120 });
    } else {
      content = JSON.stringify(data, null, 2);
    }
    await fsPromises.writeFile(tmpPath, content, 'utf-8');
    await fsPromises.rename(tmpPath, filePath);
  } catch (e) {
    // Clean up temp file on failure
    try { await fsPromises.unlink(tmpPath); } catch { /* ignore */ }
    throw e;
  }
}
```

Apply same pattern to the markdown write in `updateWordCountInMarkdown`.

**Step 2: Compile and verify**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/wordCount.ts
git commit -m "fix(word-count): use atomic writes to prevent file corruption"
```

---

### Task 7: Final verification and cleanup

**Files:**
- Verify: `src/wordCount.ts`

**Step 1: Full TypeScript compilation check**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors (pre-existing Thenable errors on lines 152/159 of extension.ts are OK)

**Step 2: Verify no remaining sync I/O**

Search for `readFileSync`, `writeFileSync`, `existsSync`, `lstatSync` in `src/wordCount.ts` — should find none.

**Step 3: Verify no remaining raw path exposure in errors**

Search for `filePath}` patterns in error strings — should all use `path.basename(filePath)`.

**Step 4: Final commit if any cleanup needed**

```bash
git add src/wordCount.ts
git commit -m "chore(word-count): final cleanup after hardening"
```

---

## Summary of Changes

| Issue | Severity | Fix |
|-------|----------|-----|
| Path traversal via includes | Critical | Workspace boundary validation |
| Symlink following | High | lstat check before reading |
| Unbounded recursion | High | MAX_RECURSION_DEPTH=50 |
| Sync I/O blocking | High | Convert to fs.promises |
| Path disclosure in errors | High | Use basename in user-facing messages |
| Non-atomic writes | Medium | Write-to-temp-then-rename |

## Out of Scope (deferred)
- Writer View stats (`stats.ts`, `manager.ts`) — already hardened in #22
- `autoFixer.ts` countWords — will be addressed in #24 (already marked complete) or #44
