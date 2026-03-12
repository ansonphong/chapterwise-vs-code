# Structure Editing

## File: `src/structureEditor.ts` (1523 lines)

The `CodexStructureEditor` handles all structural mutations. Core principle: **filesystem is the source of truth, index is a derived cache**.

## Operation Pattern

Every operation follows: 1) perform filesystem op, 2) update broken include paths, 3) regenerate `.index.codex.json`, 4) refresh UI.

## Index-Mode Operations (filesystem-level)

| Method | What it does |
|---|---|
| `moveFileInIndex()` | Move a codex file to a different directory |
| `renameFileInIndex()` | Rename a codex file on disk |
| `removeFileFromIndex()` | Delete a file from disk |
| `reorderFileInIndex()` | Change a file's position in the index array |
| `moveFileUp()` / `moveFileDown()` | Shift file position in index ordering |

## Codex-Mode Operations (in-document AST mutations)

| Method | What it does |
|---|---|
| `moveNodeInDocument()` | Reorder a node within its parent's children array |
| `addNodeInDocument()` | Insert a new child or sibling node |
| `removeNodeFromDocument()` | Remove a node from the children array |
| `renameNodeInDocument()` | Update a node's name field |
| `reorderChildrenInDocument()` | Rearrange all children of a parent |
| `duplicateNodeInDocument()` | Deep-clone a node with new UUIDs |
| `extractNodeToFile()` | Extract an inline node to a separate `.codex.yaml` file, replacing with include directive |
| `inlineThisFile()` | Merge an included file back into the parent (inverse of extract) |

## Field Operations

| Method | What it does |
|---|---|
| `addFieldToNode()` | Add a new prose field (body, summary, etc.) |
| `removeFieldFromNode()` | Remove a field from a node |
| `renameFieldOnNode()` | Rename a field key |
| `changeNodeType()` | Change the type field |
| `addTagsToNode()` | Append tags to a node |
| `addRelationToNode()` | Add a relation entry |
| `setEmojiOnNode()` | Set custom emoji via attributes |

## Include Path Maintenance

`updateIncludePaths()` scans files that reference a moved/renamed file and updates their include directives. `findFilesIncluding()` locates all files referencing a given path.

## Supporting Modules

- `src/dragDropController.ts` -- `CodexDragAndDropController` for tree drag-and-drop
- `src/clipboardManager.ts` -- Cut/paste with WeakMap-based resolver tracking
- `src/trashManager.ts` -- Soft delete to `.chapterwise-trash/` with restore
- `src/orderingManager.ts` -- Persistent ordering state synced with filesystem
- `src/fileOrganizer.ts` -- File naming and directory structure strategies
- `src/settingsManager.ts` -- `NavigatorSettings` from VS Code configuration

## Path Security

All operations validate paths with `isPathWithinRoot()` before any filesystem mutation.
