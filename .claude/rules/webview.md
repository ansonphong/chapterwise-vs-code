# Rules: Webview & Writer View

Applies when creating or modifying files in `src/writerView/`.

## Security

- **HTML escape ALL interpolations** — Use `escapeHtml()` from `writerView/utils/helpers.ts`. It escapes `<`, `>`, `&`, `"`, and `'` (as `&#039;`). Never interpolate user content into HTML without escaping.
- **CSP header required** — Every webview must include: `img-src ${webview.cspSource} data:;`. Scripts must use nonce-based CSP.
- **No inline scripts** — All JavaScript goes through nonce-gated `<script>` tags. CSP blocks inline event handlers.

## Image Handling

- SHA256 content hash with file-size pre-filter for image deduplication
- Images stored workspace-relative, served via `webview.asWebviewUri()`
- `data:` URIs allowed in CSP for small inline images only

## Webview Communication

- Use `safePostMessage()` from helpers for extension → webview messages
- Webview → extension communication via `vscode.postMessage()` with typed message objects
- Always validate message types in both directions

## File Structure

```
writerView/
├── manager.ts          # Panel pool, file locking, lifecycle
├── script.ts           # Webview-side JavaScript
├── html/
│   ├── builder.ts      # Main HTML assembly
│   ├── contentRenderer.ts
│   ├── attributesRenderer.ts
│   ├── imagesRenderer.ts
│   └── imageBrowserRenderer.ts
├── toolbar/            # Contextual toolbar components
└── utils/
    └── helpers.ts      # escapeHtml, isPathWithinWorkspace, safePostMessage, nonce
```
