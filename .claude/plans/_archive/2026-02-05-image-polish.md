# Image System Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the highest-impact UX and robustness gaps in the image system.

**Architecture:**
- Add success toasts for positive feedback
- Add file size validation (10MB limit) before import
- Add visual drop indicator for drag-drop reorder
- Add focus trap to modals for accessibility
- Add fade-out animation to toasts

**Tech Stack:** TypeScript, CSS animations, VS Code Webview API

---

## Task 1: Add Success Toasts

**Files:**
- Modify: `src/writerView/manager.ts`
- Modify: `src/writerView/script.ts`

**Step 1: Add success messages in manager.ts**

Find `handleAddExistingImage` - after the successful `panel.webview.postMessage({ type: 'imageAdded'...})`, the webview already gets notified. We need to add a success message type.

Actually, the webview already receives `imageAdded`, `imagesAdded`, `imageDeleted`, `imagesReordered`. We just need to show toasts for these in script.ts.

**In script.ts**, find the message handler cases for these and add toast calls:

After `case 'imageAdded':` handler logic, add:
```typescript
          showToast('Image added successfully', 'success');
```

After `case 'imagesAdded':` handler logic, add:
```typescript
          showToast(`${message.images.length} image(s) imported`, 'success');
```

After `case 'imageDeleted':` handler logic, add:
```typescript
          showToast('Image removed', 'success');
```

After `case 'imagesReordered':` handler (which just has `break`), add before break:
```typescript
          showToast('Images reordered', 'success');
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/script.ts
git commit -m "feat(writerView): add success toasts for image operations

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Add File Size Validation

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add size check in importImages**

Find the `importImages` method. After the duplicate check block and before the "Check if file is already in workspace" block, add file size validation:

```typescript
      // Check file size (limit to 10MB)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      try {
        const stats = await fsPromises.stat(file.fsPath);
        if (stats.size > MAX_FILE_SIZE) {
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
          vscode.window.showWarningMessage(
            `Skipped "${filename}" (${sizeMB}MB) - exceeds 10MB limit`
          );
          continue;
        }
      } catch {
        // If we can't stat, let it fail later during copy
      }
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): add 10MB file size limit for image imports

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add Drop Indicator for Drag-Drop

**Files:**
- Modify: `src/writerView/styles.ts`
- Modify: `src/writerView/script.ts`

**Step 1: Add drop indicator styles in styles.ts**

Find the drag-drop styles section (search for "DRAG DROP") and add after `.dragging`:

```css
    .drop-indicator {
      position: absolute;
      width: 3px;
      background: var(--accent);
      top: 0;
      bottom: 0;
      pointer-events: none;
      border-radius: 2px;
    }

    .image-thumbnail.drag-over-left::before,
    .gallery-item.drag-over-left::before {
      content: '';
      position: absolute;
      left: -6px;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--accent);
      border-radius: 2px;
    }

    .image-thumbnail.drag-over-right::after,
    .gallery-item.drag-over-right::after {
      content: '';
      position: absolute;
      right: -6px;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--accent);
      border-radius: 2px;
    }
```

Also add `position: relative;` to `.image-thumbnail` and `.gallery-item` if not already present.

**Step 2: Update dragover handler in script.ts**

Find the dragover handler (search for `addEventListener('dragover'`). Update it to show drop indicator based on mouse position:

```typescript
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      const thumbnail = (e.target as HTMLElement).closest('.image-thumbnail, .gallery-item') as HTMLElement;

      // Remove previous indicators
      document.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
        el.classList.remove('drag-over-left', 'drag-over-right');
      });

      if (thumbnail && !thumbnail.classList.contains('dragging')) {
        const rect = thumbnail.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        if (e.clientX < midpoint) {
          thumbnail.classList.add('drag-over-left');
        } else {
          thumbnail.classList.add('drag-over-right');
        }
      }
    });
```

**Step 3: Clean up indicators on dragend and drop**

Find the `drop` handler and add cleanup at the start:

```typescript
      // Clean up indicators
      document.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
        el.classList.remove('drag-over-left', 'drag-over-right');
      });
```

Find the `dragend` handler and add the same cleanup.

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/styles.ts src/writerView/script.ts
git commit -m "feat(writerView): add visual drop indicator for drag-drop reorder

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add Toast Fade-Out Animation

**Files:**
- Modify: `src/writerView/styles.ts`
- Modify: `src/writerView/script.ts`

**Step 1: Add fade-out animation in styles.ts**

Find the toast styles and add fade-out keyframes after `@keyframes toast-in`:

```css
    @keyframes toast-out {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
    }

    .toast.fade-out {
      animation: toast-out 0.3s ease forwards;
    }
```

**Step 2: Update showToast function in script.ts**

Find the `showToast` function and update it to use fade-out:

```typescript
    function showToast(message: string, type = 'info') {
      const existing = document.querySelector('.toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
          toast.remove();
        }, 300);
      }, 2700);
    }
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/styles.ts src/writerView/script.ts
git commit -m "feat(writerView): add fade-out animation for toast notifications

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Add Focus Trap to Modals

**Files:**
- Modify: `src/writerView/script.ts`

**Step 1: Add focus trap utility function**

Near the top of the script (after the toast function), add:

```typescript
    function trapFocus(modal: HTMLElement) {
      const focusableElements = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusable = focusableElements[0] as HTMLElement;
      const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

      modal.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;

        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      });
    }
```

**Step 2: Apply focus trap to modals**

Find where modals are set up. After the confirm modal handlers (after confirmOk event listener), add:

```typescript
    // Apply focus trap to modals
    if (confirmModal) trapFocus(confirmModal.querySelector('.confirm-content') as HTMLElement);
    if (duplicateModal) trapFocus(duplicateModal.querySelector('.duplicate-content') as HTMLElement);
```

For the image browser modal, find `imageBrowserModal` setup and add:
```typescript
    if (imageBrowserModal) trapFocus(imageBrowserModal.querySelector('.image-browser-content') as HTMLElement);
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/script.ts
git commit -m "feat(writerView): add focus trap to modals for accessibility

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Final Verification and Package

**Step 1: Run full compile**

Run: `npm run compile`
Expected: No errors

**Step 2: Package extension**

Run: `npx vsce package`

**Step 3: Install and test**

Run: `/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code --install-extension chapterwise-codex-0.3.0.vsix --force`

**Step 4: Manual verification checklist**

1. Import an image → verify success toast appears and fades out
2. Delete an image → verify success toast
3. Reorder images → verify drop indicator shows, success toast after
4. Try importing 15MB+ image → verify warning message
5. Open confirm modal → Tab key should cycle within modal only
6. Open image browser → Tab key should cycle within modal only

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete image system polish

- Success toasts for all operations
- 10MB file size limit
- Visual drop indicator for reorder
- Toast fade-out animation
- Focus trap in modals

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Summary

| Task | Issue Fixed | Impact |
|------|-------------|--------|
| 1 | No success feedback | High UX |
| 2 | No file size limit | High Robustness |
| 3 | No drop indicator | Medium UX |
| 4 | Abrupt toast disappear | Low UX |
| 5 | No focus trap | High Accessibility |
| 6 | Final verification | QA |

**Files Modified:**
- `src/writerView/manager.ts` - File size validation
- `src/writerView/script.ts` - Success toasts, drop indicator, fade-out, focus trap
- `src/writerView/styles.ts` - Drop indicator CSS, fade-out animation
