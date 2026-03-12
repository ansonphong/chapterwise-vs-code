# Writer View Remaining Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 7 remaining hardening issues in the Writer View system not covered by the user's in-progress fixes (message validation, nonce, image path validation, YAML type safety, disposed panel safety, word count).

**Architecture:** Targeted fixes to existing files - no new files or structural changes. All changes are in `src/writerView/manager.ts`, `src/writerView/script.ts`, and `src/writerView/html/builder.ts`.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js `fs.promises`

**Verification:** `npm run compile` after each task (no test framework in this repo).

---

## Issue Tracker

| # | Severity | Issue | File | Lines |
|---|----------|-------|------|-------|
| 1 | High | innerHTML XSS in renderWorkspaceImages | `script.ts` | 1614-1620 |
| 2 | High | innerHTML XSS in updateImagesGallery | `script.ts` | 1694-1700 |
| 3 | High | CSP missing img-src directive | `builder.ts` | 77 |
| 4 | High | Synchronous file I/O blocks extension host | `manager.ts` | 10 readFileSync, 5 writeFileSync |
| 5 | High | Auto-save race condition | `script.ts` | 247 |
| 6 | Medium | Error info disclosure | `manager.ts` | 12+ locations |
| 7 | Medium | resolveImageUrlForWebview path traversal | `manager.ts` | 178-197 |
| 8 | Medium | parseInt without NaN guards | `script.ts` | 13 locations |

---

### Task 1: Fix innerHTML XSS in renderWorkspaceImages and updateImagesGallery

**Files:**
- Modify: `src/writerView/script.ts:1614-1620` (renderWorkspaceImages)
- Modify: `src/writerView/script.ts:1694-1700` (updateImagesGallery)

**Context:** Both functions build innerHTML from data that originates from file system paths. File/folder names containing `<`, `"`, or `'` could inject HTML. An `escapeHtml()` function already exists in the webview script at ~line 440.

**Step 1: Escape interpolated values in renderWorkspaceImages**

At `script.ts` ~line 1614, change:

```javascript
imageBrowserGrid.innerHTML = images.map(img => \`
  <div class="browser-image-item" data-path="\${img.path}" title="\${img.path}">
    <img src="\${img.thumbnail}" alt="\${img.filename}" loading="lazy" />
    <div class="browser-image-name">\${img.filename}</div>
    <div class="browser-image-folder">\${img.folder}</div>
  </div>
\`).join('');
```

To:

```javascript
imageBrowserGrid.innerHTML = images.map(img => \`
  <div class="browser-image-item" data-path="\${escapeHtml(img.path)}" title="\${escapeHtml(img.path)}">
    <img src="\${img.thumbnail}" alt="\${escapeHtml(img.filename)}" loading="lazy" />
    <div class="browser-image-name">\${escapeHtml(img.filename)}</div>
    <div class="browser-image-folder">\${escapeHtml(img.folder)}</div>
  </div>
\`).join('');
```

Note: `img.thumbnail` is a webview URI from `asWebviewUri()` - safe for `src` attribute.

**Step 2: Escape interpolated values in updateImagesGallery**

At `script.ts` ~line 1694, change:

```javascript
imagesContainer.innerHTML = \`<div class="images-grid">\${localImages.map((img, index) => \`
  <div class="image-thumbnail" data-index="\${index}" data-url="\${img.url}" tabindex="0" role="button" aria-label="View image \${index + 1}\${img.caption ? ': ' + escapeHtml(img.caption) : ''}">
    \${img.featured ? '<span class="featured-badge">★</span>' : ''}
    <img src="\${img.url}" alt="\${img.alt || img.caption || 'Image'}" loading="lazy" />
    <div class="thumbnail-caption" title="\${img.caption || ''}">\${img.caption || '&nbsp;'}</div>
  </div>
\`).join('')}</div>\`;
```

To:

