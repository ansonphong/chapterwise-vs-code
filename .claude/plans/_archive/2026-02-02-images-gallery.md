# Images Gallery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an images gallery to Writer View that displays node images in overview mode with click-to-expand modal and editable captions.

**Architecture:** Extend CodexNode model to include images array, render thumbnail grid in overview mode (after Summary, before Attributes), show images field in tree view, open modal overlay for full-size viewing with caption editing, use patch-based saves that update only the changed caption in the YAML file.

**Tech Stack:** TypeScript, VS Code Webview API, YAML AST manipulation (yaml library), CSS Grid

---

## Task 1: Extend CodexNode Data Model

**Files:**
- Modify: `src/codexModel.ts`

**Step 1: Add CodexImage interface**

Add after line 68 (after CodexRelation interface):

```typescript
/**
 * Represents an image attached to a node
 */
export interface CodexImage {
  url: string;
  caption?: string;
  alt?: string;
  featured?: boolean;
}
```

**Step 2: Update CodexNode interface**

Add to CodexNode interface (around line 35, after `image?: string;`):

```typescript
  images?: CodexImage[];
  hasImages: boolean;
```

**Step 3: Commit**

```bash
git add src/codexModel.ts
git commit -m "feat(codexModel): add CodexImage interface and images field"
```

---

## Task 2: Update Parser to Extract Images

**Files:**
- Modify: `src/codexModel.ts`

**Step 1: Find the node creation code in parseCodexNode function**

Search for where `hasAttributes` and `hasContentSections` are set (around line 280-300).

**Step 2: Add images extraction**

Add after `hasContentSections` logic:

```typescript
    // Extract images
    const rawImages = data.images;
    let images: CodexImage[] | undefined;
    let hasImages = false;

    if (Array.isArray(rawImages) && rawImages.length > 0) {
      hasImages = true;
      images = rawImages.map((img: any) => ({
        url: typeof img === 'string' ? img : (img.url || ''),
        caption: img.caption,
        alt: img.alt,
        featured: img.featured,
      })).filter(img => img.url);
    }
```

**Step 3: Add images and hasImages to the returned node object**

In the return statement for the node, add:

```typescript
      images,
      hasImages,
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/codexModel.ts
git commit -m "feat(codexModel): parse images array from codex data"
```

---

## Task 3: Create Images Renderer

**Files:**
- Create: `src/writerView/html/imagesRenderer.ts`

**Step 1: Create the images renderer file**

