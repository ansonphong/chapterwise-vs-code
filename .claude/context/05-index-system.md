# Index System

Four modules collaborate to maintain and display the project-wide file index.

## indexParser.ts -- Parse Index Files

Parses `index.codex.yaml` (human-written) and `.index.codex.json` (generated cache). Key types:
- `IndexDocument`: root with `metadata`, `typeStyles`, `children`, `patterns`
- `IndexChildNode`: `id`, `type`, `name`, `_computed_path`, `_filename`, `_format`, `emoji`, `color`, `children`, `include`
- `TypeStyle`: `{ type, emoji?, color? }` applied recursively via `applyTypeStyles()`

**V2 Nested Indexes**: `resolveSubIndexIncludes()` recursively loads `include: ./sub/index.codex.yaml` directives, with circular reference detection (`parsedIndexes` Set), depth limit (8), symlink rejection, and workspace boundary validation. `parseIndexFileWithIncludes()` is the main entry point.

## indexGenerator.ts -- Fractal Cascade Architecture (1396 lines)

Scans workspace and generates `.index.codex.json` cache files.

**Key exports:**
- `generateIndex(options)` -- Full workspace scan, produces root `.index.codex.json`
- `generatePerFolderIndex(workspaceRoot, folderPath)` -- Per-folder `.index.codex.json` for immediate children
- `cascadeRegenerateIndexes(workspaceRoot, folderPath)` -- Regenerate from leaf folders up to root (fractal cascade)
- `generateFolderHierarchy()` -- Create directory structure from index

**Fractal cascade**: Per-folder indexes define order for immediate children. Parent indexes merge child indexes. The top-level index is the complete workspace tree. Regeneration cascades upward from the modified folder.

## multiIndexManager.ts -- Discover Multiple Indexes

`MultiIndexManager` discovers all `index.codex.yaml` files in the workspace and assigns them to view slots. Supports up to 8 sub-indexes displayed in separate tree views (`chapterwiseIndex0`--`chapterwiseIndex7`), plus a master index view (`chapterwiseMaster`) showing orphan files. Controlled by `chapterwise.indexDisplayMode` setting (`nested` | `stacked` | `tabs`).

## treeStateManager.ts -- Expansion State Persistence

Debounced (500ms) persistence of tree node expansion state to `.index.codex.json`. Updates are batched by file, validated (UUID format, valid index structure), and written as JSON. Only applies to index-mode nodes (`IndexNodeTreeItem`).
