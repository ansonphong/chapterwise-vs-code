# CodeMirror 6 Markdown Editor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all contenteditable/textarea editors in Writer View with CodeMirror 6 instances that provide WYSIWYG inline markdown rendering (Typora/Obsidian-style).

**Architecture:** A separate esbuild entry point bundles CM6 + custom plugins into a standalone webview script. The extension injects this script via a `<script src>` tag (replacing the inline template literal). CM6 decorations render markdown inline, hiding syntax when cursor is elsewhere. Save flow unchanged — `doc.toString()` produces plain text.

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`, `@codemirror/language`, `@codemirror/commands`), esbuild, TypeScript

**Design doc:** `docs/plans/2026-02-22-codemirror-markdown-editor-design.md`

---

## Critical Architecture Note: Webview Bundle

The current webview scripts (`script.ts`, `toolbarScript.ts`) are **inline template literal strings** returned by functions and injected into the HTML. CM6 cannot work this way — it needs proper ES module imports. We must:

1. Create a new esbuild entry point for the webview script
2. Bundle it to a separate `.js` file (e.g., `out/webview.js`)
3. Load it via `<script src="${webview.asWebviewUri(...)}">`  instead of inline `<script>` with template literals
4. Update CSP to allow the script source

This is the foundational change that all other tasks depend on.

---

### Task 1: Install CodeMirror 6 Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install CM6 packages**

Run:
```bash
npm install @codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/language @codemirror/commands
```

**Step 2: Verify installation**

Run: `npm ls @codemirror/view`
Expected: Shows installed version

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add CodeMirror 6 packages for Writer View markdown editor"
```

---

### Task 2: Add Webview Bundle Entry Point to esbuild

**Files:**
- Modify: `esbuild.js`

**Step 1: Add a second esbuild entry point for the webview bundle**

The webview script needs to be bundled separately because:
- It runs in a browser sandbox (not Node.js)
- It needs `iife` format (not `cjs`)
- It must include CM6 (not externalize `vscode` the same way)

Update `esbuild.js` to build two bundles:

```javascript
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // Extension host bundle (Node.js / CJS)
  const extCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  // Webview bundle (browser / IIFE)
  const webviewCtx = await esbuild.context({
    entryPoints: ['src/writerView/webview/main.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'out/webview.js',
    logLevel: 'info',
  });

  if (watch) {
    await Promise.all([extCtx.watch(), webviewCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([extCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**Step 2: Verify it compiles (will fail — entry point doesn't exist yet)**

Run: `npm run compile`
Expected: Error about missing `src/writerView/webview/main.ts` — that's correct, we create it next.

**Step 3: Commit**

```bash
git add esbuild.js
git commit -m "build: add separate esbuild entry point for webview bundle"
```

---

### Task 3: Create Webview Entry Point (Scaffold)

Create the new webview script entry point that will replace the inline template literal approach. Start with a minimal scaffold that just initializes a basic CM6 editor.

**Files:**
- Create: `src/writerView/webview/main.ts`

**Step 1: Create the webview entry point**

This file is the browser-side script that runs in the webview. It reads initialization data from `window.__WRITER_VIEW_INIT__` (set by the HTML builder), creates CM6 editors, and communicates with the extension via `postMessage`.

```typescript
// src/writerView/webview/main.ts
// Webview entry point — bundled separately by esbuild (IIFE, browser platform)

import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';

// Acquire vscode API (injected by VS Code webview runtime)
declare function acquireVsCodeApi(): { postMessage: (msg: any) => void; getState: () => any; setState: (s: any) => void };
const vscode = acquireVsCodeApi();

// Init data injected by builder.ts into a <script> tag before this bundle loads
declare const __WRITER_VIEW_INIT__: {
  initialField: string;
  nodeType: string;
  prose: string;
  summaryValue: string;
  bodyValue: string;
  hasSummary: boolean;
  hasBody: boolean;
  attributes: any[];
  contentSections: any[];
  images: any[];
  availableFields: string[];
  hasAttributes: boolean;
  hasContentSections: boolean;
};