```typescript
/**
 * Renders image gallery HTML for Writer View
 */

import { CodexImage } from '../../codexModel';
import { escapeHtml } from '../utils/helpers';

/**
 * Render thumbnail gallery for overview mode
 */
export function renderImagesGallery(images: CodexImage[], workspaceRoot: string): string {
  if (!images || images.length === 0) {
    return '<div class="images-empty">No images</div>';
  }

  const thumbnails = images.map((img, index) => {
    const resolvedUrl = resolveImageUrl(img.url, workspaceRoot);
    const caption = img.caption ? escapeHtml(img.caption) : '';
    const alt = img.alt ? escapeHtml(img.alt) : (img.caption ? escapeHtml(img.caption) : 'Image');
    const featuredBadge = img.featured ? '<span class="featured-badge">★</span>' : '';

    return `
      <div class="image-thumbnail" data-index="${index}" data-url="${escapeHtml(img.url)}">
        ${featuredBadge}
        <img src="${resolvedUrl}" alt="${alt}" loading="lazy" />
        <div class="thumbnail-caption" title="${caption}">${caption || '&nbsp;'}</div>
      </div>
    `;
  }).join('');

  return `<div class="images-grid">${thumbnails}</div>`;
}

/**
 * Render full-page gallery for images view mode
 */
export function renderImagesFullGallery(images: CodexImage[], workspaceRoot: string): string {
  if (!images || images.length === 0) {
    return '<div class="images-empty">No images attached to this node</div>';
  }

  const items = images.map((img, index) => {
    const resolvedUrl = resolveImageUrl(img.url, workspaceRoot);
    const caption = img.caption ? escapeHtml(img.caption) : '';
    const alt = img.alt ? escapeHtml(img.alt) : (img.caption ? escapeHtml(img.caption) : 'Image');
    const featuredBadge = img.featured ? '<span class="featured-badge">★</span>' : '';

    return `
      <div class="gallery-item" data-index="${index}" data-url="${escapeHtml(img.url)}">
        ${featuredBadge}
        <img src="${resolvedUrl}" alt="${alt}" loading="lazy" />
        <div class="gallery-caption" title="${caption}">${caption || 'No caption'}</div>
      </div>
    `;
  }).join('');

  return `<div class="images-full-gallery">${items}</div>`;
}

/**
 * Render modal overlay HTML (hidden by default)
 */
export function renderImageModal(): string {
  return `
    <div class="image-modal" id="imageModal" style="display: none;">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <button class="modal-close" id="modalClose" title="Close (Escape)">×</button>
        <div class="modal-counter" id="modalCounter">1 / 1</div>
        <div class="modal-image-container">
          <img id="modalImage" src="" alt="" />
        </div>
        <div class="modal-caption-container">
          <label for="modalCaption">Caption:</label>
          <input type="text" id="modalCaption" class="modal-caption-input" placeholder="Add a caption..." />
        </div>
        <button class="modal-nav modal-prev" id="modalPrev" title="Previous (←)">‹</button>
        <button class="modal-nav modal-next" id="modalNext" title="Next (→)">›</button>
      </div>
    </div>
  `;
}

/**
 * Resolve image URL relative to workspace root
 */
function resolveImageUrl(url: string, workspaceRoot: string): string {
  // If it's an absolute URL (http/https), use as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // For relative paths starting with /, resolve from workspace root
  // The webview needs a vscode-resource URL, but we'll handle that in the manager
  // For now, return a placeholder that will be replaced
  return `vscode-resource-placeholder:${url}`;
}
```

**Step 2: Commit**

```bash
git add src/writerView/html/imagesRenderer.ts
git commit -m "feat(writerView): add images renderer for gallery and modal"
```

---

## Task 4: Add Images Gallery Styles

**Files:**
- Modify: `src/writerView/styles.ts`

**Step 1: Add gallery grid styles**

Add after the existing overview mode styles (around line 1050):

```typescript
    /* === IMAGES GALLERY === */

    /* Thumbnail grid in overview mode */
    .images-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 12px;
      padding: 8px 0;
    }

    .image-thumbnail {
      position: relative;
      cursor: pointer;
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg-tertiary);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .image-thumbnail:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .image-thumbnail img {
      width: 100%;
      height: 120px;
      object-fit: cover;
      display: block;
    }

    .thumbnail-caption {
      padding: 6px 8px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: var(--bg-secondary);
    }

    .featured-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--accent-color);
      color: white;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      z-index: 1;
    }

    .images-empty {
      padding: 2rem;
      text-align: center;
      color: var(--text-muted);
      font-style: italic;
    }

    /* Full gallery view (images mode) */
    .images-full-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
      padding: 16px 0;
    }

    .gallery-item {
      position: relative;
      cursor: pointer;
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-tertiary);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .gallery-item:hover {
      transform: translateY(-3px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .gallery-item img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      display: block;
    }

    .gallery-caption {
      padding: 10px 12px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      background: var(--bg-secondary);
    }
```

**Step 2: Add modal overlay styles**

Add after the gallery styles:

