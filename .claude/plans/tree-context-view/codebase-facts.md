# Codebase Facts (Shared Reference)

These facts MUST be respected throughout ALL stages. Referenced by number (e.g., "Fact #8").

## API Patterns

1. **Lazy imports:** `structureEditor` is NOT persistent. Every handler:
   ```typescript
   const { getStructureEditor } = await import('./structureEditor');
   const editor = getStructureEditor();
   ```
   Same for settings:
   ```typescript
   const { getSettingsManager } = await import('./settingsManager');
   const settings = await getSettingsManager().getSettings(document.uri);
   ```

2. **`when` clause pattern:** For CRUD menus (add/edit/delete/move), use `viewItem ==` as the primary filter (no view filter) so menus appear in Navigator, Master, AND stacked Index0-7 views (Fact #45). For Navigator-only operations (e.g., setContextFolder), use `view == chapterwiseCodexNavigator`. For keybindings, use `focusedView =~ /^chapterwiseCodex/` to match all views. Index-only node types (`indexNode`, `indexFile`, `indexFolder`) naturally only appear in index-enabled views, so no extra view filter is needed for them.

3. **Command handler types:** Existing commands only accept `CodexTreeItem`. Widening to also accept `IndexNodeTreeItem` uses `instanceof` guards.

4. **`buildYamlPath` is private** on `CodexStructureEditor`. New operations that need it must be class methods.

5. **`generateUuid`** uses `crypto.randomUUID()`. No Math.random fallback.

6. **`PROSE_FIELDS`** in `codexModel.ts`: `['body', 'summary', 'description', 'content', 'text']`. Import and extend (adding `'notes'`).

7. **`path` and `YAML` are already imported** at top of `extension.ts`. Don't re-import.

## Index Node Types

8. **`IndexNodeTreeItem.documentUri` is the INDEX CACHE** (`.index.codex.json`), NOT the target file.
   - For `indexNode`/`indexField`: use `treeItem.resourceUri` or `_parent_file`
   - For `indexFile`: use `treeItem.indexNode._computed_path`
   - NEVER use `treeItem.documentUri` for edit targets

9. **`autofixFolder` will be REMOVED** — `order` field is deprecated.

10. **`IndexChildNode`** has `name` (required) and `title` (optional). Display: `indexNode.title || indexNode.name`.

11. **`buildYamlPath` BUG** — `CodexNode.path` already has `'children'` segments. Current impl at structureEditor.ts:1018 injects EXTRA `'children'`. Fix: simple pass-through.

12. **Index node kinds:**
    - `indexNode` (`_node_kind: 'node'`): entity WITHIN a file, has `_parent_file`, NO `_computed_path`
    - `indexFile` (`_node_kind: 'file'`): file on disk, HAS `_computed_path` and `_filename`
    - `indexFolder` (`_node_kind: 'folder'`): directory
    - `indexField` (`_node_kind: 'field'`): field on a node, has `_field_name` and parent reference

13. **Index maintenance required after file ops.** `treeProvider.refresh()` only fires `_onDidChangeTreeData` — does NOT rebuild index. Must call `generateIndex()` then `setContextFolder()` to reload.

14. **Build: `npm run compile`** (esbuild). NOT `tsc --noEmit` (has known strict issues).

## Ordering System

15. **Drag-and-drop uses fractional `order` field** in `.index.codex.json`. Must migrate to `index.codex.yaml` array position.

16. **Multi-view:** Navigator + Master + Index0-7. CRUD menus use `viewItem ==` (no view filter) to work in all views (Fact #2, #45). Only Navigator-specific ops use `view == chapterwiseCodexNavigator`.

17. **UNIFIED ORDERING:** `index.codex.yaml` array position = display order. `order` field DEPRECATED. Key files: indexGenerator.ts, structureEditor.ts, dragDropController.ts, indexParser.ts.

18. **`index.codex.yaml` format:**
    ```yaml
    metadata:
      formatVersion: "1.2"
    id: "project-root"
    type: index
    name: "My Novel"
    children:
      - name: "Chapters"
        type: folder
        children:
          - name: "intro.codex.yaml"
    ```

## Trash & Delete

19. **TRASH: `.chapterwise/trash/` only.** `removeFileFromIndex()` must use `trashManager.moveToTrash()` for soft deletes.

20. **Folder deletion requires `recursive: true`.**

## Handler Widening

21. **`goToYaml`, `copyId`, `moveNodeUp`, `moveNodeDown`** only accept `CodexTreeItem`. Must widen with instanceof guards.

22. **`indexFile` edits need `_computed_path`**, not `_parent_file`. For `indexFile`, open via `_computed_path`, use root node.

23. **Tree reload pattern:** Two helpers for different scenarios (Fact #48):

    **`regenerateAndReload()`** — for operations that mutate files on disk (add/delete/move/rename file):
    ```typescript
    async function regenerateAndReload(wsRoot: string): Promise<void> {
      const { generateIndex } = await import('./indexGenerator');
      await generateIndex({ workspaceRoot: wsRoot });
      await reloadTreeIndex();
    }
    ```

    **`reloadTreeIndex()`** — for operations that only edit YAML content in open documents (no disk mutation):
    ```typescript
    async function reloadTreeIndex(): Promise<void> {
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const contextFolder = treeProvider.getContextFolder();
      if (contextFolder) {
        await treeProvider.setContextFolder(contextFolder, wsRoot);
      } else if (treeProvider.getNavigationMode() === 'index') {
        await treeProvider.setContextFolder('.', wsRoot);
      } else {
        treeProvider.refresh();
      }
    }
    ```

    **Use `regenerateAndReload(wsRoot)`** after: creating files, deleting files, moving files, renaming files, duplicating files, restoring from trash.
    **Use `reloadTreeIndex()`** after: adding fields, changing type, adding tags, renaming inline nodes, removing inline nodes, setting emoji.

    **WARNING:** `setContextFolder(null, wsRoot)` CLEARS context to FILES mode.

24. **Move/rename must update include directives.** Use `structureEditor.renameFileInIndex()` or `moveFileInIndex()`.

25. **OrderingManager must scan `.codex.yaml`, `.codex.json`, `.md`.**

26. **indexGenerator.ts is function-based** — standalone functions, NOT class methods.

27. **COMMAND ID MISMATCH:** `package.json:195` has `navigateToNodeInCodeView` but extension.ts registers `navigateToEntityInCodeView`. Fix in package.json.

28. **RENAME on `indexFile`** = filename rename on disk + include path updates via `renameFileInIndex()`.

29. **Sub-index views INCLUDED** in context menus. CRUD menus use `viewItem ==` (no view filter) so they appear in Navigator, Master, and stacked Index0-7 views (Fact #45). Only Navigator-specific operations (e.g., setContextFolder) keep `view == chapterwiseCodexNavigator`.

30. **`activate()` is sync** (returns `void`). Async startup uses fire-and-forget async IIFE.

31. **`workspaceRoot` NOT in `registerCommands()` scope.** Each handler resolves on demand via `getWorkspaceRoot()`.

32. **`setContextFolder` requires TWO args:** `(folderPath: string | null, workspaceRoot: string)`.

33. **`CodexDocument.rootNode`** — NOT `.root`.

34. **`CodexNode.includePath`** — NOT `.include`.

35. **`moveFileInIndex` requires `settings` parameter.**

36. **`copyFile` backup fails on directories.** Must check `stat.isDirectory()`.

37. **VS Code mock is minimal.** Lacks EventEmitter, workspace.fs, Position, Selection, etc.

38. **`canSelectMany` only enabled on Navigator view** (treeProvider.ts:1417). Master view (extension.ts:221) and stacked sub-index views Index0-7 (extension.ts:232) do NOT have `canSelectMany`. **Must add `canSelectMany: true` to Master and sub-index view creation** for multi-select batch operations to work in default stacked mode.

39. **`autofixFolder` handler at extension.ts:1700.** Removal must cover both package.json AND extension.ts.

40. **`.md` files supported via `parseCodex()`** which delegates to `parseMarkdownAsCodex()` (codexModel.ts:570).

## Index Generation Pipeline (R4-3)

41. **`generatePerFolderIndex()`** (indexGenerator.ts:1171) creates per-folder `.index.codex.json` with sequential `order` values (line ~1259). Must stop assigning `order` values after ordering migration.

42. **`cascadeRegenerateIndexes()`** (indexGenerator.ts:1299) regenerates folder index + parent indexes + top-level `generateIndex()`. Used by ordering methods. After migration, this still works (generates cache from `index.codex.yaml` order).

43. **`generateFolderHierarchy()`** (indexGenerator.ts:1334) recursively generates per-folder indexes from deepest to shallowest. Called by the `setContextFolder` command in extension.ts:1881. After migration, this inherits order from `index.codex.yaml`.

44. **`setContextFolder` COMMAND** (extension.ts:1855-1899) calls `generateFolderHierarchy()` then `treeProvider.setContextFolder()`. This command DOES regenerate indexes. But `treeProvider.setContextFolder()` the tree provider METHOD (treeProvider.ts:854) only reads `.index.codex.json` from disk — it does NOT regenerate.

## View Architecture (R4-4)

45. **Default display mode is "stacked"** (package.json:694). The stacked mode uses `chapterwiseCodexIndex0-7` and `chapterwiseCodexMaster` views, NOT `chapterwiseCodexNavigator`. Context menus scoped to `chapterwiseCodexNavigator` will NOT appear in stacked mode. **Decision (R4-4):** CRUD menus use `viewItem ==` (no view filter) so they appear in all views. Keybindings use `focusedView =~ /^chapterwiseCodex/`. Only Navigator-specific operations (e.g., setContextFolder) keep `view == chapterwiseCodexNavigator`.

46. **`moveNodeUp`/`moveNodeDown` menu-handler mismatch** (pre-existing). Menus are wired for `codexNode` in Navigator (package.json:381-388), but handlers REJECT non-IndexNodeTreeItem (extension.ts:1587). In FILES mode, these menu items show but do nothing useful. **Decision (R4-8):** Remove `moveNodeUp`/`moveNodeDown` from codexNode menus. Keep only for `indexNode`/`indexFile`. Inline reorder in FILES mode uses drag-and-drop instead.

## Security

47. **Path traversal in `inlineThisFile`**: The planned `inlineThisFile` resolves `includePath` relative to the document, but does NOT verify the resolved path is within the workspace. Must add `isPathWithinWorkspace()` check (already exists in `src/writerView/utils/helpers.ts`) before reading the target file.

## Reload Strategy (R4-5)

48. **`reloadTreeIndex()` only reads cache — does NOT regenerate.** `treeProvider.setContextFolder()` at treeProvider.ts:895 calls `fs.readFileSync(indexPath)` to read `.index.codex.json` — it does NOT call `generateIndex()` or `generateFolderHierarchy()`. If the cache is stale (e.g., after adding a file to disk), `reloadTreeIndex()` alone will show stale data. Handlers that mutate files MUST call `cascadeRegenerateIndexes()` (for single-folder changes) or `generateFolderHierarchy()` (for broad changes) BEFORE `reloadTreeIndex()`. **IMPORTANT:** `generateIndex()` alone is NOT sufficient — it only regenerates the TOP-LEVEL `.index.codex.json` and does NOT update per-folder indexes. Use `cascadeRegenerateIndexes(wsRoot, changedFolderPath)` for targeted regeneration (changed folder + parents + top-level) or `generateFolderHierarchy(wsRoot, startFolder)` for full recursive regeneration. After index regeneration, stacked views (Master + Index0-7) must also be refreshed — `reloadTreeIndex()` handles Navigator but does NOT update `masterTreeProvider` or `subIndexProviders`. See Fact #52 for the full refresh pattern.

## Backward Compatibility

49. **Command ID rename needs alias.** Renaming `navigateToNodeInCodeView` → `navigateToEntityInCodeView` in package.json breaks users with custom keybindings for the old ID. Register a backward-compat alias in extension.ts that delegates to the new ID. Can remove in next major version.

50. **Legacy `order` field migration.** Existing projects have `.index.codex.json` files with numeric `order` fields. On upgrade:
    - `OrderingManager.syncWithFilesystem()` runs at startup and generates `index.codex.yaml` if missing
    - `sortChildrenRecursive()` falls back to `order` field sorting if `index.codex.yaml` doesn't exist yet
    - After first launch, `index.codex.yaml` becomes the source of truth and legacy `order` fields are ignored
    - No manual migration step required — it's transparent

## Workspace Model

51. **Single-root assumption.** `getWorkspaceRoot()` uses `workspaceFolders?.[0]` — always picks the first folder. This is intentional for V1: the extension's tree provider, settings manager, and index generator all assume single-root. Multi-root support is out of scope. If needed later, `getWorkspaceRoot()` would need to accept a file URI and resolve via `vscode.workspace.getWorkspaceFolder(uri)`.

## Full Tree Refresh (Gap Fix)

52. **Full tree refresh pattern (stacked mode).** `regenerateAndReload()` as defined in Stage 1 calls only `generateIndex()` which regenerates ONLY the top-level `.index.codex.json`. This is INSUFFICIENT for subfolder contexts and stacked views. The correct pattern for disk-mutating operations is:

    ```typescript
    async function regenerateAndReload(wsRoot: string): Promise<void> {
      const contextFolder = treeProvider.getContextFolder();
      const folderToRegenerate = contextFolder || '.';

      // Step 1: Regenerate per-folder + top-level indexes
      const { cascadeRegenerateIndexes } = await import('./indexGenerator');
      await cascadeRegenerateIndexes(wsRoot, folderToRegenerate);

      // Step 2: Reload Navigator tree
      await reloadTreeIndex();

      // Step 3: Refresh stacked views (Master + Index0-7)
      if (multiIndexManager && masterTreeProvider) {
        const indexes = await multiIndexManager.discoverIndexes(wsRoot);
        masterTreeProvider.setManager(multiIndexManager, wsRoot);
        const subIndexes = multiIndexManager.getSubIndexes();
        subIndexes.forEach((index, i) => {
          if (i < subIndexProviders.length) {
            subIndexProviders[i].setIndex(index);
          }
        });
        for (let i = subIndexes.length; i < subIndexProviders.length; i++) {
          subIndexProviders[i].setIndex(null);
        }
      }
    }
    ```

    **Key functions in indexGenerator.ts:**
    - `generateIndex()` (line 125) — top-level only, writes `.index.codex.json` at root
    - `generatePerFolderIndex()` (line 1171) — single folder's `.index.codex.json`
    - `cascadeRegenerateIndexes()` (line 1299) — changed folder + parents + top-level
    - `generateFolderHierarchy()` (line 1334) — ALL folders recursively + top-level (heavy)

    Use `cascadeRegenerateIndexes` for targeted ops (trash one file, rename, move).
    Use `generateFolderHierarchy` only for broad ops (initial context set, bulk changes).

53. **File creation must use existing safety pipelines.** When creating new `.codex.yaml` files (e.g., `addSiblingNode` for `indexFile`, `addChildFile`), use:
    - `structureEditor.slugifyName()` for filename sanitization (NOT inline regex)
    - `isPathWithinWorkspace()` or `isPathWithinRoot()` for path traversal validation
    - `getSettingsManager().getSettings()` to respect user naming conventions
    - Reject path separators and `..` in user-provided names
    - Use settings-driven format version (`formatVersion: "1.2"` or from settings)

54. **`renameFolder` requires folder-safe path rewriting.** `renameFileInIndex()` uses `updateIncludePaths()` which does string replacement of old path → new path. For folders, renaming `ch` could match `chapter/` inside include paths. **Implementation must use path-segment-aware replacement** — match on `oldPath + path.sep` prefix, not substring. This is a known limitation (R3-10) that must be addressed with a dedicated `renameFolderInIndex()` method or by ensuring `updateIncludePaths()` uses segment-aware matching.

55. **`TrashManager.moveToTrash()` must call `ensureGitignore()`.** The `ensureGitignore()` method adds `.chapterwise/trash/` to `.gitignore`. It must be called inside `moveToTrash()` (before or after the file move), NOT left to callers. This ensures trash is always gitignored regardless of entry point.
