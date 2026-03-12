# Refactor extension.ts Into Command Modules

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Break the 3,243-line `src/extension.ts` into focused modules so the orchestration file is small and any extracted command module that drifts past ~300 lines is split again instead of becoming a new monolith.

**Architecture:** Extract shared state + helpers into `src/extensionState.ts`, command registrations into domain-grouped files under `src/commands/`, and tree-state management into `src/treeStateManager.ts`. The slim `extension.ts` remains the only file that exports `activate`/`deactivate` — it wires everything together.

**Tech Stack:** TypeScript, VS Code Extension API, esbuild (single-entry `src/extension.ts` → `out/extension.js`, tree-shakes automatically)

---

## Key Constraints

1. **esbuild entry point stays `src/extension.ts`** — no config changes needed since esbuild follows imports automatically.
2. **Two external consumers import from `./extension`:**
   - `src/treeProvider.ts` — static `import { getSearchIndexManager } from './extension'` (line 11) and dynamic `require('./extension').getOutputChannel()` (line 66)
   - `src/indexGenerator.ts` — dynamic `const ext = require('./extension')` (line 24), used as `ext.getOutputChannel()`. This is a **deliberate cycle-avoidance pattern** (not a static import). The dynamic `require()` at call-time will resolve to the re-export on `extension.ts`, so the workaround continues to work.
   These exports must remain on `src/extension.ts` (re-exported from `extensionState.ts`) to avoid touching consumers in this refactor.
3. **No behavior changes** — this is a pure structural refactor. Every command handler moves verbatim.
4. **Build verification:** `npm run compile` must succeed after every task. `npm run compile:tsc` for type checking.
5. **Circular import prevention:** `extensionState.ts` must use `import type` (not value imports) for types from modules that import back from `./extension` (e.g., `CodexTreeProvider` from `treeProvider.ts`). Type-only imports are erased at runtime and cannot create cycles. This applies everywhere in `extensionState.ts` and `commands/types.ts`.

## File Map (what goes where)

| New File | What moves into it | Approx lines |
|----------|-------------------|--------------|
| `src/extensionState.ts` | shared module-level state (`treeProvider`, `treeView`, `writerViewManager`, `statusBarItem`, `outputChannel`, multi-index vars, `searchIndexManager`), helper functions (`getWorkspaceRoot`, `resolveIndexNodeForEdit`, `reloadTreeIndex`, `regenerateAndReload`, `showTransientMessage`, `isValidUuid`, `isValidIndexStructure`, `withTimeout`, `findNodeById`, `updateStatusBar`, `autoDiscoverIndexFiles`, `restoreLastContext`, `syncOrderingOnStartup`) | ~350 |
| `src/treeStateManager.ts` | `expandedUpdateQueue`, `expandedUpdateTimeout`, `updateNodeExpandedState`, `flushExpandedUpdates`, `updateIndexFileExpansionState`, `updateExpandedInTree`, `determineIndexFileForNode` | ~200 |
| `src/commands/types.ts` | `CommandDeps` interface definition | ~30 |
| `src/commands/navigator.ts` | `openNavigator`, `refresh`, `filterByType`, `toggleFields`, `switchToIndexMode` | ~100 |
| `src/commands/writerView.ts` | `openWriterView`, `openWriterViewForField`, `openIndexFileInWriterView` | ~120 |
| `src/commands/navigation.ts` | `navigateToEntity`, `navigateToField`, `navigateToNode`, `navigateToEntityInCodeView`, `navigateToNodeInCodeView` (alias), `navigateToFieldInCodeView`, `goToYaml`, `showError` | ~200-300, or split into `codeNavigation.ts` |
| `src/commands/structure.ts` | `addChildNode`, `addSiblingNode`, `removeNode`, `deleteNodePermanently`, `renameNode`, `duplicateNode`, `moveNodeUp`, `moveNodeDown`, `changeColor`, `changeType`, `changeIcon`, `addField`, `deleteField`, `renameField`, `addTags`, `addRelation` | ~200-300, or split into `nodeCrud.ts`/`fieldOps.ts`/`nodeMetadata.ts`/`ordering.ts` |
| `src/commands/fileOps.ts` | `addChildFile`, `addChildFolder`, `renameFolder`, `extractToFile`, `inlineThisFile`, `openInFinder` | ~220 |
| `src/commands/clipboard.ts` | `clipboardManager` lazy init, `getClipboard`, `copyId`, `copyPath`, `cutNode`, `pasteNodeAsChild`, `pasteNodeAsSibling` | ~200 |
| `src/commands/trash.ts` | `moveToTrash`, `restoreFromTrash`, `emptyTrash` | ~100 |
| `src/commands/batch.ts` | `batchMoveToTrash`, `batchAddTags` | ~80 |
| `src/commands/tools.ts` | `autoFix`, `autoFixRegenIds`, `explodeCodex`, `implodeCodex`, `updateWordCount`, `generateTags`, `autofixFolder` | ~120 |
| `src/commands/index.ts` | `generateIndex`, `regenerateIndex`, `createIndexFile`, `openIndexFile` | ~60 |
| `src/commands/context.ts` | `setContextFolder`, `setContextFile`, `resetContext` | ~200 |
| `src/commands/convert.ts` | `convertToMarkdown`, `convertToCodex` | ~20 |
| `src/commands/search.ts` | `search`, `rebuildSearchIndex` + search initialization/registration (`registerSearchCommands`) | ~120 |
| `src/commands/git.ts` | `git.setupWizard`, `git.initRepository`, `git.ensureGitIgnore`, `git.setupLFS` | ~30 |
| `src/commands/register.ts` | `registerAllCommands()` — calls all domain registrators | ~40 |
| `src/extension.ts` (slimmed) | `activate()`, `deactivate()`, re-exports (`log`, `getOutputChannel`, `getSearchIndexManager`) | ~120 |

