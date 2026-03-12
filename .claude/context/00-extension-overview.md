# Extension Overview

## What It Does

ChapterWise transforms VS Code into a creative writing IDE for `.codex.yaml`, `.codex.json`, and `.codex.md` files. It provides a Scrivener-like navigator sidebar, distraction-free prose editor (Writer View), full-text search, structural editing, and Git setup tools.

## Activation

- **Trigger**: `onStartupFinished` when workspace contains `**/*.codex.yaml`, `**/*.codex.json`, or `**/*.codex`
- **Entry point**: `src/extension.ts` -> `activate(context)`

## Activation Flow

1. Create `CodexTreeProvider` (sidebar navigation)
2. Create `CodexDragAndDropController` (tree drag-and-drop)
3. Create tree view with `createCodexTreeView()`, register collapse/expand state handlers
4. Create `MultiIndexManager` + `MasterIndexTreeProvider` + 8 `SubIndexTreeProvider` slots (non-critical, wrapped in try/catch)
5. Sync ordering on startup (non-blocking)
6. Create `WriterViewManager` (webview prose editor)
7. Initialize validation system (diagnostic overlays)
8. Create status bar item
9. Call `initState()` to store all refs in `extensionState.ts` module-level state
10. `registerAllCommands(context, getDeps())` -- routes to 14 domain modules
11. Register Scrivener import, update status bar, auto-discover index files, restore last context

## Dependency Injection: CommandDeps

All commands receive a `CommandDeps` object (defined in `src/commands/types.ts`) via `getDeps()` from `extensionState.ts`. This avoids direct imports of module-level state:

```typescript
interface CommandDeps {
  treeProvider, treeView, writerViewManager, outputChannel,
  multiIndexManager, masterTreeProvider, subIndexProviders, subIndexViews,
  getSearchIndexManager,   // closure over mutable module var
  getWorkspaceRoot, reloadTreeIndex, regenerateAndReload,
  resolveIndexNodeForEdit, showTransientMessage, findNodeById
}
```

## Key Files

- `src/extension.ts` -- activate/deactivate lifecycle
- `src/extensionState.ts` -- module-level state, `initState()`, `getDeps()`, helpers
- `src/commands/register.ts` -- delegates to 14 domain command modules
- `src/commands/types.ts` -- `CommandDeps` interface

## Deactivation

`deactivate()` disposes tree state, extension state, and all module-level resources (autoFixer, explode, implode, wordCount, tagGenerator, convertFormat, gitSetup, scrivenerImport).
