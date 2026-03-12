# File Organizer Hardening Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the file organizer with path traversal prevention, async I/O, regex injection fix, secure UUID, and TOCTOU mitigation.

**Architecture:** The FileOrganizer is a singleton class that creates files according to three strategies (organized, data-folder, flat). All file paths are generated from user input (node names) and settings. We add workspace boundary validation after path generation, convert sync I/O to async, escape regex inputs, and replace Math.random UUID.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js fs.promises

---

## Summary of Changes

| Category | Changes |
|----------|---------|
| Security | Path traversal prevention with `isPathWithinRoot()`, strip `..` in slugify |
| Security | Secure UUID via `crypto.randomUUID()` replacing `Math.random()` |
| Security | Escape regex special chars in separator and prefix before `new RegExp()` |
| Performance | Convert all `fs.*Sync` calls to `fs.promises` async equivalents |
| Robustness | TOCTOU mitigation: use `writeFile` with `wx` flag (exclusive create) |
| Code Quality | Remove unused `vscode` import usage from `FileCreationResult.fileUri` return |

---

### Task 1: Add Path Traversal Prevention and Secure UUID

**Files:**
- Modify: `src/fileOrganizer.ts`

**Step 1: Add imports and helpers at top of file**

After the existing imports (line 15), add:

```typescript
import * as crypto from 'crypto';

const fsPromises = fs.promises;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPathWithinRoot(resolvedPath: string, rootPath: string): boolean {
  const normalizedResolved = path.resolve(resolvedPath);
  const normalizedRoot = path.resolve(rootPath);
  return normalizedResolved.startsWith(normalizedRoot + path.sep) || normalizedResolved === normalizedRoot;
}
```

**Step 2: Add path validation in `createNodeFile` after fullPath is computed**

After `const fullPath = path.join(workspaceRoot, filePath);` (line 55), add:

```typescript
// Validate generated path stays within workspace
if (!isPathWithinRoot(fullPath, workspaceRoot)) {
  return {
    success: false,
    message: 'Generated file path escapes workspace boundary'
  };
}
```

**Step 3: Add `..` stripping in `slugifyName`**

In the `slugifyName` method, after `slug = slug.replace(/[^a-zA-Z0-9-]/g, '');` (line 260), add:

```typescript
// Strip path traversal sequences
slug = slug.replace(/\.\./g, '');
```

**Step 4: Replace Math.random UUID with crypto.randomUUID()**

Replace the `generateUuid` method (lines 276-282) with:

```typescript
private generateUuid(): string {
  return crypto.randomUUID();
}
```

**Step 5: Verify compilation**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors (only pre-existing extension.ts/treeProvider.ts errors)

**Step 6: Commit**

```bash
git add src/fileOrganizer.ts
git commit -m "fix(file-organizer): add path traversal prevention and secure UUID"
```

---

### Task 2: Convert Sync I/O to Async and Fix TOCTOU

**Files:**
- Modify: `src/fileOrganizer.ts`

**Step 1: Convert `createNodeFile` to async I/O with TOCTOU fix**

Replace the check-then-write block (lines 57-73) with:

```typescript
// Create directory if needed
const dir = path.dirname(fullPath);
await fsPromises.mkdir(dir, { recursive: true });

// Create file with exclusive flag (TOCTOU-safe: fails if file already exists)
const content = this.generateInitialContent(nodeData, settings);
try {
  await fsPromises.writeFile(fullPath, content, { encoding: 'utf-8', flag: 'wx' });
} catch (err: any) {
  if (err.code === 'EEXIST') {
    return {
      success: false,
      message: `File already exists: ${path.basename(filePath)}`
    };
  }
  throw err;
}
```

This removes the `existsSync` + `writeFileSync` TOCTOU race and replaces it with an atomic exclusive-create.

**Step 2: Convert `getNextAvailableNumber` to async**

Change the method signature and body:

```typescript
async getNextAvailableNumber(
  directoryPath: string,
  prefix: string
): Promise<number> {
  try {
    if (!await fileExists(directoryPath)) {
      return 1;
    }

    const files = await fsPromises.readdir(directoryPath);
    const numbers: number[] = [];

    // Escape prefix for safe regex construction
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedPrefix}-(\\d+)`, 'i');
    for (const file of files) {
      const match = file.match(pattern);
      if (match) {
        numbers.push(parseInt(match[1], 10));
      }
    }

    if (numbers.length === 0) {
      return 1;
    }

    return Math.max(...numbers) + 1;
  } catch (error) {
    return 1;
  }
}
```

This also fixes the regex injection via unescaped prefix (Step 2 includes that fix).

**Step 3: Verify compilation**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/fileOrganizer.ts
git commit -m "fix(file-organizer): convert sync I/O to async and fix TOCTOU race"
```

---

### Task 3: Fix Regex Injection in slugifyName

**Files:**
- Modify: `src/fileOrganizer.ts`

**Step 1: Escape separator before regex construction**

In `slugifyName`, replace the regex construction for separator patterns (lines 263-268) with:

```typescript
// Escape separator for safe regex construction
const escapedSep = namingSettings.separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Remove leading/trailing separators
const separatorPattern = new RegExp(`^${escapedSep}+|${escapedSep}+$`, 'g');
slug = slug.replace(separatorPattern, '');

// Collapse multiple separators
const multiSeparatorPattern = new RegExp(`${escapedSep}+`, 'g');
slug = slug.replace(multiSeparatorPattern, namingSettings.separator);
```

**Step 2: Verify compilation**

Run: `cd /Users/phong/Projects/chapterwise-codex && npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/fileOrganizer.ts
git commit -m "fix(file-organizer): escape separator in regex to prevent injection"
```

---

### Task 4: Update META-DEV-PROMPT

**Files:**
- Modify: `/Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md`

**Step 1: Mark #30 as complete in the status table**

Change:
```
| 30 | File Organizer | ⬜ | 7 | | | Strategies, naming conventions |
```
To:
```
| 30 | File Organizer | ✅ | 7 | <commit> | 2026-02-05 | Path traversal fix, async I/O, TOCTOU fix, regex escape, secure UUID |
```

**Step 2: Add decision log entry**

Add after the Drag & Drop decision log entry:

```markdown
### 2026-02-05 - File Organizer Hardening (#30) [chapterwise-codex]
Decision: Comprehensive security hardening for file creation pipeline
Changes:
- Path traversal prevention: isPathWithinRoot() validates all generated paths stay within workspace
- Path traversal in slugify: strip ".." sequences from slugified names
- Secure UUID: replace Math.random() with crypto.randomUUID()
- Async I/O: convert all fs.*Sync calls to fs.promises equivalents
- TOCTOU fix: use writeFile with 'wx' exclusive flag instead of existsSync + writeFileSync
- Regex injection fix: escape separator and prefix before RegExp construction
```

**Step 3: Commit**

```bash
git add dev/META-DEV-PROMPT.md
git commit -m "docs: mark File Organizer (#30) as complete in META-DEV-PROMPT"
```