const init = __WRITER_VIEW_INIT__;

// Placeholder: create a basic CM6 editor in #editor mount point
const editorMount = document.getElementById('editor');
if (editorMount) {
  const view = new EditorView({
    state: EditorState.create({
      doc: init.prose,
      extensions: [
        markdown(),
        keymap.of(defaultKeymap),
      ],
    }),
    parent: editorMount,
  });
}
```

**Step 2: Verify esbuild compiles successfully**

Run: `npm run compile`
Expected: Both `out/extension.js` and `out/webview.js` are produced without errors.

**Step 3: Commit**

```bash
git add src/writerView/webview/main.ts
git commit -m "feat(writerView): scaffold webview entry point with basic CM6 editor"
```

---

### Task 4: Update HTML Builder to Load Bundled Webview Script

Change `builder.ts` to load the bundled webview script via `<script src>` instead of inline template literals. Inject init data as a separate inline script before the bundle.

**Files:**
- Modify: `src/writerView/html/builder.ts`

**Step 1: Update `buildWebviewHtml` to accept the webview script URI**

Add `webviewScriptUri: vscode.Uri` to the `WebviewHtmlOptions` interface. This URI points to the bundled `out/webview.js` file, resolved via `webview.asWebviewUri()`.

**Step 2: Replace the inline script block**

Change the `<script>` section at the end of the HTML from:

```html
<script nonce="${nonce}">
${getWriterViewScript(node, initialField)}
</script>
```

To:

```html
<script nonce="${nonce}">
  var __WRITER_VIEW_INIT__ = ${JSON.stringify({
    initialField,
    nodeType: node.type,
    prose,
    summaryValue,
    bodyValue,
    hasSummary,
    hasBody,
    attributes: node.attributes || [],
    contentSections: node.contentSections || [],
    images: node.images || [],
    availableFields: node.availableFields,
    hasAttributes: node.hasAttributes || (node.attributes && node.attributes.length > 0),
    hasContentSections: node.hasContentSections || (node.contentSections && node.contentSections.length > 0),
  })};
</script>
<script nonce="${nonce}" src="${webviewScriptUri}"></script>
```

**Step 3: Change `#editor` from contenteditable div to a plain mount point**

Replace:
```html
<div id="editor" contenteditable="true" spellcheck="true" data-placeholder="Start writing...">${escapedProse}</div>
```

With:
```html
<div id="editor"></div>
```

Similarly for `#summaryEditorContent` and `#bodyEditorContent` — change them to empty `<div>` mount points.

**Step 4: Update CSP to allow the script src**

The CSP `script-src` needs to allow `${webview.cspSource}` in addition to the nonce (for the init data script):

```
script-src 'nonce-${nonce}' ${webview.cspSource};
```

**Step 5: Update manager.ts to pass webviewScriptUri**

In the file that calls `buildWebviewHtml()`, compute the URI:

```typescript
const webviewScriptUri = panel.webview.asWebviewUri(
  vscode.Uri.joinPath(context.extensionUri, 'out', 'webview.js')
);
```

Pass it into the options.

**Step 6: Verify it compiles and the webview loads**

Run: `npm run compile`
Then manually test: open a codex file in Writer View. The editor should show a basic CM6 editor with the prose content.

**Step 7: Commit**

```bash
git add src/writerView/html/builder.ts src/writerView/manager.ts
git commit -m "feat(writerView): load CM6 webview bundle via script src instead of inline"
```

---

### Task 5: Create CM6 Theme Matching Writer View Aesthetics

**Files:**
- Create: `src/writerView/webview/theme.ts`

**Step 1: Create the Writer View CM6 theme**

