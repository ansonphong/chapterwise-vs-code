# Add Images Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ability to add, delete, and reorder images on codex nodes with a hybrid browse/import modal.

**Architecture:**
- "Add Image" button opens a modal with two tabs: "Browse Workspace" (existing images) and "Import New" (file picker)
- Imported images are copied to a per-node `images/` subfolder next to the codex file
- Delete via trash button in image viewer modal, reorder via drag-drop in gallery
- All operations use YAML AST manipulation to preserve formatting

**Tech Stack:** TypeScript, VS Code Webview API, YAML AST (yaml library), VS Code file dialogs

---

## Task 0: Add Image Organization Setting

**Files:**
- Modify: `package.json:618` (after the colors settings)

**Step 1: Add the imageOrganization setting**

Find the colors settings section (around line 618) and add after it:

```json
        "chapterwiseCodex.images.organization": {
          "type": "string",
          "enum": ["perNode", "sharedWithNodeFolders"],
          "enumDescriptions": [
            "Images folder next to codex file (e.g., /characters/aya/images/portrait.png)",
            "Shared images folder with node subfolders (e.g., /characters/images/aya/portrait.png)"
          ],
          "default": "sharedWithNodeFolders",
          "description": "How imported images are organized in the workspace"
        },
```

**Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json'))"`
Expected: No errors

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add images.organization setting

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 1: Add "Add Image" Button to Gallery Header

**Files:**
- Modify: `src/writerView/html/builder.ts:152-161`

**Step 1: Update the images gallery header HTML**

Find this code (around line 152-161):
```typescript
  <!-- Images Gallery -->
  <div class="structured-editor" id="imagesEditor" ${!node.hasImages ? 'style="display: none;"' : ''}>
    <div class="structured-header">
      <span class="structured-title overview-section-header-inline" data-field="__images__">Images</span>
      <span class="images-count">${node.images?.length || 0} images</span>
    </div>
```

Replace with:
```typescript
  <!-- Images Gallery -->
  <div class="structured-editor" id="imagesEditor">
    <div class="structured-header">
      <span class="structured-title overview-section-header-inline" data-field="__images__">Images</span>
      <span class="images-count">${node.images?.length || 0} images</span>
      <button class="add-btn" id="addImageBtn">+ Add Image</button>
    </div>
```

Note: Removed the `style="display: none;"` condition so the section always shows (allows adding first image).

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/html/builder.ts
git commit -m "feat(writerView): add 'Add Image' button to gallery header

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Create Image Browser Modal Renderer

**Files:**
- Create: `src/writerView/html/imageBrowserRenderer.ts`

**Step 1: Create the new file with full content**

```typescript
/**
 * Renders image browser modal HTML for Writer View
 */

import { escapeHtml } from '../utils/helpers';

/**
 * Render the image browser modal with Browse Workspace and Import tabs
 */
export function renderImageBrowserModal(): string {
  return `
    <div class="image-browser-modal" id="imageBrowserModal" style="display: none;">
      <div class="modal-backdrop" id="browserBackdrop"></div>
      <div class="modal-content image-browser-content">
        <div class="browser-header">
          <h3>Add Image</h3>
          <button class="modal-close" id="browserClose" title="Close (Escape)">×</button>
        </div>
        <div class="browser-tabs">
          <button class="tab-btn active" id="tabWorkspace" data-tab="workspace">Browse Workspace</button>
          <button class="tab-btn" id="tabImport" data-tab="import">Import New</button>
        </div>
        <div class="browser-tab-content" id="workspaceTab">
          <div class="browser-search-container">
            <input type="text" class="image-search" id="imageSearch" placeholder="Search images..." />
          </div>
          <div class="image-browser-grid" id="imageBrowserGrid">
            <div class="browser-loading">Scanning workspace for images...</div>
          </div>
        </div>
        <div class="browser-tab-content" id="importTab" style="display: none;">
          <div class="import-content">
            <div class="import-icon">📁</div>
            <p class="import-text">Import an image from your computer</p>
            <button class="import-btn" id="importFromDiskBtn">Choose File...</button>
            <p class="import-hint">Image will be copied to the node's images folder</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a single image item for the browser grid
 */
