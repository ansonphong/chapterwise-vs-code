# Extension Activation Hardening Plan (Comprehensive)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure proper resource cleanup on deactivation, graceful error handling during activation, and prevent extension hangs.

**Architecture:** Add comprehensive disposal tracking, timeout protection, and graceful degradation for non-critical components.

**Tech Stack:** TypeScript, VS Code Extension API

---

## Summary of Changes

| Category | Changes |
|----------|---------|
| Resource Cleanup | Dispose tree views, clear global state, dispose managers |
| Error Handling | Timeout on state restoration, graceful non-critical failures |
| Robustness | Individual error handling for components |

---

### Task 1: Add Comprehensive Resource Cleanup in deactivate()

**Files:**
- Modify: `src/extension.ts:2096-2108`

**Step 1: Update deactivate function with complete cleanup**

Find lines 2096-2108:

```typescript
export function deactivate(): void {
  writerViewManager?.dispose();
  disposeAutoFixer();
  disposeExplodeCodex();
  disposeImplodeCodex();
  disposeWordCount();
  disposeTagGenerator();
  disposeConvertFormat();
  disposeGitSetup();
  disposeScrivenerImport();
  outputChannel?.appendLine('ChapterWise Codex extension deactivated');
  outputChannel?.dispose();
}
```

Replace with:

```typescript
export function deactivate(): void {
  outputChannel?.appendLine('ChapterWise Codex extension deactivating...');

  // Clear debounce state
  if (expandedUpdateTimeout) {
    clearTimeout(expandedUpdateTimeout);
    expandedUpdateTimeout = null;
  }
  expandedUpdateQueue.clear();

  // Dispose tree views (not in subscriptions)
  try {
    treeView?.dispose();
  } catch (e) {
    console.error('Error disposing tree view:', e);
  }

  // Dispose sub-index views
  for (const view of subIndexViews) {
    try {
      view.dispose();
    } catch (e) {
      console.error('Error disposing sub-index view:', e);
    }
  }
  subIndexViews.length = 0;
  subIndexProviders.length = 0;

  // Dispose managers
  try {
    multiIndexManager?.dispose?.();
  } catch (e) {
    console.error('Error disposing multi-index manager:', e);
  }

  try {
    masterTreeProvider?.dispose?.();
  } catch (e) {
    console.error('Error disposing master tree provider:', e);
  }

  // Dispose writer view and other modules
  writerViewManager?.dispose();
  disposeAutoFixer();
  disposeExplodeCodex();
  disposeImplodeCodex();
  disposeWordCount();
  disposeTagGenerator();
  disposeConvertFormat();
  disposeGitSetup();
  disposeScrivenerImport();

  outputChannel?.appendLine('ChapterWise Codex extension deactivated');
  outputChannel?.dispose();
}
```

**Step 2: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "fix(activation): add comprehensive resource cleanup in deactivate()