```typescript
// src/writerView/webview/theme.ts
import { EditorView } from '@codemirror/view';

export const writerTheme = EditorView.theme({
  '&': {
    fontFamily: "'Charter', 'Georgia', 'Cambria', 'Times New Roman', serif",
    fontSize: '1.125rem',
    lineHeight: '1.8',
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    caretColor: 'var(--text-primary)',
    padding: '0',
    fontFamily: 'inherit',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--text-primary)',
    borderLeftWidth: '1.5px',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--selection-bg, rgba(100, 150, 255, 0.2))',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection-bg, rgba(100, 150, 255, 0.3))',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-scroller': {
    overflow: 'visible',
  },
  // Markdown inline rendering styles
  '.cm-strong': {
    fontWeight: 'bold',
  },
  '.cm-emphasis': {
    fontStyle: 'italic',
  },
  '.cm-heading-1': {
    fontSize: '1.8em',
    fontWeight: 'bold',
    lineHeight: '1.3',
  },
  '.cm-heading-2': {
    fontSize: '1.4em',
    fontWeight: 'bold',
    lineHeight: '1.4',
  },
  '.cm-heading-3': {
    fontSize: '1.2em',
    fontWeight: 'bold',
    lineHeight: '1.5',
  },
  '.cm-blockquote': {
    borderLeft: '3px solid var(--accent-color, #666)',
    paddingLeft: '1em',
    color: 'var(--text-secondary, #999)',
  },
  '.cm-inline-code': {
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '0.9em',
    backgroundColor: 'var(--code-bg, rgba(100, 100, 100, 0.15))',
    padding: '0.1em 0.3em',
    borderRadius: '3px',
  },
  '.cm-code-block': {
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '0.85em',
    backgroundColor: 'var(--code-bg, rgba(100, 100, 100, 0.15))',
    padding: '0.5em 1em',
    borderRadius: '4px',
  },
  '.cm-hr': {
    borderBottom: '1px solid var(--border-color, #444)',
    display: 'block',
  },
  '.cm-link': {
    color: 'var(--link-color, #58a6ff)',
    textDecoration: 'underline',
  },
  '.cm-syntax-hidden': {
    fontSize: '0',
    display: 'inline',
  },
});
```

**Step 2: Wire theme into main.ts**

Import and add to extensions array.

**Step 3: Verify build + visual check**

Run: `npm run compile`

**Step 4: Commit**

```bash
git add src/writerView/webview/theme.ts src/writerView/webview/main.ts
git commit -m "feat(writerView): add CM6 theme matching Writer View serif aesthetic"
```

---

### Task 6: Create Inline Rendering Plugin (Core WYSIWYG)

This is the most complex task. The plugin walks the Lezer markdown syntax tree and applies decorations to render markdown inline, hiding syntax characters when the cursor is on a different line.

**Files:**
- Create: `src/writerView/webview/inlineRender.ts`

**Step 1: Create the inline rendering ViewPlugin**

The plugin:
1. Reads `syntaxTree(state)` from `@codemirror/language`
2. Iterates markdown nodes (StrongEmphasis, Emphasis, ATXHeading, Blockquote, InlineCode, FencedCode, HorizontalRule, Link, BulletList, OrderedList)
3. For each node, if the cursor is NOT on that line:
   - `Decoration.mark` the content with appropriate CSS class (`.cm-strong`, `.cm-emphasis`, etc.)
   - `Decoration.replace` the syntax markers (`**`, `*`, `#`, `>`, backticks) with empty/hidden content
4. If the cursor IS on that line: show everything as-is (no decorations)
5. Returns a `DecorationSet`

Key implementation details:
- Use `ViewPlugin.fromClass` with a `decorations` property
- Recompute on every `update` where `docChanged || selectionChanged`
- Use `state.selection.main.head` to find cursor position, then `state.doc.lineAt(pos)` to get cursor line
- Walk tree with `syntaxTree(state).iterate({ enter(node) { ... } })`
- Node types from `@lezer/markdown`: `StrongEmphasis`, `Emphasis`, `ATXHeading1-6`, `Blockquote`, `InlineCode`, `FencedCode`, `HorizontalRule`, `Link`, `BulletList`, `OrderedList`, `ListItem`

**Step 2: Add a `StateField<boolean>` for raw mode toggle**

When `true`, the plugin returns `Decoration.none` — raw markdown shown.