---

## Task 1: Create `src/commands/types.ts` — the shared dependency interface

**Files:**
- Create: `src/commands/types.ts`

**Step 1: Write the types file**

```typescript
// src/commands/types.ts
import * as vscode from 'vscode';
import type { CodexTreeProvider, CodexTreeItemType } from '../treeProvider';
import type { WriterViewManager } from '../writerView';
import type { CodexNode } from '../codexModel';
import type { IndexNodeTreeItem } from '../treeProvider';
import type { MultiIndexManager } from '../multiIndexManager';
import type { SubIndexTreeProvider } from '../subIndexTreeProvider';
import type { MasterIndexTreeProvider } from '../masterIndexTreeProvider';
import type { SearchIndexManager } from '../search';

export interface CommandDeps {
  treeProvider: CodexTreeProvider;
  treeView: vscode.TreeView<CodexTreeItemType>;
  writerViewManager: WriterViewManager;
  outputChannel: vscode.OutputChannel;

  // Multi-index state
  multiIndexManager: MultiIndexManager | undefined;
  masterTreeProvider: MasterIndexTreeProvider | undefined;
  subIndexProviders: SubIndexTreeProvider[];
  subIndexViews: vscode.TreeView<CodexTreeItemType>[];

  // Search
  getSearchIndexManager: () => SearchIndexManager | null;

  // Helpers
  getWorkspaceRoot: () => string | undefined;
  reloadTreeIndex: () => Promise<void>;
  regenerateAndReload: (wsRoot: string) => Promise<void>;
  resolveIndexNodeForEdit: (
    treeItem: IndexNodeTreeItem,
    wsRoot: string
  ) => Promise<{ doc: vscode.TextDocument; node: CodexNode } | null>;
  showTransientMessage: (message: string, duration?: number) => void;
  findNodeById: (node: CodexNode, targetId: string) => CodexNode | null;
}
```

**Step 2: Verify it compiles**

Run: `npm run compile:tsc 2>&1 | head -20`
Expected: No new errors (pre-existing errors are OK)

**Step 3: Commit**

```
git add src/commands/types.ts
git commit -m "refactor: add CommandDeps type for extension.ts decomposition"
```

---

## Task 2: Create `src/extensionState.ts` — shared state and helpers

**Files:**
- Create: `src/extensionState.ts`

**Step 1: Write the state module**

