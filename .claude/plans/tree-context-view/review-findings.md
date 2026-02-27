# Review Findings & Resolutions

## Review Round 1 (R1) — Design Review

| # | Finding | Severity | Stage | Resolution |
|---|---------|----------|-------|------------|
| R1-1 | Trash design inconsistent (OS trash vs `.chapterwise/trash/`) | High | 2 | Task 1 wires `trashManager.moveToTrash()` into `removeFileFromIndex()`. All flows use `.chapterwise/trash/`. |
| R1-2 | `IndexNodeTreeItem.documentUri` is index cache, not target file | High | 5,6 | `resolveIndexNodeForEdit()` uses `_parent_file`/`resourceUri` for `indexNode`, `_computed_path` for `indexFile`. |
| R1-3 | Folder trash with `recursive: false` | High | 2 | Task 1 adds directory check + `recursive: true`. |
| R1-4 | goToYaml/copyId/moveUp/moveDown only accept CodexTreeItem | High | 5 | Task 8 widens all four handlers with `instanceof` guards. |
| R1-5 | indexFile edits use `_parent_file` (wrong — needs `_computed_path`) | High | 5 | `resolveIndexNodeForEdit()` has separate `nodeKind === 'file'` branch. |
| R1-6 | `refresh()` doesn't reload index from disk | High | 1,5,6 | All post-file-op calls use `reloadTreeIndex()` (defined Stage 1, applied Stages 5-6). |
| R1-7 | fs.rename bypasses include-path maintenance | High | 6 | Cut/paste uses `moveFileInIndex()`. Folder rename uses `renameFileInIndex()`. |
| R1-8 | OrderingManager only scans `.codex.yaml` | Medium | 1 | `scanDirectory()` checks `.codex.yaml`, `.codex.json`, `.md`. |
| R1-9 | Task 0.5 uses class-style `this.*` for function-based indexGenerator | Medium | 1 | All helpers are standalone functions. |
| R1-10 | `navigateToNodeInCodeView` vs `navigateToEntityInCodeView` mismatch | Medium | 4 | Package.json ID aligned to match extension.ts. |

## Review Round 2 (R2) — Code Review Against Source

