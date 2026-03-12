# Refactor Image Handlers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract duplicated image message handlers into shared private methods and convert synchronous scanner to async.

**Architecture:**
- Create 5 shared handler methods that both `openWriterView` and `openWriterViewForField` can call
- Convert `scanWorkspaceImages` from sync `fs.readdirSync` to async `fs.promises.readdir`
- Keep the switch/case structure but delegate to shared methods

**Tech Stack:** TypeScript, Node.js fs.promises API

---

## Task 1: Create Shared Handler Method for openImageBrowser

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add the shared handler method**

Find the `scanWorkspaceImages` method (around line 1722) and add this new method BEFORE it:

```typescript
  /**
   * Handle openImageBrowser message from webview
   */
  private async handleOpenImageBrowser(
    panel: vscode.WebviewPanel,
    workspaceRoot: string
  ): Promise<void> {
    const allImages = await this.scanWorkspaceImages(workspaceRoot);

    const imagesForBrowser = allImages.map(img => ({
      path: img.relativePath,
      thumbnail: this.resolveImageUrlForWebview(panel.webview, img.relativePath, workspaceRoot),
      filename: path.basename(img.relativePath),
      folder: path.dirname(img.relativePath).substring(1) || '/'
    }));

    panel.webview.postMessage({
      type: 'workspaceImages',
      images: imagesForBrowser
    });
  }
```

**Step 2: Update first usage in openWriterView**

Find the `case 'openImageBrowser'` in `openWriterView` (around line 544) and replace:

```typescript
          case 'openImageBrowser': {
            // Scan workspace for images
            const allImages = await this.scanWorkspaceImages(workspaceRoot);

            // Resolve URLs for webview display
            const imagesForBrowser = allImages.map(img => ({
              path: img.relativePath,
              thumbnail: this.resolveImageUrlForWebview(panel.webview, img.relativePath, workspaceRoot),
              filename: path.basename(img.relativePath),
              folder: path.dirname(img.relativePath).substring(1) || '/'
            }));

            panel.webview.postMessage({
              type: 'workspaceImages',
              images: imagesForBrowser
            });
            break;
          }
```

With:

```typescript
          case 'openImageBrowser':
            await this.handleOpenImageBrowser(panel, workspaceRoot);
            break;
```

**Step 3: Update second usage in openWriterViewForField**

Find the `case 'openImageBrowser'` in `openWriterViewForField` (around line 1062) and replace with the same single line:

```typescript
          case 'openImageBrowser':
            await this.handleOpenImageBrowser(panel, workspaceRoot);
            break;
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "refactor(writerView): extract handleOpenImageBrowser method

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Create Shared Handler Method for addExistingImage

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add the shared handler method**

Add after `handleOpenImageBrowser`:

```typescript
  /**
   * Handle addExistingImage message from webview
   */
  private async handleAddExistingImage(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    workspaceRoot: string,
    imagePath: string
  ): Promise<void> {
    try {
      await this.addImagesToNode(documentUri, node, [{
        url: imagePath,
        caption: '',
        featured: !node.images || node.images.length === 0
      }]);

      // Re-read node to get updated images
      const text = fs.readFileSync(documentUri.fsPath, 'utf-8');
      const parsedDoc = isMarkdownFile(documentUri.fsPath)
        ? parseMarkdownAsCodex(text, documentUri.fsPath)
        : parseCodex(text);

      if (parsedDoc) {
        const updatedNode = parsedDoc.allNodes.find(n => n.id === node.id);
        if (updatedNode && updatedNode.images) {
          const newImage = updatedNode.images[updatedNode.images.length - 1];
          panel.webview.postMessage({
            type: 'imageAdded',
            image: {
              ...newImage,
              url: this.resolveImageUrlForWebview(panel.webview, newImage.url, workspaceRoot)
            }
          });
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add image: ${error}`);
    }
  }
```

**Step 2: Update first usage in openWriterView**

Replace the `case 'addExistingImage'` block (around line 563) with:

```typescript
          case 'addExistingImage':
            await this.handleAddExistingImage(panel, documentUri, node, workspaceRoot, message.imagePath);
            break;
```

**Step 3: Update second usage in openWriterViewForField**

Replace the `case 'addExistingImage'` block (around line 1081) with the same single line.

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "refactor(writerView): extract handleAddExistingImage method

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Create Shared Handler Method for importImage

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add the shared handler method**

Add after `handleAddExistingImage`:

```typescript
  /**
   * Handle importImage message from webview
   */
  private async handleImportImage(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    workspaceRoot: string
  ): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: {
        'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']
      },
      title: 'Select Images to Add'
    });

    if (result && result.length > 0) {
      try {
        const addedImages = await this.importImages(result, documentUri, node, workspaceRoot);

        const resolvedImages = addedImages.map(img => ({
          ...img,
          url: this.resolveImageUrlForWebview(panel.webview, img.url, workspaceRoot)
        }));

        panel.webview.postMessage({
          type: 'imagesAdded',
          images: resolvedImages
        });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to import images: ${error}`);
      }
    }
  }
```

**Step 2: Update both usages**

Replace both `case 'importImage'` blocks with:

```typescript
          case 'importImage':
            await this.handleImportImage(panel, documentUri, node, workspaceRoot);
            break;
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "refactor(writerView): extract handleImportImage method

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Create Shared Handler Method for deleteImage

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add the shared handler method**

Add after `handleImportImage`:

```typescript
  /**
   * Handle deleteImage message from webview
   */
  private async handleDeleteImage(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    url: string,
    index: number
  ): Promise<void> {
    try {
      const text = fs.readFileSync(documentUri.fsPath, 'utf-8');
      const doc = YAML.parseDocument(text);

      const targetNode = this.findNodeInYamlDoc(doc, node);
      if (!targetNode) {
        vscode.window.showErrorMessage('Could not find node in document');
        return;
      }

      const images = targetNode.get('images');
      if (!images || !YAML.isSeq(images)) {
        return;
      }

      // Find and remove image by URL
      const items = (images as YAML.YAMLSeq).items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (YAML.isMap(item)) {
          const itemUrl = item.get('url');
          if (itemUrl === url) {
            (images as YAML.YAMLSeq).delete(i);
            break;
          }
        }
      }

      // If no images left, remove the images key
      if ((images as YAML.YAMLSeq).items.length === 0) {
        targetNode.delete('images');
      }

      fs.writeFileSync(documentUri.fsPath, doc.toString());

      panel.webview.postMessage({ type: 'imageDeleted', url, index });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete image: ${error}`);
    }
  }
```

**Step 2: Update both usages**

Replace both `case 'deleteImage'` blocks with:

```typescript
          case 'deleteImage':
            await this.handleDeleteImage(panel, documentUri, node, message.url, message.index);
            break;
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "refactor(writerView): extract handleDeleteImage method

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Create Shared Handler Method for reorderImages

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add the shared handler method**

Add after `handleDeleteImage`:

```typescript
  /**
   * Handle reorderImages message from webview
   */
  private async handleReorderImages(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    order: string[]
  ): Promise<void> {
    try {
      const text = fs.readFileSync(documentUri.fsPath, 'utf-8');
      const doc = YAML.parseDocument(text);

      const targetNode = this.findNodeInYamlDoc(doc, node);
      if (!targetNode) {
        vscode.window.showErrorMessage('Could not find node in document');
        return;
      }

      const images = targetNode.get('images');
      if (!images || !YAML.isSeq(images)) {
        return;
      }

      // Create a map of URL to image node
      const imageMap = new Map<string, YAML.Node>();
      for (const item of (images as YAML.YAMLSeq).items) {
        if (YAML.isMap(item)) {
          const url = item.get('url') as string;
          if (url) {
            imageMap.set(url, item);
          }
        }
      }

      // Clear and rebuild in new order
      (images as YAML.YAMLSeq).items = [];
      for (const url of order) {
        const imgNode = imageMap.get(url);
        if (imgNode) {
          (images as YAML.YAMLSeq).add(imgNode);
        }
      }

      fs.writeFileSync(documentUri.fsPath, doc.toString());

      panel.webview.postMessage({ type: 'imagesReordered' });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reorder images: ${error}`);
    }
  }
```

**Step 2: Update both usages**

Replace both `case 'reorderImages'` blocks with:

```typescript
          case 'reorderImages':
            await this.handleReorderImages(panel, documentUri, node, message.order);
            break;
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "refactor(writerView): extract handleReorderImages method

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Convert scanWorkspaceImages to Async

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add fs.promises import**

At the top of the file, after the existing fs import (around line 6):

```typescript
import * as fs from 'fs';
```

Add this line after it:

```typescript
const fsPromises = fs.promises;
```

**Step 2: Replace the scanWorkspaceImages method**

Find the current `scanWorkspaceImages` method and replace it entirely with:

```typescript
  /**
   * Scan workspace for image files (async)
   */
  private async scanWorkspaceImages(workspaceRoot: string): Promise<{ relativePath: string; fullPath: string }[]> {
    const images: { relativePath: string; fullPath: string }[] = [];
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const skipDirs = ['node_modules', '.git', '.vscode', 'out', 'dist', 'build'];

    const scanDir = async (dir: string, depth: number = 0): Promise<void> => {
      if (depth > 5) return; // Limit recursion depth

      try {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Skip hidden and build directories
            if (!entry.name.startsWith('.') && !skipDirs.includes(entry.name)) {
              await scanDir(fullPath, depth + 1);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (imageExtensions.includes(ext)) {
              images.push({
                relativePath: '/' + path.relative(workspaceRoot, fullPath).replace(/\\/g, '/'),
                fullPath
              });
            }
          }
        }
      } catch (error) {
        // Skip inaccessible directories
      }
    };

    await scanDir(workspaceRoot);
    return images;
  }
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "refactor(writerView): convert scanWorkspaceImages to async

Uses fs.promises.readdir instead of fs.readdirSync to avoid
blocking the extension host during workspace scans.

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

**Step 4: Manual verification**

1. Open a codex file in Writer View
2. Click "Add Image" button
3. Verify browser modal opens with workspace images
4. Add an existing image
5. Import a new image
6. Delete an image
7. Reorder images via drag-drop
8. Verify all operations work correctly

**Step 5: Final commit**

```bash
git add -A
git commit -m "refactor: complete image handler extraction and async scanner

- Extracted 5 shared handler methods to eliminate duplication
- Converted workspace scanner to async for better performance
- Both openWriterView and openWriterViewForField now use shared methods

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Summary

| Before | After |
|--------|-------|
| 5 handlers duplicated in 2 places (~250 lines x 2) | 5 shared methods + 10 one-line calls |
| Sync `fs.readdirSync` blocking | Async `fs.promises.readdir` non-blocking |
| ~500 lines of duplicated code | ~250 lines of shared code |

**Files Modified:**
- `src/writerView/manager.ts` - Extract handlers, convert scanner to async