Move these items from `extension.ts` into `src/extensionState.ts`:
- Module-level variables: `treeProvider`, `treeView`, `writerViewManager`, `statusBarItem`, `outputChannel`, `multiIndexManager`, `masterTreeProvider`, `subIndexProviders`, `subIndexViews`, `searchIndexManager`
- Helper functions: `showTransientMessage`, `isValidUuid`, `isValidIndexStructure`, `getWorkspaceRoot`, `resolveIndexNodeForEdit`, `reloadTreeIndex`, `regenerateAndReload`, `getOutputChannel`, `withTimeout`, `restoreLastContext`, `autoDiscoverIndexFiles`, `syncOrderingOnStartup`, `updateStatusBar`, `findNodeById`
- Import `CommandDeps` from `src/commands/types.ts` rather than redefining it here
- Export an `initState()` function that `activate()` calls to initialize the state
- Export a `getDeps(): CommandDeps` function that `extension.ts` passes into command registrars
- Export `getOutputChannel()`, `getSearchIndexManager()`, `log()` for external consumers

**Dependency rule:** Command modules should receive dependencies via `CommandDeps` injection, not by importing `extensionState.ts` directly. The only intentional exception is `search.ts`, which may import `setSearchIndexManager()` as a write-back hook after it constructs the manager.

**IMPORTANT:** All imports from modules that import back from `./extension` (e.g., `CodexTreeProvider` from `treeProvider.ts`) MUST use `import type` to prevent circular dependencies at the TypeScript level.

Pattern:
```typescript
// src/extensionState.ts
import type { CodexTreeProvider, CodexTreeItemType } from './treeProvider';  // ← import TYPE, not value
import type { WriterViewManager } from './writerView';
// ... etc ...

let treeProvider: CodexTreeProvider;
let searchIndexManager: SearchIndexManager | null = null;
// ... other state ...

export function initState(tp: CodexTreeProvider, tv: ..., ...): void {
  treeProvider = tp;
  // ...
}

// Write-back setter — called by commands/search.ts after creating SearchIndexManager
export function setSearchIndexManager(sim: SearchIndexManager | null): void {
  searchIndexManager = sim;
}

export function getDeps(): CommandDeps {
  return {
    treeProvider,
    treeView,
    writerViewManager,
    outputChannel,
    // getSearchIndexManager is a FUNCTION (not a value snapshot) so it always
    // reads the current module-level variable, even if searchIndexManager is
    // set after getDeps() is called.
    getSearchIndexManager: () => searchIndexManager,
    // ... all other helpers bound to module state ...
  };
}

// Cleanup — called from deactivate() for non-subscription resources and ref cleanup.
// Tree views and status bar items are already owned by context.subscriptions.
export function disposeState(): void {
  try { writerViewManager?.dispose(); } catch (e) { /* swallow */ }
  subIndexViews.length = 0;
  subIndexProviders.length = 0;
  try { (multiIndexManager as any)?.dispose?.(); } catch (e) { /* swallow */ }
  try { (masterTreeProvider as any)?.dispose?.(); } catch (e) { /* swallow */ }
}

// Re-exported for external consumers (treeProvider.ts, indexGenerator.ts)
export function getOutputChannel(): vscode.OutputChannel | undefined { return outputChannel; }
export function getSearchIndexManager(): SearchIndexManager | null { return searchIndexManager; }
export function log(message: string): void { outputChannel?.appendLine(message); }
```

**Step 2: Verify it compiles**

Run: `npm run compile:tsc 2>&1 | head -20`

**Step 3: Commit**

```
git add src/extensionState.ts
git commit -m "refactor: extract shared state and helpers to extensionState.ts"
```

---

## Task 3: Create `src/treeStateManager.ts` — Phase 5 tree expansion logic

**Files:**
- Create: `src/treeStateManager.ts`

**Step 1: Move tree state functions**

Move from `extension.ts`:
- `expandedUpdateQueue`, `expandedUpdateTimeout` (module-level state)
- `updateNodeExpandedState()`
- `flushExpandedUpdates()`
- `updateIndexFileExpansionState()`
- `updateExpandedInTree()`
- `determineIndexFileForNode()`

These functions need `outputChannel` and the `isValidUuid`/`isValidIndexStructure` helpers — import them from `extensionState.ts`.

Export `updateNodeExpandedState()` (used by `activate()` for tree view expand/collapse handlers) and a `disposeTreeState()` function (clears the timeout + queue, called from `deactivate()`).

**Step 2: Verify it compiles**

Run: `npm run compile:tsc 2>&1 | head -20`

**Step 3: Commit**

```
git add src/treeStateManager.ts
git commit -m "refactor: extract tree state management to treeStateManager.ts"
```

---

## Task 4: Create command modules (one file per domain)

This is the bulk of the work. Create each file under `src/commands/`, each exporting a single `registerXxxCommands(context: vscode.ExtensionContext, deps: CommandDeps): void` function.