export function renderBrowserImageItem(imagePath: string, thumbnailUrl: string, filename: string, folder: string): string {
  return `
    <div class="browser-image-item" data-path="${escapeHtml(imagePath)}" title="${escapeHtml(imagePath)}">
      <img src="${thumbnailUrl}" alt="${escapeHtml(filename)}" loading="lazy" />
      <div class="browser-image-name">${escapeHtml(filename)}</div>
      <div class="browser-image-folder">${escapeHtml(folder)}</div>
    </div>
  `;
}
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/html/imageBrowserRenderer.ts
git commit -m "feat(writerView): create image browser modal renderer

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add Image Browser Modal Styles

**Files:**
- Modify: `src/writerView/styles.ts:1391` (after `#imagesEditor { display: none; }`)

**Step 1: Add the image browser modal CSS**

Find this line (around line 1391):
```typescript
    #imagesEditor {
      display: none;
    }
```

Add after it:
```typescript

    /* === IMAGE BROWSER MODAL === */

    .image-browser-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1001;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .image-browser-content {
      position: relative;
      width: 90%;
      max-width: 800px;
      max-height: 80vh;
      background: var(--bg-primary);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }

    .browser-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
    }

    .browser-header h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .browser-tabs {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      padding: 0 16px;
    }

    .tab-btn {
      padding: 12px 20px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: 0.9rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color 0.15s, border-color 0.15s;
    }

    .tab-btn:hover {
      color: var(--text-primary);
    }

    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .browser-tab-content {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .browser-search-container {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .image-search {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 0.9rem;
    }

    .image-search:focus {
      outline: none;
      border-color: var(--accent);
    }

    .image-browser-grid {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
      align-content: start;
    }

    .browser-loading {
      grid-column: 1 / -1;
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
      font-style: italic;
    }

    .browser-empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
    }

    .browser-image-item {
      cursor: pointer;
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg-secondary);
      transition: transform 0.15s, box-shadow 0.15s;
      border: 2px solid transparent;
    }

    .browser-image-item:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      border-color: var(--accent);
    }

    .browser-image-item img {
      width: 100%;
      height: 100px;
      object-fit: cover;
      display: block;
    }

    .browser-image-name {
      padding: 6px 8px 2px;
      font-size: 0.75rem;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .browser-image-folder {
      padding: 0 8px 6px;
      font-size: 0.65rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Import Tab */
    .import-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      text-align: center;
    }

    .import-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }

    .import-text {
      color: var(--text-primary);
      margin-bottom: 1.5rem;
      font-size: 1rem;
    }

    .import-btn {
      padding: 12px 24px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .import-btn:hover {
      background: var(--accent-hover);
    }

    .import-hint {
      margin-top: 1rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/styles.ts
git commit -m "feat(writerView): add image browser modal styles

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Integrate Browser Modal into HTML Builder

**Files:**
- Modify: `src/writerView/html/builder.ts:12` (imports)
- Modify: `src/writerView/html/builder.ts:226` (before renderImageModal call)

**Step 1: Add import for renderImageBrowserModal**

Find this line (around line 12):
```typescript
import { renderImagesGallery, renderImagesFullGallery, renderImageModal } from './imagesRenderer';
```

Replace with:
```typescript
import { renderImagesGallery, renderImagesFullGallery, renderImageModal } from './imagesRenderer';
import { renderImageBrowserModal } from './imageBrowserRenderer';
```

**Step 2: Add the browser modal to HTML output**

Find this line (around line 226):
```typescript
  ${renderImageModal()}
```

Replace with:
```typescript
  ${renderImageModal()}
  ${renderImageBrowserModal()}
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/html/builder.ts
git commit -m "feat(writerView): integrate image browser modal into HTML

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Add Workspace Image Scanner to Manager

**Files:**
- Modify: `src/writerView/manager.ts` (add new private method after `findNodeInYamlDoc`)

**Step 1: Add the scanWorkspaceImages method**

Find the `findNodeInYamlDoc` method (around line 1292-1316) and add after it:

```typescript
  /**
   * Scan workspace for image files
   */
  private async scanWorkspaceImages(workspaceRoot: string): Promise<{ relativePath: string; fullPath: string }[]> {
    const images: { relativePath: string; fullPath: string }[] = [];
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const skipDirs = ['node_modules', '.git', '.vscode', 'out', 'dist', 'build'];

    const scanDir = (dir: string, depth: number = 0) => {
      if (depth > 5) return; // Limit recursion depth

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Skip hidden and build directories
            if (!entry.name.startsWith('.') && !skipDirs.includes(entry.name)) {
              scanDir(fullPath, depth + 1);
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

    scanDir(workspaceRoot);
    return images;
  }
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): add workspace image scanner

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Add Image Browser Message Handlers

**Files:**
- Modify: `src/writerView/manager.ts:541` (in the switch statement, after `updateImageCaption` case)

**Step 1: Add the openImageBrowser handler**

Find the closing `}` of the `updateImageCaption` case (around line 541):
```typescript
            break;
          }
        }
```

Add before the closing `}`:
```typescript
            break;
          }

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

          case 'addExistingImage': {
            const { imagePath } = message;

            try {
              await this.addImagesToNode(documentUri, node, [{
                url: imagePath,
                caption: '',
                featured: false
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
            break;
          }

          case 'importImage': {
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

                // Resolve URLs for the added images
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
            break;
          }
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: Error - `importImages` and `addImagesToNode` don't exist yet (we'll add them in the next tasks)

**Step 3: Comment out the method calls temporarily**

Replace the handlers with stub versions that we'll complete in later tasks:
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

          case 'addExistingImage': {
            // TODO: Implement in Task 8
            vscode.window.showInformationMessage('Add existing image - coming soon');
            break;
          }

          case 'importImage': {
            // TODO: Implement in Task 7
            vscode.window.showInformationMessage('Import image - coming soon');
            break;
          }
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): add image browser message handlers (stubs)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Implement Image Import Logic

**Files:**
- Modify: `src/writerView/manager.ts` (add new private method and update `importImage` handler)

**Step 1: Add helper to get images directory based on setting**

Add after the `scanWorkspaceImages` method:

```typescript
  /**
   * Get the target images directory based on user settings
   */
  private getImagesDirectory(documentUri: vscode.Uri, node: CodexNode, workspaceRoot: string): string {
    const config = vscode.workspace.getConfiguration('chapterwiseCodex');
    const organization = config.get<string>('images.organization', 'sharedWithNodeFolders');

    const codexDir = path.dirname(documentUri.fsPath);
    const nodeName = node.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || node.id;

    if (organization === 'perNode') {
      // /characters/aya/images/portrait.png
      return path.join(codexDir, 'images');
    } else {
      // /characters/images/aya/portrait.png (sharedWithNodeFolders - default)
      const parentDir = path.dirname(codexDir);
      return path.join(parentDir, 'images', nodeName);
    }
  }
```

**Step 2: Add the importImages method**

Add after the `getImagesDirectory` method:

```typescript
  /**
   * Import images from file picker and copy to node's images folder
   */
  private async importImages(
    files: vscode.Uri[],
    documentUri: vscode.Uri,
    node: CodexNode,
    workspaceRoot: string
  ): Promise<CodexImage[]> {
    const addedImages: CodexImage[] = [];

    // Get target folder based on setting
    const imagesDir = this.getImagesDirectory(documentUri, node, workspaceRoot);

    // Create images folder if needed
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    for (const file of files) {
      let targetPath: string;
      let filename = path.basename(file.fsPath);

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
          addedImages.push({ url: relativePath, caption: '', featured: addedImages.length === 0 });
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
        featured: addedImages.length === 0 // First image is featured
      });
    }

    // Add images to the node's YAML
    if (addedImages.length > 0) {
      await this.addImagesToNode(documentUri, node, addedImages);
    }

    return addedImages;
  }
```

**Step 2: Update the importImage handler**

Replace the stub handler with:
```typescript
          case 'importImage': {
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

                // Resolve URLs for the added images
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
            break;
          }
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: Error - `addImagesToNode` doesn't exist yet (we'll add it in the next task)

**Step 4: Create a stub for addImagesToNode**

Add a temporary stub method:
```typescript
  /**
   * Add images to node's YAML - TODO: implement in Task 8
   */
  private async addImagesToNode(
    documentUri: vscode.Uri,
    node: CodexNode,
    newImages: CodexImage[]
  ): Promise<void> {
    // Stub - will be implemented in Task 8
    console.log('addImagesToNode called with', newImages.length, 'images');
  }
```

**Step 5: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 6: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): implement image import with copy logic

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Implement YAML Image Array Update Logic

**Files:**
- Modify: `src/writerView/manager.ts` (replace the `addImagesToNode` stub)

**Step 1: Replace the addImagesToNode stub with full implementation**

Replace the stub with:
```typescript
  /**
   * Add images to node's YAML array
   */
  private async addImagesToNode(
    documentUri: vscode.Uri,
    node: CodexNode,
    newImages: CodexImage[]
  ): Promise<void> {
    const text = fs.readFileSync(documentUri.fsPath, 'utf-8');
    const doc = YAML.parseDocument(text);

    // Find the node in the document
    const targetNode = this.findNodeInYamlDoc(doc, node);
    if (!targetNode) {
      throw new Error('Could not find node in document');
    }

    // Get or create images array
    let images = targetNode.get('images');
    if (!images || !YAML.isSeq(images)) {
      images = doc.createNode([]);
      targetNode.set('images', images);
    }

    // Add new images
    for (const img of newImages) {
      const imgObj: Record<string, unknown> = { url: img.url };
      if (img.caption) imgObj.caption = img.caption;
      if (img.alt) imgObj.alt = img.alt;
      if (img.featured) imgObj.featured = img.featured;

      const imgNode = doc.createNode(imgObj);
      (images as YAML.YAMLSeq).add(imgNode);
    }

    // Write back
    fs.writeFileSync(documentUri.fsPath, doc.toString());
  }
```

**Step 2: Update the addExistingImage handler**

Replace the stub with:
```typescript
          case 'addExistingImage': {
            const { imagePath } = message;

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
            break;
          }
```

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): implement YAML image array update logic

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Add Webview Script Handlers for Browser Modal

**Files:**
- Modify: `src/writerView/script.ts:1285` (after the caption edit handler)

**Step 1: Add the browser modal handlers**

Find the caption edit handler closing brace (around line 1285):
```typescript
    }
```

Add after it:
```typescript

    // === IMAGE BROWSER MODAL HANDLERS ===

    const imageBrowserModal = document.getElementById('imageBrowserModal');
    const browserBackdrop = document.getElementById('browserBackdrop');
    const browserClose = document.getElementById('browserClose');
    const tabWorkspace = document.getElementById('tabWorkspace');
    const tabImport = document.getElementById('tabImport');
    const workspaceTab = document.getElementById('workspaceTab');
    const importTab = document.getElementById('importTab');
    const imageSearch = document.getElementById('imageSearch');
    const imageBrowserGrid = document.getElementById('imageBrowserGrid');
    const importFromDiskBtn = document.getElementById('importFromDiskBtn');
    const addImageBtn = document.getElementById('addImageBtn');

    let allWorkspaceImages = [];

    function openBrowserModal() {
      if (imageBrowserModal) {
        imageBrowserModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        // Request workspace images
        vscode.postMessage({ type: 'openImageBrowser' });
      }
    }

    function closeBrowserModal() {
      if (imageBrowserModal) {
        imageBrowserModal.style.display = 'none';
        document.body.style.overflow = '';
      }
    }

    function switchTab(tab) {
      if (tab === 'workspace') {
        tabWorkspace?.classList.add('active');
        tabImport?.classList.remove('active');
        if (workspaceTab) workspaceTab.style.display = 'flex';
        if (importTab) importTab.style.display = 'none';
      } else {
        tabWorkspace?.classList.remove('active');
        tabImport?.classList.add('active');
        if (workspaceTab) workspaceTab.style.display = 'none';
        if (importTab) importTab.style.display = 'flex';
      }
    }

    function renderWorkspaceImages(images) {
      if (!imageBrowserGrid) return;

      if (images.length === 0) {
        imageBrowserGrid.innerHTML = '<div class="browser-empty">No images found in workspace</div>';
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

    function filterImages(query) {
      const filtered = allWorkspaceImages.filter(img =>
        img.filename.toLowerCase().includes(query.toLowerCase()) ||
        img.folder.toLowerCase().includes(query.toLowerCase())
      );
      renderWorkspaceImages(filtered);
    }

    // Add Image button click
    if (addImageBtn) {
      addImageBtn.addEventListener('click', openBrowserModal);
    }

    // Close browser modal
    if (browserClose) {
      browserClose.addEventListener('click', closeBrowserModal);
    }
    if (browserBackdrop) {
      browserBackdrop.addEventListener('click', closeBrowserModal);
    }

    // Tab switching
    if (tabWorkspace) {
      tabWorkspace.addEventListener('click', () => switchTab('workspace'));
    }
    if (tabImport) {
      tabImport.addEventListener('click', () => switchTab('import'));
    }

    // Search filter
    if (imageSearch) {
      imageSearch.addEventListener('input', (e) => {
        filterImages(e.target.value);
      });
    }

    // Import from disk button
    if (importFromDiskBtn) {
      importFromDiskBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importImage' });
      });
    }

    // Click on workspace image to add it
    if (imageBrowserGrid) {
      imageBrowserGrid.addEventListener('click', (e) => {
        const item = e.target.closest('.browser-image-item');
        if (item) {
          const imagePath = item.dataset.path;
          vscode.postMessage({ type: 'addExistingImage', imagePath });
        }
      });
    }

    // Keyboard: Escape to close browser modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && imageBrowserModal && imageBrowserModal.style.display === 'flex') {
        closeBrowserModal();
      }
    });