```typescript
    /* === IMAGE MODAL === */

    .image-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
    }

    .modal-content {
      position: relative;
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .modal-close {
      position: absolute;
      top: -40px;
      right: 0;
      background: none;
      border: none;
      color: white;
      font-size: 2rem;
      cursor: pointer;
      padding: 8px;
      line-height: 1;
      opacity: 0.8;
      transition: opacity 0.15s;
    }

    .modal-close:hover {
      opacity: 1;
    }

    .modal-counter {
      position: absolute;
      top: -40px;
      left: 0;
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.9rem;
    }

    .modal-image-container {
      display: flex;
      align-items: center;
      justify-content: center;
      max-height: 70vh;
    }

    .modal-image-container img {
      max-width: 90vw;
      max-height: 70vh;
      object-fit: contain;
      border-radius: 4px;
    }

    .modal-caption-container {
      margin-top: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      max-width: 500px;
    }

    .modal-caption-container label {
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .modal-caption-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      font-size: 0.9rem;
    }

    .modal-caption-input:focus {
      outline: none;
      border-color: var(--accent-color);
      background: rgba(255, 255, 255, 0.15);
    }

    .modal-caption-input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    .modal-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: white;
      font-size: 2.5rem;
      padding: 16px 12px;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.15s, background 0.15s;
      border-radius: 4px;
    }

    .modal-nav:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.2);
    }

    .modal-prev {
      left: -60px;
    }

    .modal-next {
      right: -60px;
    }

    .modal-nav:disabled {
      opacity: 0.2;
      cursor: not-allowed;
    }
```

**Step 3: Add images editor section style for overview mode**

Add with the other overview mode styles:

```typescript
    /* Images section in overview mode */
    body.mode-overview #imagesEditor {
      display: block !important;
    }

    /* Images view mode */
    body.mode-images #imagesEditor {
      display: block !important;
      width: 100%;
      max-width: 900px;
      margin: 2rem auto;
    }

    #imagesEditor {
      display: none;
    }
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/styles.ts
git commit -m "feat(writerView): add images gallery and modal styles"
```

---

## Task 5: Update HTML Builder with Images Section

**Files:**
- Modify: `src/writerView/html/builder.ts`

**Step 1: Add imports**

Add at the top with other imports:

```typescript
import { renderImagesGallery, renderImagesFullGallery, renderImageModal } from './imagesRenderer';
```

**Step 2: Update WebviewHtmlOptions interface**

Add to the interface:

```typescript
  /** Resolved image URLs for webview */
  imageUrls?: Record<string, string>;
```

**Step 3: Add images section in HTML**

In the `buildWebviewHtml` function, find the summary editor section and add after it (before attributes editor):

```typescript
  <!-- Images Gallery -->
  <div class="structured-editor" id="imagesEditor" ${!node.hasImages ? 'style="display: none;"' : ''}>
    <div class="structured-header">
      <span class="structured-title overview-section-header-inline" data-field="__images__">Images</span>
      <span class="images-count">${node.images?.length || 0} images</span>
    </div>
    <div id="imagesContainer">
      ${node.hasImages ? renderImagesGallery(node.images || [], workspaceRoot) : ''}
    </div>
  </div>
```

**Step 4: Add modal to the HTML**

Add before the closing `</body>` tag:

```typescript
  ${renderImageModal()}
```

**Step 5: Update field selector to include images option**

In `buildFieldSelectorOptions` function, add after content sections option:

```typescript
    // Add images option if node has images
    if (node.hasImages && node.images && node.images.length > 0) {
      options.push(`<option value="__images__" ${initialField === '__images__' ? 'selected' : ''}>🖼 images (${node.images.length})</option>`);
    }
```

**Step 6: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 7: Commit**

```bash
git add src/writerView/html/builder.ts
git commit -m "feat(writerView): add images gallery section to HTML builder"
```

---

## Task 6: Add Images Script Handlers

**Files:**
- Modify: `src/writerView/script.ts`

**Step 1: Add images state variables**

Add after the other dirty state variables (around line 35):

```typescript
    // Images state
    let localImages = ${JSON.stringify(node.images || [])};
    let imagesDirty = false;
    let currentModalIndex = 0;
```

**Step 2: Update updateDirtyIndicator**

Update the `anyDirty` check to include `imagesDirty`:

```typescript
    function updateDirtyIndicator() {
      const anyDirty = isDirty || attributesDirty || contentSectionsDirty || summaryDirty || bodyDirty || imagesDirty;
```