If a planned module ends up above ~300 lines once extracted, split it immediately instead of forcing the initial bucket. Recommended split points:
- `navigation.ts` -> `navigation.ts` + `codeNavigation.ts`
- `structure.ts` -> `nodeCrud.ts`, `fieldOps.ts`, `nodeMetadata.ts`, `ordering.ts`
- `batch.ts` stays for genuinely multi-item flows only (`duplicateNode` belongs with structure/node CRUD)

**Files to create (all under `src/commands/`):**

1. `navigator.ts` — commands: `openNavigator`, `refresh`, `filterByType`, `toggleFields`, `switchToIndexMode`
2. `writerView.ts` — commands: `openWriterView`, `openWriterViewForField`, `openIndexFileInWriterView`
3. `navigation.ts` — commands: `navigateToEntity`, `navigateToField`, `navigateToNode`, `navigateToEntityInCodeView`, `navigateToNodeInCodeView` (alias), `navigateToFieldInCodeView`, `goToYaml`, `showError`. **Note:** `navigateToNode` has a dual calling convention — it is called with an `IndexNodeTreeItem` from tree context menus, but also called with a plain string node ID from the search command (`vscode.commands.executeCommand('chapterwiseCodex.navigateToNode', result.id)`). The handler must handle both signatures.
4. `structure.ts` — commands: `addChildNode`, `addSiblingNode`, `removeNode`, `deleteNodePermanently`, `renameNode`, `duplicateNode`, `moveNodeUp`, `moveNodeDown`, `changeColor`, `changeType`, `changeIcon`, `addField`, `deleteField`, `renameField`, `addTags`, `addRelation`
5. `fileOps.ts` — commands: `addChildFile`, `addChildFolder`, `renameFolder`, `extractToFile`, `inlineThisFile`, `openInFinder`
6. `clipboard.ts` — commands: `copyId`, `copyPath`, `cutNode`, `pasteNodeAsChild`, `pasteNodeAsSibling` (plus `clipboardManager` lazy init + `getClipboard` helper, scoped to this module)
7. `trash.ts` — commands: `moveToTrash`, `restoreFromTrash`, `emptyTrash`
8. `batch.ts` — commands: `batchMoveToTrash`, `batchAddTags`
9. `tools.ts` — commands: `autoFix`, `autoFixRegenIds`, `explodeCodex`, `implodeCodex`, `updateWordCount`, `generateTags`, `autofixFolder`
10. `index.ts` — commands: `generateIndex`, `regenerateIndex`, `createIndexFile`, `openIndexFile`
11. `context.ts` — commands: `setContextFolder`, `setContextFile`, `resetContext`
12. `convert.ts` — commands: `convertToMarkdown`, `convertToCodex`
13. `search.ts` — commands: `search`, `rebuildSearchIndex` plus `registerSearchCommands()` for search initialization/registration
14. `git.ts` — commands: `git.setupWizard`, `git.initRepository`, `git.ensureGitIgnore`, `git.setupLFS`

**Step 1: Create each command module**

For each file, the pattern is identical:

```typescript
// src/commands/navigator.ts
import * as vscode from 'vscode';
import type { CommandDeps } from './types';
// ... domain-specific imports ...

export function registerNavigatorCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, outputChannel } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.openNavigator', () => {
      // ... verbatim handler code from extension.ts ...
    })
  );
  // ... more commands ...
}
```

Each handler's code is moved verbatim. The only change is that references to module-level state (`treeProvider`, `writerViewManager`, `outputChannel`, etc.) are replaced with `deps.treeProvider`, `deps.writerViewManager`, etc. — or destructured at the top of the function.

**Important notes for specific modules:**