```

**Step 2: Add message handlers for browser responses**

Find the message handler switch statement (around line 1078-1159) and add these cases:

```typescript
        case 'workspaceImages':
          allWorkspaceImages = message.images || [];
          renderWorkspaceImages(allWorkspaceImages);
          break;

        case 'imageAdded':
          if (message.image) {
            localImages.push(message.image);
            updateImagesGallery();
            closeBrowserModal();
          }
          break;

        case 'imagesAdded':
          if (message.images && message.images.length > 0) {
            localImages.push(...message.images);
            updateImagesGallery();
            closeBrowserModal();
          }
          break;
```

**Step 3: Add the updateImagesGallery function**

Add after the browser modal handlers:

```typescript
    // Update images gallery display
    function updateImagesGallery() {
      const imagesContainer = document.getElementById('imagesContainer');
      const imagesCount = document.querySelector('.images-count');
      const imagesEditor = document.getElementById('imagesEditor');

      if (imagesContainer) {
        if (localImages.length === 0) {
          imagesContainer.innerHTML = '<div class="images-empty">No images</div>';
        } else {
          imagesContainer.innerHTML = \`<div class="images-grid">\${localImages.map((img, index) => \`
            <div class="image-thumbnail" data-index="\${index}" data-url="\${img.url}">
              \${img.featured ? '<span class="featured-badge">★</span>' : ''}
              <img src="\${img.url}" alt="\${img.alt || img.caption || 'Image'}" loading="lazy" />
              <div class="thumbnail-caption" title="\${img.caption || ''}">\${img.caption || '&nbsp;'}</div>
            </div>
          \`).join('')}</div>\`;
        }
      }

      if (imagesCount) {
        imagesCount.textContent = \`\${localImages.length} images\`;
      }

      // Show images section if it was hidden
      if (imagesEditor) {
        imagesEditor.style.display = '';
      }
    }
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/script.ts
git commit -m "feat(writerView): add image browser script handlers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Add Delete Image Functionality

**Files:**
- Modify: `src/writerView/html/imagesRenderer.ts:73-76` (add delete button to modal)
- Modify: `src/writerView/styles.ts` (add delete button styles)
- Modify: `src/writerView/script.ts` (add delete handler)
- Modify: `src/writerView/manager.ts` (add deleteImage message handler)

**Step 1: Add delete button to image modal**

In `src/writerView/html/imagesRenderer.ts`, find the modal-caption-container (line 73-75):
```typescript
        <div class="modal-caption-container">
          <label for="modalCaption">Caption:</label>
          <input type="text" id="modalCaption" class="modal-caption-input" placeholder="Add a caption..." />
        </div>
```

Replace with:
```typescript
        <div class="modal-caption-container">
          <label for="modalCaption">Caption:</label>
          <input type="text" id="modalCaption" class="modal-caption-input" placeholder="Add a caption..." />
          <button class="modal-delete-btn" id="modalDelete" title="Delete image">🗑</button>
        </div>
```

**Step 2: Add delete button styles**

In `src/writerView/styles.ts`, find `.modal-caption-input::placeholder` (around line 1341) and add after it:

```typescript

    .modal-delete-btn {
      padding: 8px 12px;
      background: rgba(255, 100, 100, 0.2);
      border: 1px solid rgba(255, 100, 100, 0.4);
      border-radius: 4px;
      color: #ff6b6b;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }

    .modal-delete-btn:hover {
      background: rgba(255, 100, 100, 0.3);
      border-color: rgba(255, 100, 100, 0.6);
    }
```

**Step 3: Add delete handler to script.ts**

In `src/writerView/script.ts`, after the modalCaption handler (around line 1285), add:

```typescript
    // Delete image button
    const modalDelete = document.getElementById('modalDelete');
    if (modalDelete) {
      modalDelete.addEventListener('click', async () => {
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

Add message handler case:
```typescript
        case 'imageDeleted':
          // Remove from local array
          const deleteIndex = message.index;
          if (deleteIndex >= 0 && deleteIndex < localImages.length) {
            localImages.splice(deleteIndex, 1);
            updateImagesGallery();
            closeImageModal();
          }
          break;
```

**Step 4: Add deleteImage handler in manager.ts**

In the message handler switch statement, add:

```typescript
          case 'deleteImage': {
            const { url, index } = message;

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
            break;
          }
```

**Step 5: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 6: Commit**

```bash
git add src/writerView/html/imagesRenderer.ts src/writerView/styles.ts src/writerView/script.ts src/writerView/manager.ts
git commit -m "feat(writerView): add delete image functionality

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Add Reorder Images Functionality

**Files:**
- Modify: `src/writerView/script.ts` (add drag handlers)
- Modify: `src/writerView/styles.ts` (add drag styling)
- Modify: `src/writerView/manager.ts` (add reorderImages handler)

**Step 1: Add drag-drop styles**

In `src/writerView/styles.ts`, add after the image browser modal styles:

```typescript

    /* === DRAG AND DROP REORDER === */

    .image-thumbnail[draggable="true"],
    .gallery-item[draggable="true"] {
      cursor: grab;
    }

    .image-thumbnail.dragging,
    .gallery-item.dragging {
      opacity: 0.5;
      cursor: grabbing;
    }

    .image-thumbnail.drag-over,
    .gallery-item.drag-over {
      border: 2px dashed var(--accent);
      transform: scale(1.02);
    }
```

**Step 2: Add drag handlers to script.ts**

In `src/writerView/script.ts`, add after the `updateImagesGallery` function:

```typescript
    // === DRAG AND DROP REORDER ===

    let draggedIndex = null;

    function initDragHandlers() {
      const thumbnails = document.querySelectorAll('.image-thumbnail, .gallery-item');

      thumbnails.forEach((thumb, index) => {
        thumb.setAttribute('draggable', 'true');

        thumb.addEventListener('dragstart', (e) => {
          draggedIndex = index;
          thumb.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        thumb.addEventListener('dragend', () => {
          thumb.classList.remove('dragging');
          draggedIndex = null;
          // Remove all drag-over states
          document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        thumb.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          thumb.classList.add('drag-over');
        });

        thumb.addEventListener('dragleave', () => {
          thumb.classList.remove('drag-over');
        });

        thumb.addEventListener('drop', (e) => {
          e.preventDefault();
          thumb.classList.remove('drag-over');

          const dropIndex = index;
          if (draggedIndex !== null && draggedIndex !== dropIndex) {
            // Reorder local array
            const [removed] = localImages.splice(draggedIndex, 1);
            localImages.splice(dropIndex, 0, removed);

            // Update display
            updateImagesGallery();
            initDragHandlers(); // Re-init handlers for new elements

            // Save new order
            const newOrder = localImages.map(img => img.url);
            vscode.postMessage({ type: 'reorderImages', order: newOrder });
          }
        });
      });
    }

    // Initialize drag handlers after gallery updates
    const originalUpdateImagesGallery = updateImagesGallery;
    updateImagesGallery = function() {
      originalUpdateImagesGallery();
      initDragHandlers();
    };

    // Initial drag handler setup
    initDragHandlers();
```

Add message handler case:
```typescript
        case 'imagesReordered':
          // Order saved successfully
          imagesDirty = false;
          checkAllClean();
          break;
```

**Step 3: Add reorderImages handler in manager.ts**

In the message handler switch statement, add:

```typescript
          case 'reorderImages': {
            const { order } = message; // Array of URLs in new order

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
            break;
          }
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/script.ts src/writerView/styles.ts src/writerView/manager.ts
git commit -m "feat(writerView): add drag-to-reorder images

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Duplicate Handlers for openWriterViewForField

**Files:**
- Modify: `src/writerView/manager.ts` (duplicate message handlers in second location)

**Step 1: Find the openWriterViewForField message handler**

The `openWriterViewForField` method has its own message handler switch statement (around line 788-833). Add the same handlers there:

Add these cases after the existing `updateImageCaption` case in `openWriterViewForField`:

```typescript
          case 'openImageBrowser':
          case 'addExistingImage':
          case 'importImage':
          case 'deleteImage':
          case 'reorderImages':
            // These handlers are identical to openWriterView
            // Forward to the same handler logic
            // (Copy the handler implementations from Task 6, 8, 10, 11)
```

Note: This is code duplication. In a future refactor, extract these handlers to a shared method.

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): add image handlers to openWriterViewForField

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: Final Integration Test

**Step 1: Build and package extension**

Run:
```bash
npm run compile && npx vsce package
```
Expected: Creates `chapterwise-codex-0.3.0.vsix`

**Step 2: Install extension**

Run:
```bash
code --install-extension chapterwise-codex-0.3.0.vsix --force
```

**Step 3: Reload VS Code**

Press: `Cmd+Shift+P` → "Developer: Reload Window"

**Step 4: Test Add Image - Browse Workspace**

1. Open a codex file with a node in Writer View
2. Select "Overview" from field dropdown
3. Click "+ Add Image" button
4. Modal opens with "Browse Workspace" tab active
5. Images from workspace appear in grid
6. Type in search box to filter
7. Click an image
8. Image added to gallery
9. Modal closes

**Step 5: Test Add Image - Import New**

1. Click "+ Add Image" again
2. Click "Import New" tab
3. Click "Choose File..." button
4. Select an image from outside workspace
5. Image copied to `images/` subfolder next to codex file
6. Image appears in gallery

**Step 6: Test Delete Image**

1. Click on an image thumbnail
2. Image modal opens
3. Click trash button
4. Confirm deletion
5. Image removed from gallery
6. Check YAML file - image removed from array

**Step 7: Test Reorder Images**

1. Ensure node has 3+ images
2. Drag first image to last position
3. Gallery updates
4. Check YAML file - order changed

**Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete add/delete/reorder images implementation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Files Summary

| File | Changes |
|------|---------|
| `package.json` | Add `images.organization` setting |
| `src/writerView/html/builder.ts` | Add button, integrate browser modal |
| `src/writerView/html/imageBrowserRenderer.ts` | NEW - Browser modal HTML |
| `src/writerView/html/imagesRenderer.ts` | Add delete button to viewer modal |
| `src/writerView/styles.ts` | Browser modal + delete + drag styles |
| `src/writerView/script.ts` | Browser handlers, delete, drag-drop, gallery update |
| `src/writerView/manager.ts` | Scanner, import, add, delete, reorder handlers, getImagesDirectory |

---

## Folder Structure After Implementation

When user imports an image to `characters/aya.codex.yaml`:
```
characters/
  aya.codex.yaml
  images/           ← Created automatically
    portrait.png    ← Copied here
```

YAML result:
```yaml
images:
  - url: "/characters/images/portrait.png"
    caption: ""
    featured: true
```