**Step 3: Update markClean**

Add `imagesDirty = false;` to the markClean function.

**Step 4: Add modal handlers**

Add after the existing event handlers (before the final initialization code):

```typescript
    // === IMAGE MODAL HANDLERS ===

    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalCaption = document.getElementById('modalCaption');
    const modalCounter = document.getElementById('modalCounter');
    const modalClose = document.getElementById('modalClose');
    const modalPrev = document.getElementById('modalPrev');
    const modalNext = document.getElementById('modalNext');
    const modalBackdrop = imageModal?.querySelector('.modal-backdrop');

    function openImageModal(index) {
      if (!localImages || index < 0 || index >= localImages.length) return;

      currentModalIndex = index;
      const img = localImages[index];

      // Resolve URL for display
      const resolvedUrl = resolveImageUrl(img.url);

      modalImage.src = resolvedUrl;
      modalImage.alt = img.alt || img.caption || 'Image';
      modalCaption.value = img.caption || '';
      modalCounter.textContent = \`\${index + 1} / \${localImages.length}\`;

      // Update nav button states
      modalPrev.disabled = index === 0;
      modalNext.disabled = index === localImages.length - 1;

      imageModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function closeImageModal() {
      imageModal.style.display = 'none';
      document.body.style.overflow = '';
    }

    function navigateModal(direction) {
      const newIndex = currentModalIndex + direction;
      if (newIndex >= 0 && newIndex < localImages.length) {
        openImageModal(newIndex);
      }
    }

    function resolveImageUrl(url) {
      // URLs are resolved by the manager, just return as-is for now
      // The manager replaces vscode-resource-placeholder with actual URLs
      return url.replace('vscode-resource-placeholder:', '');
    }

    // Thumbnail click handler
    document.addEventListener('click', (e) => {
      const thumbnail = e.target.closest('.image-thumbnail, .gallery-item');
      if (thumbnail) {
        const index = parseInt(thumbnail.dataset.index, 10);
        openImageModal(index);
      }
    });

    // Modal close handlers
    if (modalClose) {
      modalClose.addEventListener('click', closeImageModal);
    }
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', closeImageModal);
    }

    // Modal navigation
    if (modalPrev) {
      modalPrev.addEventListener('click', () => navigateModal(-1));
    }
    if (modalNext) {
      modalNext.addEventListener('click', () => navigateModal(1));
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (imageModal && imageModal.style.display === 'flex') {
        if (e.key === 'Escape') {
          closeImageModal();
        } else if (e.key === 'ArrowLeft') {
          navigateModal(-1);
        } else if (e.key === 'ArrowRight') {
          navigateModal(1);
        }
      }
    });

    // Caption edit handler
    if (modalCaption) {
      modalCaption.addEventListener('change', (e) => {
        const newCaption = e.target.value.trim();
        const img = localImages[currentModalIndex];

        if (img && img.caption !== newCaption) {
          img.caption = newCaption || undefined;
          imagesDirty = true;
          updateDirtyIndicator();

          // Update thumbnail caption if visible
          const thumbnail = document.querySelector(\`.image-thumbnail[data-index="\${currentModalIndex}"] .thumbnail-caption\`);
          if (thumbnail) {
            thumbnail.textContent = newCaption || ' ';
            thumbnail.title = newCaption || '';
          }

          // Send patch update to save
          vscode.postMessage({
            type: 'updateImageCaption',
            url: img.url,
            caption: newCaption
          });
        }
      });
    }
```

**Step 5: Add images view mode handling**

In the field selector change handler, add handling for `__images__`:

```typescript
      } else if (newField === '__images__') {
        showEditor('images');
        currentEditorMode = 'images';
      }
```

**Step 6: Update showEditor function**

Add images mode handling:

```typescript
    function showEditor(editorType) {
      document.body.classList.remove('mode-prose', 'mode-structured', 'mode-overview', 'mode-images');

      if (editorType === 'overview') {
        document.body.classList.add('mode-overview');
      } else if (editorType === 'images') {
        document.body.classList.add('mode-images');
      } else if (editorType === 'attributes' || editorType === 'content') {
        // ... existing code
      }
    }
```

**Step 7: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 8: Commit**

```bash
git add src/writerView/script.ts
git commit -m "feat(writerView): add image modal and caption editing handlers"
```

---

## Task 7: Update Manager to Handle Image Saves

**Files:**
- Modify: `src/writerView/manager.ts`

**Step 1: Add YAML import if not present**

```typescript
import * as YAML from 'yaml';
```

**Step 2: Add updateImageCaption message handler**

In the webview message handler switch statement, add:

```typescript
        case 'updateImageCaption': {
          const { url, caption } = message;

          try {
            // Read fresh file content
            const text = fs.readFileSync(documentUri.fsPath, 'utf-8');
            const doc = YAML.parseDocument(text);

            // Find the node in the document (handle nested nodes)
            const targetNode = this.findNodeInYamlDoc(doc, node);
            if (!targetNode) {
              vscode.window.showErrorMessage('Could not find node in document');
              return;
            }

            // Find images array
            const images = targetNode.get('images');
            if (!images || !YAML.isSeq(images)) {
              return;
            }

            // Find image by URL
            for (const item of images.items) {
              if (YAML.isMap(item)) {
                const itemUrl = item.get('url');
                if (itemUrl === url) {
                  if (caption) {
                    item.set('caption', caption);
                  } else {
                    item.delete('caption');
                  }
                  break;
                }
              }
            }

            // Write back
            fs.writeFileSync(documentUri.fsPath, doc.toString());

            // Confirm save
            panel.webview.postMessage({ type: 'imageCaptionSaved', url });
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to save caption: ${error}`);
          }
          break;
        }
```

**Step 3: Add helper method to find node in YAML document**

Add as a method in the WriterViewManager class:

```typescript
  /**
   * Find a node in a YAML document by ID
   */
  private findNodeInYamlDoc(doc: YAML.Document, node: CodexNode): YAML.YAMLMap | null {
    // If node is root, return document contents
    if (!node.parent || node.path.length === 0) {
      const contents = doc.contents;
      if (YAML.isMap(contents)) {
        return contents;
      }
      return null;
    }

    // Otherwise, traverse by path
    let current: any = doc.contents;

    for (const segment of node.path) {
      if (YAML.isMap(current)) {
        current = current.get(segment);
      } else if (YAML.isSeq(current) && typeof segment === 'number') {
        current = current.get(segment);
      } else {
        return null;
      }
    }

    return YAML.isMap(current) ? current : null;
  }
```

**Step 4: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/writerView/manager.ts
git commit -m "feat(writerView): handle updateImageCaption message with YAML AST"
```

---

## Task 8: Add Images to Index Generator

**Files:**
- Modify: `src/indexGenerator.ts`

**Step 1: Add images field extraction**

In the `extractNodeChildren` function, after the existing field extraction for summary/body/attributes/content, add:

```typescript
    // Extract images field if present
    if (child.images && Array.isArray(child.images) && child.images.length > 0) {
      fieldChildren.push({
        id: `${entityId}-images`,
        type: 'field',
        name: 'images',
        _node_kind: 'field',
        _field_name: 'images',
        _field_type: 'array',
        _images_count: child.images.length,
        _parent_file: effectiveParentFile,
        _parent_entity: entityId,
        _depth: depth + 1,
      });
    }
```

**Step 2: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/indexGenerator.ts
git commit -m "feat(indexGenerator): extract images field for tree view"
```

---

## Task 9: Add Images Field to Tree Provider

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Add images icon mapping**

In the `getIcon` method of `IndexNodeTreeItem`, add to the `fieldIconMap`:

```typescript
      const fieldIconMap: Record<string, [string, string]> = {
        summary: ['symbol-key', 'symbolIcon.keyForeground'],
        body: ['symbol-text', 'symbolIcon.textForeground'],
        attributes: ['symbol-property', 'symbolIcon.propertyForeground'],
        content: ['symbol-snippet', 'symbolIcon.snippetForeground'],
        images: ['file-media', 'symbolIcon.colorForeground'],  // Add this line
      };