| # | Finding | Severity | Stage | Resolution |
|---|---------|----------|-------|------------|
| R2-1 | `setContextFolder` called with 1 arg instead of 2 | High | 1 | `reloadTreeIndex()` helper (Stage 1) passes `(folder, workspaceRoot)`. All later stages use this helper. |
| R2-2 | `workspaceRoot` not in scope in `registerCommands` | High | 1 | Added `getWorkspaceRoot()` module-level helper. |
| R2-3 | `await` in sync `activate()` | High | 1 | Uses fire-and-forget async IIFE. |
| R2-4 | `moveFileInIndex` missing `settings` param | High | 6 | All callers pass settings. |
| R2-5 | `copyFile` backup fails on directories | High | 2 | Checks `stat.isDirectory()`, skips backup for dirs. |
| R2-6 | `codexDoc.root` → `codexDoc.rootNode` | High | 5 | `resolveIndexNodeForEdit` uses `codexDoc.rootNode`. |
| R2-7 | `goToYaml` not widened for `CodexFieldTreeItem` | Medium | 5 | Widens for both `IndexNodeTreeItem` and `CodexFieldTreeItem`. |
| R2-8 | `addChildNode` handler rejects `indexNode` | Medium | 5 | Accepts both via `resolveIndexNodeForEdit()`. |
| R2-9 | `treeItem.documentUri` used for settings in delete | Medium | 6 | Uses `vscode.Uri.file(path.join(wsRoot, filePath))`. |
| R2-10 | `includeNode.include` → `includePath` | Medium | 7 | Uses `includePath` property. |
| R2-11 | Batch commands missing from `contributes.commands` | Medium | 4 | Added to command list. |
| R2-12 | VS Code mock underestimated | Medium | 2 | Comprehensive mock extension plan. |
| R2-13 | `canSelectMany` redundant | Low | 4 | Already enabled (Fact #38), no change needed. Acknowledged in Stage 4. |
| R2-14 | `autofixFolder` removal incomplete | Low | 1 | Covers both package.json AND extension.ts handler. |

## Review Round 3 (R3) — Remaining Gaps

| # | Finding | Severity | Stage | Resolution |
|---|---------|----------|-------|------------|
| R3-1 | Task sequencing: getWorkspaceRoot used before defined | High | 1 | Helpers moved to Task 0.5 Step 8 (defined before use). |
| R3-2 | `setContextFolder(null)` clears context | High | 1 | `reloadTreeIndex()` helper (Stage 1) checks navigation mode before calling `setContextFolder`. |
| R3-3 | `addSiblingNode` not widened | High | 5 | Step 3b added with full handler code for indexFile/indexNode. |
| R3-4 | `treeProvider.refresh()` stale in command handlers | High | 6 | All replaced with `await reloadTreeIndex()`. |
| R3-5 | Cut/paste gaps for indexNode | Medium | 6 | Cross-file inline paste deferred; document limitations. |
| R3-6 | `.md` files and parseCodex handling | Medium | 5 | `resolveIndexNodeForEdit` uses `parseCodex()` which delegates to `parseMarkdownAsCodex()`. |
| R3-7 | Duplicate `const wsRoot` in addChildFolder | Medium | 7 | Remove duplicate declaration, use single `getWorkspaceRoot()`. |
| R3-8 | OrderingManager syncFolder inconsistency | Medium | 1 | `syncFolder` auto-discovery checks all supported extensions. |
| R3-9 | Command ID mismatch fix incomplete (line 438) | Low | 4 | Fix all three occurrences in package.json. |
| R3-10 | renameFolder delegation risk | Low | 6 | Document: `renameFileInIndex` string replacement not path-segment-aware. |
| R3-OQ | Multi-select handler signature | Info | 7 | Use `(item: T, selectedItems: T[])`, not variadic `...args`. |

## Review Round 4 (R4) — Plan vs. Source Cross-Check

| # | Finding | Severity | Stage | Resolution |
|---|---------|----------|-------|------------|
| R4-1 | Stages 1-8 not implemented yet | Expected | All | Plans are plans, not code. Execution not started. |
| R4-2 | Ordering migration not implemented; order-based flow remains | Expected | 1 | Covered by Stage 1 plan. |
| R4-3 | Stage 1 missing coverage for `generatePerFolderIndex`, `cascadeRegenerateIndexes`, `generateFolderHierarchy`, `setContextFolder` command | High | 1 | **Fixed:** Added steps 4f, 4g, 4h to Stage 1. Added Facts #41-44. |
| R4-4 | Default mode is "stacked" — menus target Navigator only | High | 4 | **Fixed:** codexNode/codexField menus now use `viewItem ==` (no view filter). Keybindings use `focusedView =~ /^chapterwiseCodex/`. Fact #45. |
| R4-5 | `reloadTreeIndex()` doesn't regenerate index cache | High | 1 | **Fixed:** Added `regenerateAndReload(wsRoot)` helper (Stage 1) for disk-mutating ops. `reloadTreeIndex()` reserved for YAML-only edits. Applied in Stages 5-7. Fact #48. |
| R4-6 | Stage 2-7 modules/commands absent | Expected | 2-7 | Covered by Stage 2-7 plans. |
| R4-7 | Command ID mismatch still in code | Expected | 4 | Covered by Stage 4 Task 5 Step 2. |
| R4-8 | `moveNodeUp`/`moveNodeDown` menus on codexNode but handlers reject non-index | High | 4 | **Fixed:** Remove these two entries from codexNode menus. Keep only for indexNode/indexFile. Fact #46. |
| R4-9 | Delete behavior still legacy | Expected | 2 | Covered by Stage 2 Task 1 Step 5. |
| R4-10 | `inlineThisFile` lacks workspace path check | Medium | 7 | **Fixed:** Added `isPathWithinWorkspace()` check before reading target. Fact #47. |

## Review Round 5 (R5) — Remediation Plan Cross-Check

| # | Finding | Severity | Stage | Resolution |
|---|---------|----------|-------|------------|
| R5-1 | Command ID rename has no backward-compat alias | Medium | 4 | **Fixed:** Stage 4 Step 2 now registers alias in extension.ts. Fact #49. |
| R5-2 | Keybinding conflicts (Cmd+N/D/X/V) | Not a concern | 4 | Scoping with `focusedView =~` prevents conflicts. Already addressed. |
| R5-3 | Legacy `order` field migration for existing projects | High | 1 | **Fixed:** Stage 1 Step 4a adds fallback to `order` sorting if no `index.codex.yaml`. Startup sync auto-generates it. Fact #50. |
| R5-4 | Multi-root workspace (`workspaceFolders?.[0]`) | Medium | 1 | **Documented:** Single-root is intentional V1 scope. `getWorkspaceRoot()` (Stage 1) codifies this. Fact #51. |
