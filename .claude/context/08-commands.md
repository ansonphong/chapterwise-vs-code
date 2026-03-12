# Commands

56 commands registered across 14 domain modules in `src/commands/`. All receive `CommandDeps` via `registerAllCommands()`.

## Navigator (`commands/navigator.ts`)
- `openNavigator` -- Focus the ChapterWise sidebar
- `filterByType` -- Filter tree nodes by type
- `toggleFields` -- Toggle field display in tree
- `refresh` -- Refresh tree data
- `switchToIndexMode` -- Switch to index view

## Writer View (`commands/writerView.ts`)
- `openWriterView` -- Open distraction-free editor for a node

## Navigation (`commands/navigation.ts`)
- `goToYaml` -- Jump to node's YAML/JSON source position
- `copyId` -- Copy node ID to clipboard
- `navigateToEntityInCodeView` -- Open entity in code editor
- `navigateToFieldInCodeView` -- Open specific field in code editor

## Structure (`commands/structure.ts`)
- `addChildNode` / `addSiblingNode` -- Create new nodes
- `removeNode` / `deleteNodePermanently` -- Remove nodes
- `renameNode` -- Rename a node
- `moveNodeUp` / `moveNodeDown` -- Reorder nodes
- `changeType` -- Change node type
- `changeColor` -- Set node color
- `changeIcon` -- Set node emoji/icon
- `addField` / `deleteField` / `renameField` -- Field management
- `addTags` -- Add tags to node
- `addRelation` -- Add relation between nodes
- `duplicateNode` -- Deep-clone node
- `extractToFile` -- Extract inline node to separate file
- `inlineThisFile` -- Merge included file back inline

## File Operations (`commands/fileOps.ts`)
- `addChildFile` / `addChildFolder` -- Create files/folders in index
- `renameFolder` -- Rename folder on disk
- `openInFinder` -- Reveal in OS file explorer
- `copyPath` -- Copy file path to clipboard

## Clipboard (`commands/clipboard.ts`)
- `cutNode` -- Cut node to clipboard
- `pasteNodeAsChild` / `pasteNodeAsSibling` -- Paste node

## Trash (`commands/trash.ts`)
- `moveToTrash` / `restoreFromTrash` / `emptyTrash` -- Soft delete

## Batch (`commands/batch.ts`)
- `batchMoveToTrash` -- Delete multiple selected nodes
- `batchAddTags` -- Tag multiple selected nodes

## Tools (`commands/tools.ts`)
- `autoFix` / `autoFixRegenIds` -- Fix document issues
- `updateWordCount` -- Calculate word counts
- `generateTags` -- AI-assisted tag generation

## Index (`commands/index.ts`)
- `generateIndex` / `regenerateIndex` -- Build/rebuild index cache
- `createIndexFile` -- Create new index.codex.yaml

## Context (`commands/context.ts`)
- `setContextFolder` / `setContextFile` / `resetContext` -- Set navigator scope

## Convert (`commands/convert.ts`)
- `convertToMarkdown` / `convertToCodex` -- Format conversion
- `explodeCodex` / `implodeCodex` -- Extract/merge children

## Search (`commands/search.ts`)
- `search` -- Open search QuickPick
- `rebuildSearchIndex` -- Force search index rebuild

## Git (`commands/git.ts`)
- `git.setupWizard` -- Interactive 6-step wizard
- `git.initRepository` / `git.ensureGitIgnore` / `git.setupLFS` -- Individual git commands

## Import (registered separately in `scrivenerImport.ts`)
- `importScrivener` -- Import Scrivener .scrivx project
