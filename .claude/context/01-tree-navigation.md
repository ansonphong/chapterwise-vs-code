# Tree Navigation

## File: `src/treeProvider.ts` (1484 lines)

The `CodexTreeProvider` implements `vscode.TreeDataProvider<CodexTreeItemType>` and powers the ChapterWise Navigator sidebar.

## Two Navigation Modes

- **Codex mode** (`isIndexMode: false`): Shows nodes from a single `.codex.yaml` file parsed via `codexModel.ts`. Active document drives the tree.
- **Index mode** (`isIndexMode: true`): Shows a project-wide file hierarchy from `.index.codex.json` cache files. Set via `setContextFolder()` or `setContextFile()`.

Mode is controlled by `navigationMode: 'auto' | 'codex' | 'index'`. In `auto`, the tree switches based on what the user opens.

## Centralized Context State

Single source of truth lives in `currentContext: { workspaceRoot, contextFolder }`. All path resolution goes through `resolveFilePath()` which validates against path traversal.

## Tree Item Types (contextValue)

| Class | contextValue | Purpose |
|---|---|---|
| `CodexFileHeaderItem` | `codexFileHeader` / `indexHeader` | File header at tree top |
| `CodexFieldTreeItem` | `codexField` | Prose/attributes/content field under a codex node |
| `IndexNodeTreeItem` | `indexNode` / `indexFile` / `indexFolder` / `indexField` / `indexError` | Node from index cache |
| `CodexTreeItem` | `codexNode` | Node from parsed codex document |

## Runtime Node Properties (Index Mode)

The index generator adds runtime properties accessed via safe accessor functions:
- `_node_kind`: `'file'` | `'entity'` | `'field'` | `'error'`
- `_parent_file`: which codex file contains this node
- `_field_name`, `_field_type`, `_parent_entity`: for field nodes
- `_computed_path`: resolved filesystem path
- `_depth`: nesting depth

## Type Filtering

`filterType: string | null` filters tree to show only nodes of a specific type. Applied in `getChildren()`.

## Decorations

- Emoji prefix from `getEffectiveEmoji()` (explicit > typeStyles)
- Color from `getEffectiveColor()` via `ThemeColor`
- Cut indicator via `_isCutFn` WeakMap pattern (clipboard manager)
- Word count and node count in descriptions
