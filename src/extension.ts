/**
 * ChapterWise Codex Extension
 * Transform .codex.yaml and .codex.json editing into a Scrivener-like writing experience
 */

import * as vscode from 'vscode';
import { CodexTreeProvider, IndexNodeTreeItem, createCodexTreeView } from './treeProvider';
import { WriterViewManager } from './writerView';
import { initializeValidation } from './validation';
import { CodexDragAndDropController } from './dragDropController';
import { registerScrivenerImport, disposeScrivenerImport } from './scrivenerImport';
import { MultiIndexManager } from './multiIndexManager';
import { SubIndexTreeProvider } from './subIndexTreeProvider';
import { MasterIndexTreeProvider } from './masterIndexTreeProvider';
import { disposeAutoFixer } from './autoFixer';
import { disposeExplodeCodex } from './explodeCodex';
import { disposeImplodeCodex } from './implodeCodex';
import { disposeWordCount } from './wordCount';
import { disposeTagGenerator } from './tagGenerator';
import { disposeConvertFormat } from './convertFormat';
import { disposeGitSetup } from './gitSetup';
import { initState, getDeps, disposeState, updateStatusBar, syncOrderingOnStartup, autoDiscoverIndexFiles, restoreLastContext } from './extensionState';
import { updateNodeExpandedState, disposeTreeState } from './treeStateManager';
import { registerAllCommands } from './commands/register';

// Re-exports for external consumers (treeProvider.ts, indexGenerator.ts)
export { getOutputChannel, getSearchIndexManager, log } from './extensionState';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('ChapterWise Codex');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('ChapterWise Codex extension activating...');

  try {
    // Create tree provider
    const treeProvider = new CodexTreeProvider();
    outputChannel.appendLine('Tree provider created');

    // Initialize drag & drop controller
    const dragController = new CodexDragAndDropController(treeProvider);
    context.subscriptions.push({ dispose: () => dragController.dispose() });
    outputChannel.appendLine('Drag & drop controller created');

    // Initialize tree view
    const { treeView } = createCodexTreeView(context, treeProvider, dragController);
    outputChannel.appendLine('Tree view created with drag & drop support');

    // Phase 5: Register expansion state handlers
    treeView.onDidCollapseElement(async (event) => {
      if (event.element instanceof IndexNodeTreeItem) {
        await updateNodeExpandedState(event.element, false, treeProvider);
      }
    });
    treeView.onDidExpandElement(async (event) => {
      if (event.element instanceof IndexNodeTreeItem) {
        await updateNodeExpandedState(event.element, true, treeProvider);
      }
    });
    outputChannel.appendLine('Tree expansion state handlers registered');

    // Create multi-index manager (non-critical)
    let multiIndexManager: MultiIndexManager | undefined;
    let masterTreeProvider: MasterIndexTreeProvider | undefined;
    const subIndexProviders: SubIndexTreeProvider[] = [];
    const subIndexViews: vscode.TreeView<any>[] = [];

    try {
      multiIndexManager = new MultiIndexManager(context);
      masterTreeProvider = new MasterIndexTreeProvider();
      const masterView = vscode.window.createTreeView('chapterwiseCodexMaster', {
        treeDataProvider: masterTreeProvider,
        showCollapseAll: true,
        canSelectMany: true
      });
      context.subscriptions.push(masterView);

      for (let i = 0; i < 8; i++) {
        const provider = new SubIndexTreeProvider(`chapterwiseCodexIndex${i}`);
        subIndexProviders.push(provider);
        const view = vscode.window.createTreeView(`chapterwiseCodexIndex${i}`, {
          treeDataProvider: provider,
          showCollapseAll: true,
          canSelectMany: true
        });
        subIndexViews.push(view);
        context.subscriptions.push(view);
      }
      outputChannel.appendLine('Multi-index tree views created');
    } catch (error) {
      outputChannel.appendLine(`[WARNING] Multi-index initialization failed (non-critical): ${error}`);
      console.warn('Multi-index initialization failed:', error);
    }

    // Sync ordering on startup (non-blocking)
    syncOrderingOnStartup();

    // Initialize Writer View manager
    const writerViewManager = new WriterViewManager(context);
    writerViewManager.setTreeProvider(treeProvider);
    outputChannel.appendLine('Writer view manager created');

    // Initialize validation system
    initializeValidation(context);
    outputChannel.appendLine('Validation initialized');

    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    statusBarItem.command = 'chapterwiseCodex.openNavigator';
    context.subscriptions.push(statusBarItem);

    // Initialize shared state
    initState(
      treeProvider, treeView, writerViewManager, statusBarItem, outputChannel,
      multiIndexManager, masterTreeProvider, subIndexProviders, subIndexViews
    );

    // Register all commands (including search initialization)
    registerAllCommands(context, getDeps());
    outputChannel.appendLine('Commands registered');

    // Register Scrivener import command
    registerScrivenerImport(context);
    outputChannel.appendLine('Scrivener import command registered');

    // Update status bar based on active editor
    updateStatusBar();
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        updateStatusBar();
      })
    );

    // Auto-discover index files and restore last context
    autoDiscoverIndexFiles();
    restoreLastContext(context);

    console.log('ChapterWise Codex extension activated successfully!');
  } catch (error) {
    console.error('ChapterWise Codex activation failed:', error);
    vscode.window.showErrorMessage(`ChapterWise Codex failed to activate: ${error}`);
  }
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  // Clear tree state debounce timer
  disposeTreeState();

  // Dispose non-subscription resources and clear refs
  disposeState();

  // Dispose module-level resources
  disposeAutoFixer();
  disposeExplodeCodex();
  disposeImplodeCodex();
  disposeWordCount();
  disposeTagGenerator();
  disposeConvertFormat();
  disposeGitSetup();
  disposeScrivenerImport();
}
