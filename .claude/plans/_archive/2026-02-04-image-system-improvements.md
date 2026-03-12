# Image System Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical UX and best practice issues in the image system: async file operations, custom delete confirmation, loading states, keyboard accessibility, and error feedback.

**Architecture:**
- Convert remaining sync file operations to async using `fsPromises`
- Replace native `confirm()` with custom modal dialog in webview
- Add loading spinner for workspace scan and import operations
- Add keyboard navigation (tabindex, Enter/Space) for image thumbnails
- Add error message handling in webview for failed operations

**Tech Stack:** TypeScript, VS Code Webview API, fs.promises

---

## Task 1: Convert Image Handler File Operations to Async

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Update handleAddExistingImage to use async file read**

Find the `handleAddExistingImage` method and replace:
```typescript
      const text = fs.readFileSync(documentUri.fsPath, 'utf-8');
```

With:
```typescript
      const text = await fsPromises.readFile(documentUri.fsPath, 'utf-8');
```

**Step 2: Update handleDeleteImage to use async file operations**

Find the `handleDeleteImage` method and replace:
```typescript
      const text = fs.readFileSync(documentUri.fsPath, 'utf-8');
```

With:
```typescript
      const text = await fsPromises.readFile(documentUri.fsPath, 'utf-8');
```

And replace:
```typescript
      fs.writeFileSync(documentUri.fsPath, doc.toString());
```

With:
```typescript
      await fsPromises.writeFile(documentUri.fsPath, doc.toString());
```

**Step 3: Update handleReorderImages to use async file operations**

Find the `handleReorderImages` method and make the same replacements:
- `fs.readFileSync` → `await fsPromises.readFile`
- `fs.writeFileSync` → `await fsPromises.writeFile`

**Step 4: Update addImagesToNode to use async file operations**

Find the `addImagesToNode` method and make the same replacements.

**Step 5: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 6: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "perf(writerView): convert image handlers to async file operations

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Add Custom Delete Confirmation Modal

**Files:**
- Modify: `src/writerView/html/imagesRenderer.ts`
- Modify: `src/writerView/styles.ts`
- Modify: `src/writerView/script.ts`

**Step 1: Add confirmation modal HTML to imagesRenderer.ts**

Find the `renderImageModal` function and add this modal HTML at the end, before the closing backtick:

```typescript
export function renderImageModal(): string {
  return `
    <div class="image-modal" id="imageModal" style="display: none;">
      <!-- existing modal content -->
    </div>
    <div class="confirm-modal" id="confirmModal" style="display: none;">
      <div class="modal-backdrop" id="confirmBackdrop"></div>
      <div class="confirm-content">
        <h3 id="confirmTitle">Confirm</h3>
        <p id="confirmMessage">Are you sure?</p>
        <div class="confirm-buttons">
          <button class="confirm-btn confirm-cancel" id="confirmCancel">Cancel</button>
          <button class="confirm-btn confirm-ok" id="confirmOk">Delete</button>
        </div>
      </div>
    </div>
  `;
}
```

**Step 2: Add confirmation modal styles to styles.ts**

Find the `.modal-delete-btn:hover` style block and add after it:

```typescript

    /* === CONFIRM MODAL === */

    .confirm-modal {
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

    .confirm-content {
      position: relative;
      background: var(--bg-primary);
      border-radius: 8px;
      padding: 24px;
      max-width: 400px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      text-align: center;
    }

    .confirm-content h3 {
      margin: 0 0 12px 0;
      color: var(--text-primary);
      font-size: 1.1rem;
    }

    .confirm-content p {
      margin: 0 0 20px 0;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .confirm-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
    }

    .confirm-btn {
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .confirm-cancel {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }

    .confirm-cancel:hover {
      background: var(--bg-tertiary, var(--bg-secondary));
    }

    .confirm-ok {
      background: #e53935;
      border: none;
      color: white;
    }

    .confirm-ok:hover {
      background: #c62828;
    }
```