- **`navigator.ts`**: `switchToIndexMode` has a non-obvious dependency on `deps.getSearchIndexManager()` to reinitialize search when entering index mode. Destructure it alongside the other deps.
- **`clipboard.ts`**: The `clipboardManager` lazy init (`let clipboardManager`, `getClipboard` async helper) lives inside this module as module-level state. It needs `context` for `subscriptions.push(cm)` and `treeProvider` for `setIsCutFn`.
- **`search.ts`**: The search initialization logic (creating `SearchIndexManager`, wiring `onBuildProgress`/`onIndexReady`, search command, rebuild command) all moves here. Export `registerSearchCommands(context, deps)` so it matches the rest of the command modules. **Write-back:** After creating the `SearchIndexManager`, call `setSearchIndexManager(sim)` from `extensionState.ts` so that `deps.getSearchIndexManager()` (which reads the module-level variable) returns the live instance. Also push the dispose handler to `context.subscriptions` (same as current code) so cleanup happens automatically.
- **`context.ts`**: Needs access to `treeView` (to set `.title`), `multiIndexManager`, `masterTreeProvider`, `subIndexProviders`, `subIndexViews` — all available via `deps`.
- **`tools.ts`**: The `autofixFolder` command uses `fs.readFileSync`/`writeFileSync` — note this violates the async-only rule from CLAUDE.md but keep it as-is for this refactor (no behavior changes).

**Step 2: Create `src/commands/register.ts`**

```typescript
// src/commands/register.ts
import * as vscode from 'vscode';
import type { CommandDeps } from './types';
import { registerNavigatorCommands } from './navigator';
import { registerWriterViewCommands } from './writerView';
import { registerNavigationCommands } from './navigation';
import { registerStructureCommands } from './structure';
import { registerFileOpsCommands } from './fileOps';
import { registerClipboardCommands } from './clipboard';
import { registerTrashCommands } from './trash';
import { registerBatchCommands } from './batch';
import { registerToolsCommands } from './tools';
import { registerIndexCommands } from './index';
import { registerContextCommands } from './context';
import { registerConvertCommands } from './convert';
import { registerSearchCommands } from './search';
import { registerGitCommands } from './git';

export function registerAllCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  registerNavigatorCommands(context, deps);
  registerWriterViewCommands(context, deps);
  registerNavigationCommands(context, deps);
  registerStructureCommands(context, deps);
  registerFileOpsCommands(context, deps);
  registerClipboardCommands(context, deps);
  registerTrashCommands(context, deps);
  registerBatchCommands(context, deps);
  registerToolsCommands(context, deps);
  registerIndexCommands(context, deps);
  registerContextCommands(context, deps);
  registerConvertCommands(context, deps);
  registerSearchCommands(context, deps);
  registerGitCommands(context, deps);
}
```

**Step 3: Verify it compiles**

Run: `npm run compile:tsc 2>&1 | head -20`

**⚠️ Note:** At this point all `src/commands/*.ts` files are **dead code** — nothing imports them yet. The compile check only validates that they have no internal type errors. True correctness (no missing deps, no broken wiring) is only verified after Task 5 when `extension.ts` calls `registerAllCommands()`. Do not rely on this checkpoint alone.

**Step 4: Commit**

```
git add src/commands/
git commit -m "refactor: extract all command handlers to src/commands/ modules"
```

---

## Task 5: Slim down `src/extension.ts`

**Files:**
- Modify: `src/extension.ts` (rewrite to ~120 lines)

**Step 1: Rewrite extension.ts**

The new `extension.ts` should:

1. Import from `extensionState.ts`, `treeStateManager.ts`, `commands/register.ts`
2. `activate()`:
   - Preserve the current top-level try/catch and activation logging
   - Create `outputChannel`, `treeProvider`, `treeView`, `dragController`, multi-index setup, `writerViewManager`, `statusBarItem`
   - Preserve setup side effects from the current activation path: wire `writerViewManager.setTreeProvider(treeProvider)`, keep the drag-controller disposal in `context.subscriptions`, and keep the status bar item command/subscription wiring
   - Call `initState(...)` from `extensionState.ts`
   - Wire tree view expand/collapse handlers via `updateNodeExpandedState` from `treeStateManager.ts`
   - Run the existing non-blocking ordering sync startup block (`getOrderingManager().syncWithFilesystem()`) via `syncOrderingOnStartup()`
   - Call `registerAllCommands(context, getDeps())` from `commands/register.ts`
   - Call `registerScrivenerImport(context)`
   - Call `initializeValidation(context)`
   - Call `updateStatusBar()` once, then wire the active-editor status bar update listener
   - Call `autoDiscoverIndexFiles()`, `restoreLastContext(context)`