- Clear expandedUpdateQueue and expandedUpdateTimeout
- Dispose treeView explicitly
- Dispose all subIndexViews and clear arrays
- Dispose multiIndexManager and masterTreeProvider
- Wrap each disposal in try-catch to prevent cascade failures"
```

---

### Task 2: Add Timeout Protection to State Restoration

**Files:**
- Modify: `src/extension.ts:73-113`

**Step 1: Add timeout helper before restoreLastContext**

Find line 73 (start of restoreLastContext):

```typescript
async function restoreLastContext(context: vscode.ExtensionContext): Promise<void> {
```

Add helper function before it:

```typescript
/**
 * Execute a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function restoreLastContext(context: vscode.ExtensionContext): Promise<void> {
```

**Step 2: Add timeout to command execution**

Find lines 101-108:

```typescript
    // Restore the context by calling the appropriate command
    if (savedContextType === 'folder') {
      outputChannel.appendLine(`[restoreLastContext] Restoring folder context: ${savedContextPath}`);
      await vscode.commands.executeCommand('chapterwiseCodex.setContextFolder', uri);
    } else if (savedContextType === 'file') {
      outputChannel.appendLine(`[restoreLastContext] Restoring file context: ${savedContextPath}`);
      await vscode.commands.executeCommand('chapterwiseCodex.setContextFile', uri);
    }
```

Replace with:

```typescript
    // Restore the context by calling the appropriate command (with 10s timeout)
    const RESTORE_TIMEOUT_MS = 10000;

    if (savedContextType === 'folder') {
      outputChannel.appendLine(`[restoreLastContext] Restoring folder context: ${savedContextPath}`);
      await withTimeout(
        vscode.commands.executeCommand('chapterwiseCodex.setContextFolder', uri),
        RESTORE_TIMEOUT_MS,
        'Timeout restoring folder context'
      );
    } else if (savedContextType === 'file') {
      outputChannel.appendLine(`[restoreLastContext] Restoring file context: ${savedContextPath}`);
      await withTimeout(
        vscode.commands.executeCommand('chapterwiseCodex.setContextFile', uri),
        RESTORE_TIMEOUT_MS,
        'Timeout restoring file context'
      );
    }
```

**Step 3: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "fix(activation): add timeout protection to state restoration

Add 10-second timeout when restoring last context on startup.
Prevents extension from hanging if setContextFolder/setContextFile fails."
```

---

### Task 3: Add Graceful Error Handling for Non-Critical Components

**Files:**
- Modify: `src/extension.ts:159-231`

**Step 1: Wrap non-critical initialization in try-catch**

Find lines 159-182 (multi-index setup):

```typescript
    // Create multi-index manager
    multiIndexManager = new MultiIndexManager(context);

    // Create master index tree provider
    masterTreeProvider = new MasterIndexTreeProvider();
    const masterView = vscode.window.createTreeView('chapterwiseCodexMaster', {
      treeDataProvider: masterTreeProvider,
      showCollapseAll: true
    });
    context.subscriptions.push(masterView);

    // Create sub-index tree providers (8 slots)
    for (let i = 0; i < 8; i++) {
      const provider = new SubIndexTreeProvider(`chapterwiseCodexIndex${i}`);
      subIndexProviders.push(provider);

      const view = vscode.window.createTreeView(`chapterwiseCodexIndex${i}`, {
        treeDataProvider: provider,
        showCollapseAll: true
      });
      subIndexViews.push(view);
      context.subscriptions.push(view);
    }
    outputChannel.appendLine('Multi-index tree views created');
```

Replace with:

```typescript
    // Create multi-index manager (non-critical - continue if fails)
    try {
      multiIndexManager = new MultiIndexManager(context);

      // Create master index tree provider
      masterTreeProvider = new MasterIndexTreeProvider();
      const masterView = vscode.window.createTreeView('chapterwiseCodexMaster', {
        treeDataProvider: masterTreeProvider,
        showCollapseAll: true
      });
      context.subscriptions.push(masterView);

      // Create sub-index tree providers (8 slots)
      for (let i = 0; i < 8; i++) {
        const provider = new SubIndexTreeProvider(`chapterwiseCodexIndex${i}`);
        subIndexProviders.push(provider);

        const view = vscode.window.createTreeView(`chapterwiseCodexIndex${i}`, {
          treeDataProvider: provider,
          showCollapseAll: true
        });
        subIndexViews.push(view);
        context.subscriptions.push(view);
      }
      outputChannel.appendLine('Multi-index tree views created');
    } catch (error) {
      outputChannel.appendLine(`[WARNING] Multi-index initialization failed (non-critical): ${error}`);
      console.warn('Multi-index initialization failed:', error);
    }
```

**Step 2: Wrap search initialization in try-catch**

Find lines 212-230 (search initialization):

```typescript
    // Initialize search status bar
    initializeSearchStatusBar(context);
    outputChannel.appendLine('Search status bar initialized');

    // Initialize search index manager
    searchIndexManager = new SearchIndexManager();

    searchIndexManager.onBuildProgress(progress => {
      updateSearchStatusBar('building', progress);
    });

    searchIndexManager.onIndexReady(index => {
      updateSearchStatusBar('ready');
    });

    context.subscriptions.push({
      dispose: () => searchIndexManager?.dispose()
    });
    outputChannel.appendLine('Search index manager initialized');
```

Replace with:

```typescript
    // Initialize search (non-critical - continue if fails)
    try {
      initializeSearchStatusBar(context);
      outputChannel.appendLine('Search status bar initialized');

      searchIndexManager = new SearchIndexManager();

      searchIndexManager.onBuildProgress(progress => {
        updateSearchStatusBar('building', progress);
      });

      searchIndexManager.onIndexReady(index => {
        updateSearchStatusBar('ready');
      });

      context.subscriptions.push({
        dispose: () => searchIndexManager?.dispose()
      });
      outputChannel.appendLine('Search index manager initialized');
    } catch (error) {
      outputChannel.appendLine(`[WARNING] Search initialization failed (non-critical): ${error}`);
      console.warn('Search initialization failed:', error);
    }
```

**Step 3: Verify syntax**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "fix(activation): graceful error handling for non-critical components

Wrap multi-index and search initialization in try-catch.
Extension continues working even if these features fail to initialize."
```

---

### Task 4: Update META-DEV-PROMPT

**Files:**
- Modify: `/Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md`

**Step 1: Mark Extension Activation as complete**

Find line with Extension Activation and change:

```
| 38 | Extension Activation | ⬜ | 3 | | | Startup, state restoration |
```

To:

```
| 38 | Extension Activation | ✅ | 3 | 2026-02-05 | | Resource cleanup, timeout protection, graceful errors |
```

**Step 2: Add decision log entry**

Add to NOTES & DECISIONS LOG section:

```markdown
### 2026-02-05 - Extension Activation Hardening (#38) [chapterwise-codex]
Decision: Comprehensive resource cleanup and graceful error handling
Changes:
- Resource cleanup: dispose treeView, subIndexViews, multiIndexManager, masterTreeProvider
- Clear global state: expandedUpdateQueue, expandedUpdateTimeout
- Timeout protection: 10-second timeout on state restoration commands
- Graceful degradation: multi-index and search failures don't block extension
- Try-catch wrapping: each disposal wrapped to prevent cascade failures
Deferred (Low priority):
- Event listener disposal tracking
- Individual command registration error handling
```

**Step 3: Commit**

```bash
git add /Users/phong/Projects/chapterwise-app/dev/META-DEV-PROMPT.md
git commit -m "docs: mark Extension Activation as hardened"
```

---

## Verification Checklist

Before marking complete:

- [ ] deactivate() clears expandedUpdateTimeout
- [ ] deactivate() clears expandedUpdateQueue
- [ ] deactivate() disposes treeView
- [ ] deactivate() disposes all subIndexViews
- [ ] deactivate() disposes multiIndexManager
- [ ] withTimeout() helper function added
- [ ] restoreLastContext() uses timeout for commands
- [ ] Multi-index initialization wrapped in try-catch
- [ ] Search initialization wrapped in try-catch
- [ ] Extension compiles without errors
- [ ] META-DEV-PROMPT updated