**Step 3: Replace confirm() with custom modal in script.ts**

Find this code in script.ts (around line 1325-1342):

```typescript
    const modalDelete = document.getElementById('modalDelete');
    if (modalDelete) {
      modalDelete.addEventListener('click', () => {
        const img = localImages[currentModalIndex];
        if (!img) return;

        // Confirm deletion
        const confirmed = confirm('Delete this image reference?\\n\\nNote: The image file will NOT be deleted from disk.');
        if (!confirmed) return;

        // Send delete message
        vscode.postMessage({
          type: 'deleteImage',
          url: img.url,
          index: currentModalIndex
        });
      });
    }
```

Replace with:

```typescript
    // Custom confirm modal elements
    const confirmModal = document.getElementById('confirmModal');
    const confirmBackdrop = document.getElementById('confirmBackdrop');
    const confirmCancel = document.getElementById('confirmCancel');
    const confirmOk = document.getElementById('confirmOk');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');

    let pendingDeleteCallback = null;

    function showConfirmModal(title, message, onConfirm) {
      if (confirmTitle) confirmTitle.textContent = title;
      if (confirmMessage) confirmMessage.textContent = message;
      pendingDeleteCallback = onConfirm;
      if (confirmModal) confirmModal.style.display = 'flex';
    }

    function hideConfirmModal() {
      if (confirmModal) confirmModal.style.display = 'none';
      pendingDeleteCallback = null;
    }

    if (confirmCancel) {
      confirmCancel.addEventListener('click', hideConfirmModal);
    }
    if (confirmBackdrop) {
      confirmBackdrop.addEventListener('click', hideConfirmModal);
    }
    if (confirmOk) {
      confirmOk.addEventListener('click', () => {
        if (pendingDeleteCallback) pendingDeleteCallback();
        hideConfirmModal();
      });
    }

    const modalDelete = document.getElementById('modalDelete');
    if (modalDelete) {
      modalDelete.addEventListener('click', () => {
        const img = localImages[currentModalIndex];
        if (!img) return;

        showConfirmModal(
          'Delete Image',
          'Delete this image reference? The image file will NOT be deleted from disk.',
          () => {
            vscode.postMessage({
              type: 'deleteImage',
              url: img.url,
              index: currentModalIndex
            });
          }
        );
      });
    }
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/html/imagesRenderer.ts src/writerView/styles.ts src/writerView/script.ts
git commit -m "feat(writerView): replace confirm() with custom delete confirmation modal

Native confirm() doesn't work reliably in webviews.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add Loading Spinner for Workspace Scan

**Files:**
- Modify: `src/writerView/styles.ts`
- Modify: `src/writerView/script.ts`

**Step 1: Add spinner animation styles**

Find the `.browser-loading` style and replace it with:

```typescript
    .browser-loading {
      grid-column: 1 / -1;
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
      font-style: italic;
    }

    .browser-loading::before {
      content: '';
      display: block;
      width: 32px;
      height: 32px;
      margin: 0 auto 12px;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
```

**Step 2: Add loading state management in script.ts**

Find the `openBrowserModal` function and update it:

```typescript
    function openBrowserModal() {
      if (imageBrowserModal) {
        imageBrowserModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        // Show loading state
        if (imageBrowserGrid) {
          imageBrowserGrid.innerHTML = '<div class="browser-loading">Scanning workspace for images...</div>';
        }
        // Disable search while loading
        if (imageSearch) {
          imageSearch.disabled = true;
          imageSearch.value = '';
        }
        // Request workspace images
        vscode.postMessage({ type: 'openImageBrowser' });
      }
    }
```

Find the `case 'workspaceImages'` handler and update it:

```typescript
        case 'workspaceImages':
          allWorkspaceImages = message.images || [];
          renderWorkspaceImages(allWorkspaceImages);
          // Enable search after loading
          if (imageSearch) {
            imageSearch.disabled = false;
          }
          break;
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/styles.ts src/writerView/script.ts
git commit -m "feat(writerView): add loading spinner for workspace image scan

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add Keyboard Navigation for Image Thumbnails

**Files:**
- Modify: `src/writerView/html/imagesRenderer.ts`
- Modify: `src/writerView/script.ts`

**Step 1: Add tabindex and role to thumbnails in imagesRenderer.ts**

Find the thumbnail HTML in `renderImagesGallery`:

```typescript
    return `
      <div class="image-thumbnail" data-index="${index}" data-url="${escapeHtml(img.url)}">
```

Replace with:

```typescript
    return `
      <div class="image-thumbnail" data-index="${index}" data-url="${escapeHtml(img.url)}" tabindex="0" role="button" aria-label="View image ${index + 1}${caption ? ': ' + caption : ''}">
```

Do the same for `renderImagesFullGallery`:

```typescript
      <div class="gallery-item" data-index="${index}" data-url="${escapeHtml(img.url)}" tabindex="0" role="button" aria-label="View image ${index + 1}${caption ? ': ' + caption : ''}">
```

**Step 2: Add keyboard handler in script.ts**

Find the thumbnail click handler (around line 1252):

```typescript
    // Thumbnail click handler
    document.addEventListener('click', (e) => {
      const thumbnail = e.target.closest('.image-thumbnail, .gallery-item');
      if (thumbnail) {
        const index = parseInt(thumbnail.dataset.index, 10);
        openImageModal(index);
      }
    });
```

Add this keyboard handler immediately after it:

```typescript
    // Thumbnail keyboard handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const thumbnail = e.target.closest('.image-thumbnail, .gallery-item');
        if (thumbnail) {
          e.preventDefault();
          const index = parseInt(thumbnail.dataset.index, 10);
          openImageModal(index);
        }
      }
    });
```

**Step 3: Update updateImagesGallery to include tabindex**

Find the `updateImagesGallery` function and update the thumbnail HTML:

```typescript
          imagesContainer.innerHTML = \`<div class="images-grid">\${localImages.map((img, index) => \`
            <div class="image-thumbnail" data-index="\${index}" data-url="\${img.url}" tabindex="0" role="button">
              \${img.featured ? '<span class="featured-badge">★</span>' : ''}
              <img src="\${img.url}" alt="\${img.alt || img.caption || 'Image'}" loading="lazy" />
              <div class="thumbnail-caption" title="\${img.caption || ''}">\${img.caption || '&nbsp;'}</div>
            </div>
          \`).join('')}</div>\`;
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/html/imagesRenderer.ts src/writerView/script.ts
git commit -m "feat(writerView): add keyboard navigation for image thumbnails

Adds tabindex, role=button, and Enter/Space key handling for accessibility.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Add Error Feedback for Failed Operations

**Files:**
- Modify: `src/writerView/manager.ts`
- Modify: `src/writerView/script.ts`
- Modify: `src/writerView/styles.ts`

**Step 1: Add error message types in manager.ts handlers**

Find `handleAddExistingImage` and update the catch block:

```typescript
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add image: ${error}`);
      panel.webview.postMessage({ type: 'imageAddError', message: 'Failed to add image' });
    }
```

Find `handleImportImage` and update the catch block:

```typescript
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to import images: ${error}`);
        panel.webview.postMessage({ type: 'imageImportError', message: 'Failed to import images' });
      }