3. `deactivate()`:
   - Call `disposeTreeState()` from `treeStateManager.ts` (clears expand/collapse debounce timer + queue)
   - Call `disposeState()` from `extensionState.ts` for non-subscription resources (`writerViewManager`, `multiIndexManager`, `masterTreeProvider`) and to clear multi-index arrays/references
   - Do **not** invent a second ownership model for VS Code UI disposables: `treeView`, `statusBarItem`, the master tree view, and sub-index views are already in `context.subscriptions` (directly or via `createCodexTreeView`)
   - Call all module `dispose*()` functions (`disposeAutoFixer`, `disposeExplodeCodex`, etc.) — same as current
   - Dispose `outputChannel` last
   - Note: `searchIndexManager` disposal is handled automatically via `context.subscriptions` (pushed during `registerSearchCommands()`), no explicit call needed
4. Re-export `getOutputChannel`, `getSearchIndexManager`, `log` from `extensionState.ts` so external consumers (`treeProvider.ts`, `indexGenerator.ts`) don't need to change their imports.

```typescript
// Re-exports for external consumers
export { getOutputChannel, getSearchIndexManager, log } from './extensionState';
```

**Step 2: Verify full build**

Run: `npm run compile`
Expected: Build succeeds, `out/extension.js` is produced.

**Step 3: Verify type checking**

Run: `npm run compile:tsc 2>&1 | head -30`

**Step 4: Verify tests still pass**

Run: `npm test`

**Step 5: Commit**

```
git add src/extension.ts
git commit -m "refactor: slim extension.ts to ~120 lines, delegate to modules"
```

---

## Task 6: Final verification

**Step 1: Full clean build**

Run: `rm -rf out && npm run compile`
Expected: `out/extension.js` produced with no errors.

**Step 2: Type check**

Run: `npm run compile:tsc`

**Step 3: Tests**

Run: `npm test`

**Step 4: Package**

Run: `npx vsce package --no-dependencies 2>&1 | tail -5`
Expected: `.vsix` file produced.

**Step 5: Quick smoke test (manual)**

Install the `.vsix` in VS Code, open a workspace with `.codex.yaml` files, and verify:
- Tree view loads
- Context folder setting works
- Writer View opens
- Commands work from tree context menu

**Step 6: Commit (if any fixups needed)**

```
git add -A
git commit -m "refactor: final fixups for extension.ts decomposition"
```

---

## Risk Notes

- **Circular imports**: `extensionState.ts` must NOT import from `commands/*`. Command modules receive dependencies via the `CommandDeps` interface (injected, not directly imported). Both `extensionState.ts` and `commands/types.ts` must use `import type` (not value imports) for any types from modules that import back from `./extension` (e.g., `CodexTreeProvider`). Type-only imports are erased at runtime and cannot create cycles. esbuild bundles everything into one file so runtime cycles wouldn't manifest anyway, but `tsc --noEmit` will flag potential cycles if value imports are used.
- **Startup behavior parity**: Keep the existing non-blocking ordering-sync startup block. Omitting it would be a real behavior change, not a refactor.
- **`getSearchIndexManager` is a function, not a snapshot**: `getDeps()` returns `getSearchIndexManager: () => searchIndexManager` — a closure that reads the module-level variable at call time. This is critical because `searchIndexManager` is set by `registerSearchCommands()` during `registerAllCommands()`, after `getDeps()` has already been called. If it were a value snapshot (`searchIndexManager` directly), it would capture `null` permanently.
- **Subscription-owned UI disposables**: `createCodexTreeView()` already pushes the main navigator tree view to `context.subscriptions`, and `activate()` already pushes the master/sub-index tree views plus the status bar item there too. The refactor should keep that ownership model explicit rather than assuming those views must be manually disposed from `deactivate()`.
- **`indexGenerator.ts` dynamic require**: Uses `const ext = require('./extension')` inside a function body to avoid circular imports. The re-export `export { getOutputChannel } from './extensionState'` on `extension.ts` satisfies this without touching `indexGenerator.ts`.
- **`navigateToNode` dual signature**: Called both with `IndexNodeTreeItem` (from tree menus) and with a plain string ID (from the search command via `executeCommand`). The handler must handle both.
- **`as any` casts**: The current code has many `(treeItem.indexNode as any)._node_kind` patterns. These are moved verbatim — fixing them is out of scope for this refactor.
- **Sync fs calls in `autofixFolder`**: Known violation of the async-only convention. Out of scope to fix here.
- **Test coverage**: Existing tests are for `colorManager`, `orderingManager`, `trashManager`, `clipboardManager`, `structureEditor` — none directly test `extension.ts` command handlers. This refactor doesn't change testable behavior, so existing tests should continue to pass.
