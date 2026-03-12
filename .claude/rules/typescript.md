# Rules: TypeScript Conventions

Applies when creating or modifying `.ts` files in `src/`.

## Hard Rules

- **Async file ops only** — Use `fs.promises` (readFile, writeFile, stat, etc.). Never use sync variants (`readFileSync`, `writeFileSync`, `statSync`, etc.). The extension runs in VS Code's extension host — sync I/O blocks the UI.
- **No `as any` type bypasses** — Use proper typing. If you need to attach metadata to an object, use a `WeakMap` (see `panelResolverKeys` pattern in `writerView/manager.ts`).
- **Path traversal validation** — Always call `isPathWithinWorkspace()` + `path.resolve()` before any file operation on user-provided paths. Import from `writerView/utils/helpers.ts`.
- **SVG excluded from import** — SVG is an XSS vector. Never add SVG to import/embed flows. SVGs are display-only via workspace scanner with CSP blocking scripts.

## Patterns

- Use `WeakMap` for panel metadata (resolver keys) instead of casting with `as any`
- `pendingDuplicateResolvers` Map + `panelResolverKeys` WeakMap for Promise-based webview dialogs
- Resolve pending promises in `onDidDispose` to prevent hangs
- Module-level state lives in `extensionState.ts` — access via `getDeps()`, not global variables
- Commands are registered in domain-specific modules under `commands/` — routed by `commands/register.ts`

## Tech Stack

- TypeScript ES2022, strict mode, CommonJS output
- esbuild bundles `src/extension.ts` → `out/extension.js`
- Runtime deps: `yaml`, `minimatch` — keep minimal
- `vscode` is external (provided by VS Code runtime, never bundled)