```

Find `handleDeleteImage` and update the catch block:

```typescript
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete image: ${error}`);
      panel.webview.postMessage({ type: 'imageDeleteError', message: 'Failed to delete image' });
    }
```

**Step 2: Add toast notification styles in styles.ts**

Find the confirm modal styles and add after them:

```typescript

    /* === TOAST NOTIFICATIONS === */

    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 0.9rem;
      z-index: 1003;
      animation: toast-in 0.3s ease;
    }

    .toast.error {
      background: #c62828;
    }

    .toast.success {
      background: #2e7d32;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
```

**Step 3: Add error handlers and toast function in script.ts**

Find the message handler switch statement and add these cases after `imagesReordered`:

```typescript
        case 'imageAddError':
        case 'imageImportError':
        case 'imageDeleteError':
          showToast(message.message, 'error');
          break;
```

Add the toast function near the top of the script (after variable declarations):

```typescript
    // Toast notification function
    function showToast(message, type = 'info') {
      const existing = document.querySelector('.toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.remove();
      }, 3000);
    }
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/manager.ts src/writerView/script.ts src/writerView/styles.ts
git commit -m "feat(writerView): add error feedback for failed image operations

Adds toast notifications when image add/import/delete fails.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Add "No Results" Message for Image Search

**Files:**
- Modify: `src/writerView/script.ts`

**Step 1: Update renderWorkspaceImages to show search-specific empty state**

Find the `renderWorkspaceImages` function and update it:

```typescript
    function renderWorkspaceImages(images, isSearchResult = false) {
      if (!imageBrowserGrid) return;

      if (images.length === 0) {
        if (isSearchResult) {
          imageBrowserGrid.innerHTML = '<div class="browser-empty">No images match your search</div>';
        } else {
          imageBrowserGrid.innerHTML = '<div class="browser-empty">No images found in workspace</div>';
        }
        return;
      }

      imageBrowserGrid.innerHTML = images.map(img => \`
        <div class="browser-image-item" data-path="\${img.path}" title="\${img.path}">
          <img src="\${img.thumbnail}" alt="\${img.filename}" loading="lazy" />
          <div class="browser-image-name">\${img.filename}</div>
          <div class="browser-image-folder">\${img.folder}</div>
        </div>
      \`).join('');
    }
```

**Step 2: Update filterImages to pass isSearchResult flag**

Find the `filterImages` function and update it:

```typescript
    function filterImages(query) {
      const filtered = allWorkspaceImages.filter(img =>
        img.filename.toLowerCase().includes(query.toLowerCase()) ||
        img.folder.toLowerCase().includes(query.toLowerCase())
      );
      renderWorkspaceImages(filtered, query.length > 0);
    }
```

**Step 3: Update workspaceImages handler**

Find the `case 'workspaceImages'` handler and update it:

```typescript
        case 'workspaceImages':
          allWorkspaceImages = message.images || [];
          renderWorkspaceImages(allWorkspaceImages, false);
          // Enable search after loading
          if (imageSearch) {
            imageSearch.disabled = false;
          }
          break;
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/script.ts
git commit -m "feat(writerView): add 'no results' message for image search

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Final Verification and Package

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
2. Click "Add Image" → verify spinner shows during scan
3. Type in search → verify "no results" message if no matches
4. Tab to image thumbnails → verify focus ring visible
5. Press Enter on focused thumbnail → verify modal opens
6. Click delete → verify custom confirmation modal (not native)
7. Import an image → verify operation completes
8. Verify errors show toast notification (can test by disconnecting file)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete image system UX improvements

- Async file operations for better performance
- Custom delete confirmation modal
- Loading spinner for workspace scan
- Keyboard navigation for thumbnails
- Error feedback via toast notifications
- Search 'no results' message

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Summary

| Task | Issue Fixed | Type |
|------|-------------|------|
| 1 | Sync file ops blocking extension | Performance |
| 2 | Native confirm() unreliable | UX |
| 3 | No loading state during scan | UX |
| 4 | No keyboard navigation | Accessibility |
| 5 | No error feedback | UX |
| 6 | No "no results" message | UX |
| 7 | Final verification | QA |

**Files Modified:**
- `src/writerView/manager.ts` - Async file ops, error messages
- `src/writerView/script.ts` - Confirm modal, loading, keyboard, toast, search
- `src/writerView/styles.ts` - Confirm modal, spinner, toast styles
- `src/writerView/html/imagesRenderer.ts` - Confirm modal HTML, tabindex