```

**Step 2: Add images field command handling**

The existing `navigateToField` command should handle `__images__` - verify it's set up correctly in the IndexNodeTreeItem constructor for field nodes.

**Step 3: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/treeProvider.ts
git commit -m "feat(treeProvider): add images field icon and navigation"
```

---

## Task 10: Wire Up Image URL Resolution

**Files:**
- Modify: `src/writerView/manager.ts`
- Modify: `src/writerView/html/imagesRenderer.ts`

**Step 1: Update manager to resolve image URLs for webview**

In the `openWriterView` and `openWriterViewForField` methods, add URL resolution:

```typescript
    // Resolve image URLs for webview
    const resolvedImages = node.images?.map(img => ({
      ...img,
      url: this.resolveImageUrlForWebview(panel.webview, img.url, workspaceRoot)
    }));
```

**Step 2: Add URL resolution helper method**

Add to WriterViewManager class:

```typescript
  /**
   * Resolve image URL for webview display
   */
  private resolveImageUrlForWebview(webview: vscode.Webview, url: string, workspaceRoot: string): string {
    // If it's an absolute URL, use as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // For relative paths, convert to webview URI
    const path = require('path');
    let fullPath: string;

    if (url.startsWith('/')) {
      // Relative to workspace root
      fullPath = path.join(workspaceRoot, url.substring(1));
    } else {
      // Relative to current file
      fullPath = path.join(workspaceRoot, url);
    }

    const fileUri = vscode.Uri.file(fullPath);
    return webview.asWebviewUri(fileUri).toString();
  }
```

**Step 3: Pass resolved images to HTML builder**

Update the `buildWebviewHtml` call to use resolved images:

```typescript
    // Create a modified node with resolved image URLs
    const nodeWithResolvedImages = {
      ...node,
      images: resolvedImages
    };

    panel.webview.html = buildWebviewHtml({
      webview: panel.webview,
      node: nodeWithResolvedImages,
      // ... rest of options
    });
```

**Step 4: Update imagesRenderer to use URLs directly**

In `imagesRenderer.ts`, update `resolveImageUrl` to just return the URL since it's already resolved:

```typescript
function resolveImageUrl(url: string, workspaceRoot: string): string {
  // URLs are pre-resolved by the manager
  return url;
}
```

**Step 5: Compile and verify**

Run: `npm run compile`
Expected: No errors

**Step 6: Commit**

```bash
git add src/writerView/manager.ts src/writerView/html/imagesRenderer.ts
git commit -m "feat(writerView): resolve image URLs for webview display"
```

---

## Task 11: Final Integration Test

**Step 1: Build and install extension**

```bash
npm run compile && npx vsce package && code --install-extension chapterwise-codex-0.3.0.vsix --force
```

**Step 2: Reload VS Code**

Run: "Developer: Reload Window"

**Step 3: Test with Mugi character**

1. Set context to E02 folder
2. Expand characters → Mugi
3. Verify "images (6)" appears in tree
4. Click "images" → verify full gallery view opens
5. Select "Overview" → verify images section appears after Summary
6. Click a thumbnail → verify modal opens
7. Edit caption → verify it saves to file
8. Use arrow keys to navigate → verify prev/next works
9. Press Escape → verify modal closes

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete images gallery implementation"
```

---

## Summary

This plan implements:
- `CodexImage` interface with url, caption, alt, featured fields
- Images parsing in codexModel
- Thumbnail gallery in overview mode (after Summary, before Attributes)
- Full-page gallery in images view mode
- Modal overlay with caption editing
- Patch-based caption saves using YAML AST
- Images field in tree view with navigation
- Proper webview URL resolution for local images