**Step 3: Wire into main.ts extensions array**

**Step 4: Manual test — write markdown, move cursor between lines, verify rendering**

**Step 5: Commit**

```bash
git add src/writerView/webview/inlineRender.ts src/writerView/webview/main.ts
git commit -m "feat(writerView): add WYSIWYG inline markdown rendering plugin"
```

---

### Task 7: Create Formatting Commands (Ctrl+B, Ctrl+I, etc.)

**Files:**
- Create: `src/writerView/webview/formatting.ts`

**Step 1: Create markdown formatting commands**

```typescript
// src/writerView/webview/formatting.ts
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

/** Wrap selection in markdown syntax, or remove if already wrapped */
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    // Check if already wrapped
    const before = state.sliceDoc(range.from - marker.length, range.from);
    const after = state.sliceDoc(range.to, range.to + marker.length);
    if (before === marker && after === marker) {
      // Remove wrapping
      return {
        changes: [
          { from: range.from - marker.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + marker.length, insert: '' },
        ],
        range: EditorSelection.range(
          range.from - marker.length,
          range.to - marker.length
        ),
      };
    }
    // Add wrapping
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: EditorSelection.range(
        range.from + marker.length,
        range.to + marker.length
      ),
    };
  });
  view.dispatch(changes);
  return true;
}

export function toggleBold(view: EditorView): boolean {
  return toggleWrap(view, '**');
}

export function toggleItalic(view: EditorView): boolean {
  return toggleWrap(view, '*');
}

export function toggleInlineCode(view: EditorView): boolean {
  return toggleWrap(view, '`');
}
```

**Step 2: Create keymap**

```typescript
// Add to formatting.ts or a separate keybindings.ts
import { keymap } from '@codemirror/view';

