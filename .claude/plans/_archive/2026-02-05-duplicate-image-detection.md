# Duplicate Image Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect duplicate images when importing and offer users the choice to use the existing image or import as a new copy.

**Architecture:**
- Calculate SHA256 hash of imported image file
- Compare against hashes of existing workspace images (with size pre-filter for performance)
- Show custom modal when duplicate found with options: "Use Existing" or "Import Anyway"
- Cache scanned image hashes to avoid re-hashing on repeated imports

**Tech Stack:** Node.js crypto module (SHA256), fs.promises, VS Code Webview API

---

## Task 1: Add Image Hash Utility Function

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add crypto import**

At the top of the file, after the fs import, add:

```typescript
import * as crypto from 'crypto';
```

**Step 2: Add hash calculation method**

Find the `scanWorkspaceImages` method and add this new method BEFORE it:

```typescript
  /**
   * Calculate SHA256 hash of a file
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fsPromises.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  }
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): add file hash calculation utility

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Add Duplicate Detection Method

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add duplicate finder method**

Add after `calculateFileHash`:

```typescript
  /**
   * Find duplicate image in workspace by content hash
   * Uses file size as pre-filter for performance
   */
  private async findDuplicateImage(
    sourceFilePath: string,
    workspaceRoot: string
  ): Promise<{ found: boolean; existingPath?: string }> {
    try {
      // Get source file stats
      const sourceStats = await fsPromises.stat(sourceFilePath);
      const sourceSize = sourceStats.size;

      // Scan workspace for images
      const workspaceImages = await this.scanWorkspaceImages(workspaceRoot);

      // Filter to images with similar size (within 1KB tolerance for metadata differences)
      const sizeTolerance = 1024;
      const candidates: string[] = [];

      for (const img of workspaceImages) {
        try {
          const stats = await fsPromises.stat(img.fullPath);
          if (Math.abs(stats.size - sourceSize) <= sizeTolerance) {
            candidates.push(img.fullPath);
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }

      // If no size matches, no duplicate
      if (candidates.length === 0) {
        return { found: false };
      }

      // Calculate source hash
      const sourceHash = await this.calculateFileHash(sourceFilePath);

      // Check candidates for hash match
      for (const candidatePath of candidates) {
        try {
          const candidateHash = await this.calculateFileHash(candidatePath);
          if (candidateHash === sourceHash) {
            const relativePath = '/' + path.relative(workspaceRoot, candidatePath).replace(/\\/g, '/');
            return { found: true, existingPath: relativePath };
          }
        } catch {
          // Skip files that can't be read
        }
      }

      return { found: false };
    } catch {
      // On any error, assume no duplicate
      return { found: false };
    }
  }
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): add duplicate image detection by content hash

Uses file size pre-filter for performance, then SHA256 hash comparison.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add Duplicate Modal HTML

**Files:**
- Modify: `src/writerView/html/imagesRenderer.ts`

**Step 1: Add duplicate modal to renderImageModal**

Find the closing of the confirm-modal div (line ~92) and add this modal AFTER it, before the final backtick:

```typescript
    <div class="duplicate-modal" id="duplicateModal" style="display: none;">
      <div class="modal-backdrop" id="duplicateBackdrop"></div>
      <div class="duplicate-content" role="dialog" aria-modal="true" aria-labelledby="duplicateTitle" aria-describedby="duplicateMessage">
        <h3 id="duplicateTitle">Duplicate Image Found</h3>
        <p id="duplicateMessage">This image already exists in your workspace:</p>
        <div class="duplicate-path" id="duplicatePath"></div>
        <div class="duplicate-preview">
          <img id="duplicatePreview" src="" alt="Duplicate image preview" />
        </div>
        <div class="duplicate-buttons">
          <button class="duplicate-btn duplicate-use-existing" id="duplicateUseExisting">Use Existing</button>
          <button class="duplicate-btn duplicate-import" id="duplicateImportAnyway">Import as Copy</button>
          <button class="duplicate-btn duplicate-cancel" id="duplicateCancel">Cancel</button>
        </div>
      </div>
    </div>
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/html/imagesRenderer.ts
git commit -m "feat(writerView): add duplicate image modal HTML

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add Duplicate Modal Styles

**Files:**
- Modify: `src/writerView/styles.ts`

**Step 1: Add duplicate modal styles**

Find the toast styles section (search for "TOAST NOTIFICATIONS") and add AFTER the @keyframes toast-in:

```typescript

    /* === DUPLICATE IMAGE MODAL === */

    .duplicate-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1002;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .duplicate-content {
      position: relative;
      background: var(--bg-primary);
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      text-align: center;
    }

    .duplicate-content h3 {
      margin: 0 0 8px 0;
      color: var(--text-primary);
      font-size: 1.1rem;
    }

    .duplicate-content p {
      margin: 0 0 12px 0;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .duplicate-path {
      background: var(--bg-secondary);
      border-radius: 4px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--text-primary);
      margin-bottom: 16px;
      word-break: break-all;
    }

    .duplicate-preview {
      margin-bottom: 20px;
      max-height: 200px;
      overflow: hidden;
      border-radius: 4px;
      background: var(--bg-secondary);
    }

    .duplicate-preview img {
      max-width: 100%;
      max-height: 200px;
      object-fit: contain;
    }

    .duplicate-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .duplicate-btn {
      padding: 10px 20px;
      border-radius: 4px;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .duplicate-use-existing {
      background: var(--accent);
      border: none;
      color: white;
    }

    .duplicate-use-existing:hover {
      filter: brightness(1.1);
    }

    .duplicate-import {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }

    .duplicate-import:hover {
      background: var(--bg-tertiary, var(--bg-secondary));
    }

    .duplicate-cancel {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }

    .duplicate-cancel:hover {
      background: var(--bg-secondary);
    }

    .duplicate-btn:focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/styles.ts
git commit -m "feat(writerView): add duplicate image modal styles

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Add Webview Message Handlers for Duplicate Modal

**Files:**
- Modify: `src/writerView/script.ts`

**Step 1: Add duplicate modal element references**

Find the confirm modal elements section (search for "Custom confirm modal elements") and add AFTER the confirmOk handler:

```typescript
    // Duplicate modal elements
    const duplicateModal = document.getElementById('duplicateModal');
    const duplicateBackdrop = document.getElementById('duplicateBackdrop');
    const duplicatePath = document.getElementById('duplicatePath');
    const duplicatePreview = document.getElementById('duplicatePreview');
    const duplicateUseExisting = document.getElementById('duplicateUseExisting');
    const duplicateImportAnyway = document.getElementById('duplicateImportAnyway');
    const duplicateCancel = document.getElementById('duplicateCancel');

    let pendingDuplicateFile = null;
    let pendingDuplicateExistingPath = null;

    function showDuplicateModal(filePath, existingPath, previewUrl) {
      if (duplicatePath) duplicatePath.textContent = existingPath;
      if (duplicatePreview) duplicatePreview.src = previewUrl;
      pendingDuplicateFile = filePath;
      pendingDuplicateExistingPath = existingPath;
      if (duplicateModal) {
        duplicateModal.style.display = 'flex';
        if (duplicateUseExisting) duplicateUseExisting.focus();
      }
    }

    function hideDuplicateModal() {
      if (duplicateModal) duplicateModal.style.display = 'none';
      pendingDuplicateFile = null;
      pendingDuplicateExistingPath = null;
    }

    if (duplicateCancel) {
      duplicateCancel.addEventListener('click', () => {
        vscode.postMessage({ type: 'duplicateResolved', action: 'cancel' });
        hideDuplicateModal();
      });
    }
    if (duplicateBackdrop) {
      duplicateBackdrop.addEventListener('click', () => {
        vscode.postMessage({ type: 'duplicateResolved', action: 'cancel' });
        hideDuplicateModal();
      });
    }
    if (duplicateUseExisting) {
      duplicateUseExisting.addEventListener('click', () => {
        vscode.postMessage({
          type: 'duplicateResolved',
          action: 'useExisting',
          existingPath: pendingDuplicateExistingPath
        });
        hideDuplicateModal();
      });
    }
    if (duplicateImportAnyway) {
      duplicateImportAnyway.addEventListener('click', () => {
        vscode.postMessage({
          type: 'duplicateResolved',
          action: 'importAnyway',
          filePath: pendingDuplicateFile
        });
        hideDuplicateModal();
      });
    }

    // Escape key closes duplicate modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && duplicateModal && duplicateModal.style.display !== 'none') {
        vscode.postMessage({ type: 'duplicateResolved', action: 'cancel' });
        hideDuplicateModal();
      }
    });
```

**Step 2: Add message handler for duplicateFound**

Find the message handler switch statement and add after the error handlers:

```typescript
        case 'duplicateFound':
          showDuplicateModal(message.filePath, message.existingPath, message.previewUrl);
          break;
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/script.ts
git commit -m "feat(writerView): add duplicate modal script handlers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Integrate Duplicate Detection into Import Flow

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add state for pending duplicate resolution**

Find the class properties section (after `private panels:`) and add:

```typescript
  private pendingDuplicateResolvers: Map<string, {
    resolve: (action: { type: string; existingPath?: string }) => void;
    panel: vscode.WebviewPanel;
  }> = new Map();
```

**Step 2: Add duplicate resolution message handler**

In BOTH `openWriterView` and `openWriterViewForField` methods, find the message handler switch and add a new case:

```typescript
          case 'duplicateResolved': {
            const resolver = this.pendingDuplicateResolvers.get(panel.viewType + panel.title);
            if (resolver) {
              resolver.resolve({ type: message.action, existingPath: message.existingPath });
              this.pendingDuplicateResolvers.delete(panel.viewType + panel.title);
            }
            break;
          }
```

**Step 3: Add method to prompt for duplicate resolution**

Add after `findDuplicateImage`:

```typescript
  /**
   * Show duplicate modal and wait for user decision
   */
  private async promptDuplicateResolution(
    panel: vscode.WebviewPanel,
    filePath: string,
    existingPath: string,
    workspaceRoot: string
  ): Promise<{ type: string; existingPath?: string }> {
    return new Promise((resolve) => {
      // Store resolver
      this.pendingDuplicateResolvers.set(panel.viewType + panel.title, { resolve, panel });

      // Resolve preview URL for webview
      const previewUrl = this.resolveImageUrlForWebview(panel.webview, existingPath, workspaceRoot);

      // Send message to show modal
      panel.webview.postMessage({
        type: 'duplicateFound',
        filePath,
        existingPath,
        previewUrl
      });
    });
  }
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): add duplicate resolution infrastructure

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Update importImages to Check for Duplicates

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Update importImages signature**

Find the `importImages` method and update its signature to accept the panel:

```typescript
  private async importImages(
    files: vscode.Uri[],
    documentUri: vscode.Uri,
    node: CodexNode,
    workspaceRoot: string,
    panel: vscode.WebviewPanel
  ): Promise<CodexImage[]> {
```

**Step 2: Add duplicate check in the import loop**

Replace the entire for loop (from `for (const file of files)` to just before `// Add images to the node's YAML`) with:

```typescript
    for (const file of files) {
      let targetPath: string;
      let filename = path.basename(file.fsPath);

      // Check for duplicate by content hash
      const duplicate = await this.findDuplicateImage(file.fsPath, workspaceRoot);

      if (duplicate.found && duplicate.existingPath) {
        // Ask user what to do
        const resolution = await this.promptDuplicateResolution(
          panel,
          file.fsPath,
          duplicate.existingPath,
          workspaceRoot
        );

        if (resolution.type === 'useExisting') {
          // Use the existing image path
          addedImages.push({
            url: duplicate.existingPath,
            caption: '',
            featured: addedImages.length === 0 && (!node.images || node.images.length === 0)
          });
          continue;
        } else if (resolution.type === 'cancel') {
          // Skip this file
          continue;
        }
        // Otherwise fall through to import as copy
      }

      // Check if file is already in workspace
      if (file.fsPath.startsWith(workspaceRoot)) {
        // Already in workspace - ask if user wants to copy or reference
        const action = await vscode.window.showQuickPick(
          ['Reference original location', 'Copy to node folder'],
          { placeHolder: `${filename} is already in workspace` }
        );

        if (action === 'Reference original location') {
          // Use original path
          const relativePath = '/' + path.relative(workspaceRoot, file.fsPath).replace(/\\/g, '/');
          addedImages.push({
            url: relativePath,
            caption: '',
            featured: addedImages.length === 0 && (!node.images || node.images.length === 0)
          });
          continue;
        } else if (!action) {
          // User cancelled
          continue;
        }
      }

      // Handle duplicate filenames
      targetPath = path.join(imagesDir, filename);
      let counter = 1;
      while (fs.existsSync(targetPath)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        targetPath = path.join(imagesDir, `${base}-${counter}${ext}`);
        counter++;
      }

      // Copy file to images folder
      fs.copyFileSync(file.fsPath, targetPath);

      // Calculate relative path from workspace root
      const relativePath = '/' + path.relative(workspaceRoot, targetPath).replace(/\\/g, '/');

      addedImages.push({
        url: relativePath,
        caption: '',
        featured: addedImages.length === 0 && (!node.images || node.images.length === 0)
      });
    }
```

**Step 3: Update callers of importImages**

Find `handleImportImage` and update the call to include panel:

```typescript
        const addedImages = await this.importImages(result, documentUri, node, workspaceRoot, panel);
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): integrate duplicate detection into import flow

Checks content hash before importing, prompts user with options.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Final Verification and Package

**Step 1: Run full compile**

Run: `npm run compile`
Expected: No errors

**Step 2: Package extension**

Run: `npx vsce package`
Expected: Creates `chapterwise-codex-0.3.0.vsix`

**Step 3: Install and test**

Run: `/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code --install-extension chapterwise-codex-0.3.0.vsix --force`

**Step 4: Manual verification checklist**

1. Open a codex file in Writer View
2. Click "Add Image" → Import tab → select an image from outside workspace
3. Image should import normally (no duplicate)
4. Click "Add Image" again → Import the SAME image file
5. Duplicate modal should appear showing:
   - "Duplicate Image Found" title
   - Path to existing image
   - Preview thumbnail
   - Three buttons: "Use Existing", "Import as Copy", "Cancel"
6. Click "Use Existing" → verify same path used, no new file created
7. Repeat test, click "Import as Copy" → verify new file created with `-2` suffix
8. Repeat test, click "Cancel" → verify nothing added
9. Press Escape → verify modal closes and nothing added

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete duplicate image detection

- SHA256 content hash comparison with size pre-filter
- Custom modal with Use Existing / Import as Copy / Cancel options
- Preview of existing duplicate image

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add SHA256 hash utility method |
| 2 | Add duplicate finder with size pre-filter |
| 3 | Add duplicate modal HTML |
| 4 | Add duplicate modal styles |
| 5 | Add webview script handlers |
| 6 | Add resolution infrastructure in manager |
| 7 | Integrate into import flow |
| 8 | Final verification |

**Files Modified:**
- `src/writerView/manager.ts` - Hash, detection, resolution logic
- `src/writerView/html/imagesRenderer.ts` - Modal HTML
- `src/writerView/styles.ts` - Modal CSS
- `src/writerView/script.ts` - Modal handlers

**Performance Characteristics:**
- Size pre-filter eliminates most hash calculations
- Only hashes when file sizes match within 1KB
- Typical case: 0-2 hash calculations per import
