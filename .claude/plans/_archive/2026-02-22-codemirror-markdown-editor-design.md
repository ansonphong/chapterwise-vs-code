# CodeMirror 6 Markdown Editor for Writer View

**Date:** 2026-02-22
**Status:** Design approved

## Summary

Replace all `contenteditable` divs and `<textarea>` elements in the Writer View with CodeMirror 6 editor instances. The primary UX is WYSIWYG inline rendering (Typora/Obsidian-style): markdown syntax is rendered visually, but revealed when the cursor is on that line. A raw mode toggle shows unrendered markdown.

## Problem

The current Writer View editing is a plain text experience:
- `contenteditable` divs with `innerText` save — no formatting persists
- Bold/italic/underline toolbar buttons use `execCommand` but formatting is stripped on save
- No markdown rendering, syntax highlighting, or formatting shortcuts
- Writers see raw text with no visual feedback

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Edit model | WYSIWYG inline rendering | Typora/Obsidian-style: formatted text by default, raw markdown visible when cursor is on that line |
| Engine | CodeMirror 6 | Purpose-built for this (used by Obsidian). Decoration API, markdown mode, keybindings, ~150KB gzipped, MIT licensed |
| Markdown scope | Writer essentials + code | Bold, italic, headings (h1-h3), blockquotes, ordered/unordered lists, horizontal rules, links, inline code, fenced code blocks |
| Editor scope | All prose fields + content sections | Every editing element except the inline node title rename span |
| Raw mode | Toggle via toolbar button | StateField boolean disables inline rendering plugin |

## Architecture

```
┌─────────────────────────────────────────────┐
│  Writer View Webview                        │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  CodeMirror 6 Instance                │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │ @codemirror/lang-markdown       │  │  │
│  │  │ (parse + syntax tree)           │  │  │
│  │  ├─────────────────────────────────┤  │  │
│  │  │ Inline Rendering Plugin         │  │  │
│  │  │ (ViewPlugin + Decorations)      │  │  │
│  │  │ - Hides ** when cursor away     │  │  │
│  │  │ - Renders bold/italic/headings  │  │  │
│  │  │ - Renders blockquotes, lists    │  │  │
│  │  ├─────────────────────────────────┤  │  │
│  │  │ Formatting Keybindings          │  │  │
│  │  │ Ctrl+B → wrap **               │  │  │
│  │  │ Ctrl+I → wrap *                │  │  │
│  │  │ Ctrl+S → save()                │  │  │
│  │  ├─────────────────────────────────┤  │  │
│  │  │ Theme (matches Writer View CSS) │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  postMessage('save', editorView.state.doc)  │
│          ↕                                  │
│  Extension Backend (manager.ts)             │
└─────────────────────────────────────────────┘
```

### Dependencies

- `@codemirror/view` — editor view, decorations, plugins
- `@codemirror/state` — editor state, state fields, transactions
- `@codemirror/lang-markdown` — markdown language support, Lezer parser
- `@codemirror/language` — syntax tree access, language infrastructure
- `@codemirror/commands` — base editing commands
- `@codemirror/search` — find/replace (bonus)

## Editor Instances

| Current Element | Type | CM6 Treatment |
|---|---|---|
| `#editor` (prose mode) | `contenteditable` div | Full CM6 instance with inline rendering |
| `#summaryEditorContent` (overview) | `contenteditable` div | Full CM6 instance with inline rendering |
| `#bodyEditorContent` (overview) | `contenteditable` div | Full CM6 instance with inline rendering |
| Content section textareas | `<textarea>` | CM6 instance with inline rendering |
| `#nodeNameEdit` (inline title) | `contenteditable` span | Keep as-is (one-line plain text) |

## File Organization

```
src/writerView/
├── editor/
│   ├── setup.ts          # CM6 editor factory — creates configured instances
│   ├── inlineRender.ts   # ViewPlugin for WYSIWYG inline rendering
│   ├── formatting.ts     # Ctrl+B/I/U commands + toolbar integration
│   ├── theme.ts          # CM6 theme matching Writer View aesthetics
│   └── keybindings.ts    # Keymap (save, formatting, raw toggle)
├── script.ts             # Modified — init CM6 instead of contenteditable
├── html/builder.ts       # Modified — emit <div> mount points instead of contenteditable
├── styles.ts             # Modified — add CM6 theme CSS
└── manager.ts            # Minimal changes — save receives plain text same as before
```

## Inline Rendering Rules

The ViewPlugin inspects the Lezer markdown syntax tree and applies decorations:

| Markdown | When cursor elsewhere | When cursor on line |
|---|---|---|
| `**bold**` | **bold** (hide `**`) | `**bold**` (show markers) |
| `*italic*` | *italic* (hide `*`) | `*italic*` (show markers) |
| `# Heading` | Large styled heading (hide `#`) | `# Heading` (show `#`) |
| `> quote` | Styled blockquote with left border (hide `>`) | `> quote` (show `>`) |
| `` `code` `` | Monospace background (hide backticks) | `` `code` `` (show backticks) |
| `- item` | Rendered bullet (hide `-`) | `- item` (show `-`) |
| `1. item` | Rendered number (hide prefix) | `1. item` (show prefix) |
| `---` | Horizontal rule line | `---` (show dashes) |
| `[text](url)` | Styled link (hide URL) | `[text](url)` (show all) |
| ` ```code``` ` | Syntax-highlighted code block | Show fences + code |

**Implementation:**
- `syntaxTree(state)` to walk the Lezer parse tree
- `Decoration.mark` for styling, `Decoration.replace` for hiding syntax characters
- Track cursor line via `EditorView.updateListener` — rebuild decorations when cursor moves
- `RangeSet` for efficient decoration management

## Theme

```
Font:      Charter, Georgia, Cambria, Times New Roman, serif
Size:      1.125rem (18px)
Line-ht:   1.8
Max-width: 700px (centered)
Colors:    Inherit from VS Code theme variables
Cursor:    Thin line, matches text color
Selection: Subtle highlight matching VS Code selection
Gutter:    Hidden (no line numbers — prose, not code)
```

Heading scale: h1 = 1.8em, h2 = 1.4em, h3 = 1.2em — all bold.

## Save Flow (Unchanged)

`editorView.state.doc.toString()` returns plain markdown text, so the existing `postMessage({ type: 'save', text: ... })` pipeline works without changes. This is a key advantage: the backend save logic in `manager.ts` remains untouched.

## Dirty Tracking

Replace `isDirty` boolean + `input` listener with CM6's update listener:

```typescript
EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    markDirty();
    debouncedSave();
  }
});
```

## Toolbar Integration

Existing formatting toolbar buttons rewired:
- Bold button: dispatches CM6 transaction wrapping selection in `**`
- Italic button: dispatches CM6 transaction wrapping selection in `*`
- Underline: either map to `**` (bold alias) or remove — underline isn't standard markdown
- Raw/WYSIWYG toggle: new button that flips the `StateField<boolean>` controlling inline rendering

## Bundle Impact

CodeMirror 6 with markdown support: ~150KB gzipped. The extension currently bundles via esbuild, so CM6 modules will be tree-shaken. Only used modules are included.

## Migration Path

1. CM6 reads initial content the same way current editors do (plain text from YAML/MD)
2. CM6 saves the same way (`doc.toString()` → plain text → `postMessage`)
3. No file format changes required
4. Existing content is valid markdown (plain text is valid markdown)
5. Rollback: revert the webview changes, backend is untouched