export const formattingKeymap = keymap.of([
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-`', run: toggleInlineCode },
]);
```

**Step 3: Wire into main.ts**

**Step 4: Manual test — select text, Ctrl+B, verify `**` wrapping**

**Step 5: Commit**

```bash
git add src/writerView/webview/formatting.ts src/writerView/webview/main.ts
git commit -m "feat(writerView): add markdown formatting commands (Ctrl+B/I/code)"
```

---

### Task 8: Wire Save, Dirty Tracking, and Auto-Save

Port the existing save logic from the inline template literal to the new webview bundle.

**Files:**
- Modify: `src/writerView/webview/main.ts`

**Step 1: Implement dirty tracking via CM6 update listener**

For each CM6 editor instance, add `EditorView.updateListener.of(update => ...)` that sets the appropriate dirty flag and triggers debounced auto-save.

**Step 2: Implement save function**

Port the `save()` function from `script.ts:248-317`. Instead of `editor.innerText`, use `editorView.state.doc.toString()`. The `postMessage` calls remain identical.

**Step 3: Implement Ctrl+S keymap**

Add to the keymap: `{ key: 'Mod-s', run: () => { save(); return true; } }`

**Step 4: Port blur handler**

Add `EditorView.domEventHandlers({ blur: () => { if (anyDirty) save(); } })`.

**Step 5: Port the save response handler**

Listen for `message` events from the extension: `window.addEventListener('message', (e) => { if (e.data.type === 'saveComplete') markClean(); })`.

**Step 6: Verify save round-trip**

Run: `npm run compile`, open Writer View, type text, wait 2s, verify file is saved.

**Step 7: Commit**

```bash
git add src/writerView/webview/main.ts
git commit -m "feat(writerView): port save, dirty tracking, and auto-save to CM6 editors"
```

---

### Task 9: Port Remaining Webview Logic

Port all non-editing logic from the inline `script.ts` and `toolbarScript.ts` to the webview bundle. This includes: field selector, type selector, node rename, toolbar context switching, save menu, images, attributes, and content sections.

**Files:**
- Modify: `src/writerView/webview/main.ts` (or split into submodules)
- Possibly create: `src/writerView/webview/toolbar.ts`, `src/writerView/webview/fieldSelector.ts`, etc.

This is the largest porting task. The approach:

**Step 1: Port field selector logic** (`fieldSelector.addEventListener('change', ...)`)

**Step 2: Port type selector logic** (`typeSelector.addEventListener('change', ...)`)

**Step 3: Port node rename logic** (click-to-edit title)

**Step 4: Port save menu** (3-dot menu, save/saveAs)

**Step 5: Port toolbar formatting buttons** — rewire to call CM6 formatting commands instead of `document.execCommand`

**Step 6: Port toolbar context switching** (changes toolbar when switching fields)

**Step 7: Port attributes editor logic** (local state, add/delete/reorder)

**Step 8: Port content sections logic** (local state, add/delete, textarea auto-resize)

**Step 9: Port images logic** (modal, lightbox, drag-drop, browser)

**Step 10: Port message handlers** (incoming messages from extension: `updateContent`, `updateAttributes`, etc.)

**Step 11: Add CM6 editors for overview prose fields** (summary, body)

**Step 12: Add CM6 editors for content section textareas** — dynamically create CM6 instances when content sections are added/rendered

**Step 13: Add raw mode toggle button to toolbar**

**Step 14: Full manual test — all modes, all editors, save/load, field switching**

**Step 15: Commit**

```bash
git add src/writerView/webview/
git commit -m "feat(writerView): port all webview logic to bundled CM6 script"
```

---

### Task 10: Clean Up Old Inline Script System

Remove the old inline template literal script approach now that everything runs from the bundle.

**Files:**
- Modify: `src/writerView/script.ts` — remove or gut `getWriterViewScript()` (the function may still be imported elsewhere; check callers)
- Modify: `src/writerView/toolbar/toolbarScript.ts` — remove `getToolbarScript()` if fully ported
- Modify: `src/writerView/html/builder.ts` — remove import of `getWriterViewScript`
- Clean up any dead imports

**Step 1: Identify all callers of `getWriterViewScript` and `getToolbarScript`**

Run: `grep -r "getWriterViewScript\|getToolbarScript" src/`

**Step 2: Remove or empty the functions**

If nothing else calls them, delete the functions and their files. If they're re-exported, remove the re-exports.

**Step 3: Verify build**

Run: `npm run compile`

**Step 4: Full regression test**

Open Writer View, test all modes, save, field switching, images, etc.

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor(writerView): remove old inline template literal script system"
```

---

### Task 11: Polish and Edge Cases

**Files:**
- Various webview files

**Step 1: Placeholder text** — when CM6 editor is empty, show placeholder ("Start writing...", "Write a summary...", etc.) via CM6's `placeholder` extension from `@codemirror/view`.

**Step 2: Focus management** — when switching fields, focus the correct CM6 editor instance via `editorView.focus()`.

**Step 3: Spellcheck** — CM6 supports browser spellcheck: ensure `EditorView.contentAttributes.of({ spellcheck: "true" })` is set.

**Step 4: Undo/redo** — CM6 has built-in history. Add `@codemirror/commands` `history()` extension and `historyKeymap`.

**Step 5: Content section dynamic editors** — when a new content section is added via the "Add Section" button, create a new CM6 instance for it dynamically.

**Step 6: Theme responsiveness** — verify the CM6 theme looks correct in all 4 theme modes (light, dark, system, theme/VS Code).

**Step 7: Commit**

```bash
git add -u
git commit -m "feat(writerView): polish CM6 editors — placeholders, focus, spellcheck, undo"
```

---

## Summary

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | Install CM6 dependencies | — |
| 2 | Add webview esbuild entry point | 1 |
| 3 | Create webview entry point scaffold | 2 |
| 4 | Update HTML builder to load bundle | 3 |
| 5 | Create CM6 theme | 3 |
| 6 | Create inline rendering plugin | 5 |
| 7 | Create formatting commands | 3 |
| 8 | Wire save/dirty/auto-save | 4 |
| 9 | Port remaining webview logic | 4, 6, 7, 8 |
| 10 | Clean up old inline script system | 9 |
| 11 | Polish and edge cases | 10 |