```javascript
imagesContainer.innerHTML = \`<div class="images-grid">\${localImages.map((img, index) => \`
  <div class="image-thumbnail" data-index="\${index}" data-url="\${escapeHtml(img.url)}" tabindex="0" role="button" aria-label="View image \${index + 1}\${img.caption ? ': ' + escapeHtml(img.caption) : ''}">
    \${img.featured ? '<span class="featured-badge">★</span>' : ''}
    <img src="\${img.url}" alt="\${escapeHtml(img.alt || img.caption || 'Image')}" loading="lazy" />
    <div class="thumbnail-caption" title="\${escapeHtml(img.caption || '')}">\${escapeHtml(img.caption || '') || '&nbsp;'}</div>
  </div>
\`).join('')}</div>\`;
```

Changes: `data-url` escaped, `alt` escaped, `title` escaped, caption text escaped. `src` left as-is (pre-resolved webview URI).

**Step 3: Verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/script.ts
git commit -m "fix(security): escape HTML in image rendering innerHTML

renderWorkspaceImages: escape img.path, img.filename, img.folder
updateImagesGallery: escape img.url, img.alt, img.caption in attributes/text"
```

---

### Task 2: Add img-src to CSP

**Files:**
- Modify: `src/writerView/html/builder.ts:77`

**Context:** The CSP has no `img-src` directive, meaning images can load from any external domain. Need to restrict to webview resources and data URIs.

**Step 1: Add img-src directive**

At `builder.ts` line 77, change:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
```

To:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
```

**Step 2: Verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/html/builder.ts
git commit -m "fix(security): add img-src directive to WebView CSP

Restricts image loading to webview resources and data: URIs.
Prevents loading images from arbitrary external domains."
```

---

### Task 3: Replace synchronous file I/O with async

**Files:**
- Modify: `src/writerView/manager.ts` (10 `readFileSync` + 5 `writeFileSync` calls)

**Context:** `fs.readFileSync` and `fs.writeFileSync` block the VS Code extension host thread. The file already imports `const fsPromises = fs.promises;` at line 8. All call sites are inside `async` functions, so switching to `await` is straightforward.

**Step 1: Convert readFileSync at line 234 (openWriterView)**

Change:
```typescript
const text = fs.readFileSync(fileName, 'utf-8');
```
To:
```typescript
const text = await fsPromises.readFile(fileName, 'utf-8');
```

**Step 2: Convert readFileSync at line 448 (switchField handler in openWriterView)**

Same pattern as Step 1.

**Step 3: Convert readFileSync at line 480 (requestContent handler in openWriterView)**

Same pattern.

**Step 4: Convert readFileSync at line 528 + writeFileSync at line 560 (updateImageCaption in openWriterView)**

Change both:
```typescript
const text = fs.readFileSync(documentUri.fsPath, 'utf-8');
// ...
fs.writeFileSync(documentUri.fsPath, doc.toString());
```
To:
```typescript
const text = await fsPromises.readFile(documentUri.fsPath, 'utf-8');
// ...
await fsPromises.writeFile(documentUri.fsPath, doc.toString());
```

**Step 5: Convert readFileSync at line 687 (openWriterViewForField)**

Same pattern as Step 1.

**Step 6: Convert readFileSync at lines 860, 892 + writeFileSync at line 968 (handlers in openWriterViewForField)**

Same patterns - these are duplicated handlers for the second panel open method.

**Step 7: Convert readFileSync at line 936 + writeFileSync at line 968 (updateImageCaption in openWriterViewForField)**

Same pattern as Step 4.

**Step 8: Convert readFileSync at line 1174 + writeFileSync at lines 1209, 1212 (handleSaveAs)**

Change:
```typescript
const content = fs.readFileSync(currentPath, 'utf-8');
// ...
fs.writeFileSync(newPath.fsPath, newContent, 'utf-8');
// ...
fs.writeFileSync(newPath.fsPath, content, 'utf-8');
```
To:
```typescript
const content = await fsPromises.readFile(currentPath, 'utf-8');
// ...
await fsPromises.writeFile(newPath.fsPath, newContent, 'utf-8');
// ...
await fsPromises.writeFile(newPath.fsPath, content, 'utf-8');
```

**Step 9: Convert readFileSync at line 1250 + writeFileSync at line 1270 (handleRenameName)**

Same pattern.

**Step 10: Convert remaining sync calls in importImages method**

Find `fs.existsSync` and `fs.mkdirSync` and `fs.copyFileSync` in the `importImages` method and convert:

- `fs.existsSync(imagesDir)` → wrap in try/catch:
  ```typescript
  try { await fsPromises.access(imagesDir); } catch { await fsPromises.mkdir(imagesDir, { recursive: true }); }
  ```
  This replaces the `if (!fs.existsSync) { fs.mkdirSync }` pattern.

- `fs.existsSync(targetPath)` in the while loop → use try/catch:
  ```typescript
  async function fileExists(p: string): Promise<boolean> {
    try { await fsPromises.access(p); return true; } catch { return false; }
  }
  ```
  Add this as a private method on the class, then use `while (await fileExists(targetPath))`.

- `fs.copyFileSync(file.fsPath, targetPath)` → `await fsPromises.copyFile(file.fsPath, targetPath)`

**Step 11: Verify**

Run: `npm run compile`
Expected: No errors

**Step 12: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "perf: replace synchronous file I/O with async in WriterViewManager

Convert 10 readFileSync and 5 writeFileSync calls to use fsPromises.
Prevents blocking the VS Code extension host thread during file operations."
```

---

### Task 4: Fix auto-save race condition

**Files:**
- Modify: `src/writerView/script.ts` (save function ~line 247, message handlers ~line 1126-1152)

**Context:** The 2-second auto-save timer and manual Ctrl+S / blur saves can fire simultaneously, causing duplicate writes to the same file. Need a guard flag.

**Step 1: Add isSaving flag**

After `let saveTimeout = null;` (~line 74), add:
```javascript
let isSaving = false;
```

**Step 2: Guard the save function and cancel pending auto-save**

Change the `save()` function (~line 247) from:
```javascript
function save() {
  const anyDirty = isDirty || attributesDirty || contentSectionsDirty || summaryDirty || bodyDirty;
  if (!anyDirty) return;

  saveMenuBtn.disabled = true;
```

To:
```javascript
function save() {
  const anyDirty = isDirty || attributesDirty || contentSectionsDirty || summaryDirty || bodyDirty;
  if (!anyDirty || isSaving) return;

  // Cancel pending auto-save to prevent double-fire
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  isSaving = true;
  saveMenuBtn.disabled = true;
```

**Step 3: Clear the guard on save completion**

In the message handler (~line 1126), update the `saved` case:
```javascript
case 'saved':
  isDirty = false;
  isSaving = false;
  checkAllClean();
  break;
```

And update the `saveComplete` case (~line 1143):
```javascript
case 'saveComplete':
  markClean();
  isSaving = false;
  saveMenuBtn.disabled = false;
```

**Step 4: Verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/script.ts
git commit -m "fix(reliability): prevent auto-save race condition with isSaving guard

Adds mutex flag to prevent concurrent manual + auto saves.
Cancels pending auto-save timer when manual save triggers.
Clears guard on save completion messages."
```

---

### Task 5: Sanitize error messages

**Files:**
- Modify: `src/writerView/manager.ts` (12+ error handler locations)

**Context:** Many `showErrorMessage` calls include `${error}` which can expose internal file paths, stack traces, and implementation details. Replace with generic user-facing messages and log details to console.

**Step 1: Replace all error-exposing showErrorMessage calls**

Apply this pattern to every occurrence of `` showErrorMessage(`...: ${error}`) ``:

```typescript
// BEFORE:
vscode.window.showErrorMessage(`Failed to save caption: ${error}`);

// AFTER:
console.error('Failed to save caption:', error);
vscode.window.showErrorMessage('Failed to save image caption.');
```

Full list of changes (find each line and apply the pattern):

| Line | Before | After (showErrorMessage) | Console log |
|------|--------|--------------------------|-------------|
| ~565 | `` `Failed to save caption: ${error}` `` | `'Failed to save image caption.'` | `console.error('Failed to save caption:', error);` |
| ~973 | `` `Failed to save caption: ${error}` `` | `'Failed to save image caption.'` | `console.error('Failed to save caption:', error);` |
| ~1142 | `` `Save failed: ${error}` `` | `'Failed to save changes.'` | `console.error('Save failed:', error);` |
| ~1228 | `` `Save As failed: ${error}` `` | `'Failed to save copy.'` | `console.error('Save As failed:', error);` |
| ~1315 | `` `Save failed: ${error}` `` | `'Failed to save attributes.'` | `console.error('Save attributes failed:', error);` |
| ~1351 | `` `Save failed: ${error}` `` | `'Failed to save content sections.'` | `console.error('Save content sections failed:', error);` |
| ~1477 | `` `Failed to add field: ${error}` `` | `'Failed to add field.'` | `console.error('Failed to add field:', error);` |
| ~1540 | `` `Failed to add image: ${error}` `` | `'Failed to add image.'` | `console.error('Failed to add image:', error);` |
| ~1576 | `` `Failed to import images: ${error}` `` | `'Failed to import images.'` | `console.error('Failed to import images:', error);` |
| ~1629 | `` `Failed to delete image: ${error}` `` | `'Failed to delete image.'` | `console.error('Failed to delete image:', error);` |
| ~1682 | `` `Failed to reorder images: ${error}` `` | `'Failed to reorder images.'` | `console.error('Failed to reorder images:', error);` |

Leave messages that don't contain `${error}` as-is (e.g. `'Unable to parse Codex document'` is fine - no internal details).

**Step 2: Verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix(security): sanitize error messages to prevent info disclosure

Replace 11 user-facing error messages that exposed internal details
(file paths, stack traces) with generic messages. Details logged to console."
```

---

### Task 6: Add path traversal protection to resolveImageUrlForWebview

**Files:**
- Modify: `src/writerView/manager.ts:178-197` (resolveImageUrlForWebview method)

**Context:** This method resolves relative image paths to webview URIs. A crafted path like `../../etc/passwd` could escape the workspace. The `isPathWithinWorkspace` helper already exists in `utils/helpers.ts`.

**Step 1: Add workspace boundary check**

Change `resolveImageUrlForWebview` from:

```typescript
private resolveImageUrlForWebview(webview: vscode.Webview, url: string, workspaceRoot: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  let fullPath: string;
  if (url.startsWith('/')) {
    fullPath = path.join(workspaceRoot, url.substring(1));
  } else {
    fullPath = path.join(workspaceRoot, url);
  }

  const fileUri = vscode.Uri.file(fullPath);
  return webview.asWebviewUri(fileUri).toString();
}
```

To:

```typescript
private resolveImageUrlForWebview(webview: vscode.Webview, url: string, workspaceRoot: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  let fullPath: string;
  if (url.startsWith('/')) {
    fullPath = path.join(workspaceRoot, url.substring(1));
  } else {
    fullPath = path.join(workspaceRoot, url);
  }

  // Path traversal protection: ensure resolved path stays within workspace
  const resolved = path.resolve(fullPath);
  const resolvedRoot = path.resolve(workspaceRoot);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    return '';
  }

  const fileUri = vscode.Uri.file(fullPath);
  return webview.asWebviewUri(fileUri).toString();
}
```

**Step 2: Verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "fix(security): add path traversal protection for image URL resolution

Validate resolved image paths stay within workspace boundary.
Crafted relative paths like ../../etc/passwd now return empty string."
```

---

### Task 7: Add parseInt NaN guards

**Files:**
- Modify: `src/writerView/script.ts` (13 parseInt calls)

**Context:** All `parseInt` calls parse `dataset.index` from DOM elements. If the attribute is missing or malformed, `parseInt` returns `NaN`, causing silent failures or array access at index `undefined`.

**Step 1: Add safeParseInt helper**

After the `escapeHtml` function (~line 440), add:

```javascript
function safeParseInt(value, fallback) {
  if (value == null) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}
```

**Step 2: Replace all parseInt calls with safeParseInt**

Apply globally within the script. For every occurrence of `parseInt(something.dataset.index)` or `parseInt(something.dataset.index, 10)`, replace with `safeParseInt(something.dataset.index, -1)`.

Then add a guard after each call:

```javascript
// BEFORE:
const index = parseInt(card.dataset.index);
if (localAttributes[index]) {
  localAttributes[index].value = target.value;

// AFTER:
const index = safeParseInt(card.dataset.index, -1);
if (index < 0) return;
if (localAttributes[index]) {
  localAttributes[index].value = target.value;
```

All 13 locations:
1. `script.ts` ~line 534: `parseInt(card.dataset.index)` in attr input handler
2. `script.ts` ~line 544: `parseInt(card.dataset.index)` in attr type-select handler
3. `script.ts` ~line 559: `parseInt(nameSpan.dataset.index)` in attr name click
4. `script.ts` ~line 584: `parseInt(deleteItem.dataset.index)` in attr delete
5. `script.ts` ~line 602: `parseInt(editSpan.dataset.index)` in attr keydown
6. `script.ts` ~line 619: `parseInt(editSpan.dataset.index)` in attr blur
7. `script.ts` ~line 861: `parseInt(nameSpan.dataset.index)` in content name click
8. `script.ts` ~line 890: `parseInt(deleteItem.dataset.index)` in content delete
9. `script.ts` ~line 925: `parseInt(e.target.dataset.index)` in content input
10. `script.ts` ~line 937: `parseInt(editSpan.dataset.index)` in content keydown
11. `script.ts` ~line 955: `parseInt(editSpan.dataset.index)` in content blur
12. `script.ts` ~line 1321: `parseInt(thumbnail.dataset.index, 10)` in thumbnail click
13. `script.ts` ~line 1332: `parseInt(thumbnail.dataset.index, 10)` in thumbnail keydown

**Step 3: Verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/script.ts
git commit -m "fix(reliability): add NaN guards for all parseInt index parsing

Add safeParseInt helper returning fallback on NaN/null.
All 13 parseInt(dataset.index) calls now guarded with early return on -1."
```

---

### Task 8: Update META-DEV-PROMPT status

**Files:**
- Modify: `/Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md`

**Step 1: Update Writer View row**

Change the row for item 22 in the CHAPTERWISE-CODEX section from:
```
| 22 | Writer View (Prose Editor) | ⬜ | 4 | | | WebView, auto-save, themes |
```
To:
```
| 22 | Writer View (Prose Editor) | ✅ | 4 | 2026-02-05 | | Nonce fix, CSP img-src, innerHTML XSS, async I/O, message validation, race condition, path traversal, error sanitization |
```

**Step 2: Add decision log entry**

Add to the NOTES & DECISIONS LOG:

```markdown
### 2026-02-05 - Writer View (Prose Editor) Hardening (#22) [chapterwise-codex]
Decision: Full security + reliability + performance hardening
Changes (Phase 1 - User-driven):
- Secure nonce: replaced Math.random() with crypto.randomBytes()
- Message validation: type and payload validation on all WebView messages
- Image path validation: isPathWithinWorkspace for addExistingImage
- YAML node type safety: type guards before property access
- Disposed panel safety: safePostMessage wrapper with try-catch
- Word count: multi-byte character handling
Changes (Phase 2 - Plan-driven):
- CSP: added img-src directive restricting image sources
- XSS: escaped all innerHTML interpolations in image rendering
- Performance: replaced all synchronous file reads/writes with async fsPromises
- Race condition: added isSaving guard preventing concurrent saves
- Path traversal: workspace boundary validation in resolveImageUrlForWebview
- Error sanitization: removed internal path/error exposure from user messages
- NaN guards: safe parseInt with fallback for all 13 index parsing sites
Deferred (Low priority):
- Dirty state persistence/recovery on crash
- WebView state serialization for panel restore
- Content size limits for very large prose fields
```

**Step 3: Commit**

```bash
git add /Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md
git commit -m "docs: mark Writer View (#22) hardening complete"
```

---

## Execution Order

Tasks 1-2 are in different files and independent - can be done in any order.
Task 3 is the largest (manager.ts sync I/O) - do after Tasks 1-2.
Task 4 is in script.ts - do after Task 1 (same file, different area).
Tasks 5-6 are in manager.ts - do after Task 3 (same file).
Task 7 is in script.ts - do after Task 4 (same file).
Task 8 is the final status update.

**Recommended order:** 1 → 2 → 4 → 7 → 3 → 5 → 6 → 8

Rationale: Group script.ts changes (1, 4, 7), then manager.ts changes (3, 5, 6), then docs (8). Each task compiles cleanly before the next.
