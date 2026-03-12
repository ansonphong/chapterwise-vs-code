# Writer View

## File: `src/writerView/manager.ts` (1776 lines)

The `WriterViewManager` provides distraction-free prose editing in VS Code webview panels.

## Panel Pool

Panels are keyed by `documentUri#nodeId`. The `panels: Map<string, WebviewPanel>` tracks open panels; reopening a node reveals its existing panel. Each panel tracks stats in `panelStats: Map<string, WriterPanelStats>`.

## Opening a Panel

1. `openWriterView(treeItem)` computes `panelKey`, checks for existing panel
2. `bootstrapPanel()` creates the webview, sets HTML via `buildWebviewHtml()`, wires up message handlers
3. Panel displays: node name, type, author (from doc or index), prose editor, attributes, content sections, images

## File Locking

`withFileLock(filePath, fn)` serializes concurrent writes to the same file using a promise chain (`fileLocks: Map<string, Promise<void>>`). All YAML/JSON mutations go through this.

## Image Handling

- **Deduplication**: SHA256 content hash with file-size pre-filter. On paste/import, checks workspace for existing identical image via `findDuplicateImage()`.
- **Duplicate resolution**: Promise-based webview dialog using `pendingDuplicateResolvers` Map + `panelResolverKeys` WeakMap. Resolvers are cleaned up in `onDidDispose`.
- **Organization**: Two strategies (configurable): `perNode` (images next to codex file) or `sharedWithNodeFolders` (shared images folder with node subfolders).
- **CSP**: `img-src ${webview.cspSource} data:;` required for image display.

## Auto-Save

Prose changes from the webview trigger immediate file writes through `withFileLock()`. The manager updates the YAML/JSON/Markdown file on disk and refreshes the tree.

## HTML Composition

- `src/writerView/html/builder.ts` -- assembles full HTML document
- `src/writerView/html/contentRenderer.ts` -- prose editor sections
- `src/writerView/html/attributesRenderer.ts` -- attribute table
- `src/writerView/html/imagesRenderer.ts` -- image gallery
- `src/writerView/html/imageBrowserRenderer.ts` -- image picker
- `src/writerView/styles.ts` -- CSS (theme-adaptive: light/dark/system/theme)
- `src/writerView/script.ts` -- client-side JS for the webview
- `src/writerView/toolbar/` -- contextual toolbar

## Stats

`WriterPanelStats` tracks word count, character count, paragraph count. Updated on each save and displayed in status bar.

## Security

- All HTML interpolations use `escapeHtml()` from `utils/helpers.ts` (includes single-quote)
- Path validation via `isPathWithinWorkspace()` before any file operation
- Nonce-based CSP for inline scripts
