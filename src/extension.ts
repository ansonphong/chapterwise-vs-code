/**
 * ChapterWise Codex Extension
 * Transform .codex.yaml and .codex.json editing into a Scrivener-like writing experience
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { CodexTreeProvider, CodexTreeItem, CodexFieldTreeItem, IndexNodeTreeItem, CodexTreeItemType, createCodexTreeView } from './treeProvider';
import { WriterViewManager } from './writerView';
import { initializeValidation } from './validation';
import { isCodexFile, isMarkdownFile, parseMarkdownAsCodex, parseCodex, CodexNode } from './codexModel';
import type { ClipboardManager } from './clipboardManager';
import { runAutoFixer, disposeAutoFixer } from './autoFixer';
import { runExplodeCodex, disposeExplodeCodex } from './explodeCodex';
import { runImplodeCodex, disposeImplodeCodex } from './implodeCodex';
import { runUpdateWordCount, disposeWordCount } from './wordCount';
import { runGenerateTags, disposeTagGenerator } from './tagGenerator';
import { runGenerateIndex, runRegenerateIndex, generateFolderHierarchy, IndexGenerationProgress } from './indexGenerator';
import { runCreateIndexFile } from './indexBoilerplate';
import { runConvertToMarkdown, runConvertToCodex, disposeConvertFormat } from './convertFormat';
import { countFilesInIndex as countIndexFiles } from './indexParser';
import { CodexDragAndDropController } from './dragDropController';
import { initializeGitRepository, ensureGitIgnore, setupGitLFS, disposeGitSetup } from './gitSetup';
import { runGitSetupWizard } from './gitSetup/wizard';
import { registerScrivenerImport, disposeScrivenerImport } from './scrivenerImport';
import { MultiIndexManager } from './multiIndexManager';
import { SubIndexTreeProvider } from './subIndexTreeProvider';
import { MasterIndexTreeProvider } from './masterIndexTreeProvider';
import {
  SearchIndexManager,
  initializeStatusBar as initializeSearchStatusBar,
  updateStatusBar as updateSearchStatusBar,
  openSearchUI,
  SearchResult
} from './search';

/**
 * Notification Helper - Show transient messages that auto-dismiss
 * Use this for success confirmations, context switches, and progress updates
 * @param message - The message to display
 * @param duration - Duration in milliseconds (default: 3000)
 */
function showTransientMessage(message: string, duration: number = 3000): void {
  vscode.window.setStatusBarMessage(message, duration);
}

/**
 * Validate UUID v4 format
 * Used for security validation of node IDs before processing
 */
function isValidUuid(uuidStr: string): boolean {
  if (!uuidStr || typeof uuidStr !== 'string') {
    return false;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(uuidStr);
}

/**
 * Validate index file JSON structure
 * Returns true if the structure is valid for tree operations
 */
function isValidIndexStructure(data: unknown): data is { children: unknown[] } {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.children);
}

let treeProvider: CodexTreeProvider;
let treeView: vscode.TreeView<CodexTreeItemType>;
let writerViewManager: WriterViewManager;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

// Multi-index support
let multiIndexManager: MultiIndexManager | undefined;
let masterTreeProvider: MasterIndexTreeProvider | undefined;
const subIndexProviders: SubIndexTreeProvider[] = [];
const subIndexViews: vscode.TreeView<CodexTreeItemType>[] = [];

// Search index manager
let searchIndexManager: SearchIndexManager | null = null;

// ============================================================================
// Shared Helpers (used by command handlers across all stages)
// ============================================================================

/** Get the first workspace folder's root path. */
function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Resolve an IndexNodeTreeItem to its backing document + CodexNode. */
async function resolveIndexNodeForEdit(treeItem: IndexNodeTreeItem, wsRoot: string): Promise<{ doc: vscode.TextDocument; node: any } | null> {
  const nodeKind = (treeItem.indexNode as any)._node_kind;
  if (nodeKind === 'file') {
    const computedPath = treeItem.indexNode._computed_path;
    if (!computedPath) return null;
    const fullPath = path.join(wsRoot, computedPath);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
    const { parseCodex } = await import('./codexModel');
    const codexDoc = parseCodex(doc.getText());
    if (!codexDoc || !codexDoc.rootNode) return null;
    return { doc, node: codexDoc.rootNode };
  }
  const parentFile = (treeItem.indexNode as any)._parent_file;
  if (!parentFile) {
    if (treeItem.resourceUri) {
      const doc = await vscode.workspace.openTextDocument(treeItem.resourceUri);
      const { parseCodex } = await import('./codexModel');
      const codexDoc = parseCodex(doc.getText());
      if (!codexDoc) return null;
      const node = codexDoc.allNodes.find((n: any) => n.id === treeItem.indexNode.id);
      return node ? { doc, node } : null;
    }
    return null;
  }
  const fullPath = path.join(wsRoot, parentFile);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
  const { parseCodex } = await import('./codexModel');
  const codexDoc = parseCodex(doc.getText());
  if (!codexDoc) return null;
  const node = codexDoc.allNodes.find((n: any) => n.id === treeItem.indexNode.id);
  return node ? { doc, node } : null;
}

/**
 * Reload the tree index from disk. Safe for null contextFolder.
 * WARNING (Fact #48): This only READS existing .index.codex.json cache.
 * If files were mutated on disk, call regenerateAndReload() instead.
 */
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

/**
 * Regenerate .index.codex.json cache from disk, THEN reload tree + stacked views.
 * Use after operations that mutate files on disk (create/delete/move/rename/duplicate).
 * Fact #52: Uses cascadeRegenerateIndexes() for per-folder + top-level indexes.
 */
async function regenerateAndReload(wsRoot: string): Promise<void> {
  const contextFolder = treeProvider.getContextFolder();
  const folderToRegenerate = contextFolder || '.';

  // Step 1: Regenerate per-folder + top-level indexes
  const { cascadeRegenerateIndexes } = await import('./indexGenerator');
  await cascadeRegenerateIndexes(wsRoot, folderToRegenerate);

  // Step 2: Reload Navigator tree from regenerated cache
  await reloadTreeIndex();

  // Step 3: Refresh stacked views (Master + Index0-7) if in stacked mode
  if (multiIndexManager && masterTreeProvider) {
    await multiIndexManager.discoverIndexes(wsRoot);
    masterTreeProvider.setManager(multiIndexManager, wsRoot);
    const subIndexes = multiIndexManager.getSubIndexes();
    subIndexes.forEach((index: any, i: number) => {
      if (i < subIndexProviders.length) {
        subIndexProviders[i].setIndex(index);
      }
    });
    for (let i = subIndexes.length; i < subIndexProviders.length; i++) {
      subIndexProviders[i].setIndex(null);
    }
  }
}

/**
 * Get the output channel for logging
 */
export function getOutputChannel(): vscode.OutputChannel | undefined {
  return outputChannel;
}

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

/**
 * Restore the last saved Codex context on startup
 */
async function restoreLastContext(context: vscode.ExtensionContext): Promise<void> {
  const RESTORE_TIMEOUT_MS = 10000; // 10 second timeout

  try {
    const savedContextPath = context.workspaceState.get<string>('chapterwiseCodex.lastContextPath');
    const savedContextType = context.workspaceState.get<string>('chapterwiseCodex.lastContextType');

    if (!savedContextPath || !savedContextType) {
      return; // No saved context
    }

    outputChannel.appendLine(`[restoreLastContext] Attempting to restore context: ${savedContextPath}`);

    // Verify the path still exists
    if (!fs.existsSync(savedContextPath)) {
      outputChannel.appendLine(`[restoreLastContext] Saved context path no longer exists: ${savedContextPath}`);
      // Clear the invalid context
      await context.workspaceState.update('chapterwiseCodex.lastContextPath', undefined);
      await context.workspaceState.update('chapterwiseCodex.lastContextType', undefined);
      return;
    }

    // Verify it's in a workspace
    const uri = vscode.Uri.file(savedContextPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      outputChannel.appendLine(`[restoreLastContext] Saved context is not in a workspace`);
      return;
    }

    // Restore the context by calling the appropriate command (with timeout)
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
  } catch (error) {
    outputChannel.appendLine(`[restoreLastContext] Error restoring context: ${error}`);
    // Silently fail - don't break the extension
  }
}

// Phase 5: Tree State Management - Debounce state for expansion updates
const expandedUpdateQueue = new Map<string, { indexPath: string; nodeId: string; expanded: boolean }>();
let expandedUpdateTimeout: NodeJS.Timeout | null = null;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  // Create output channel for logs
  outputChannel = vscode.window.createOutputChannel('ChapterWise Codex');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('ChapterWise Codex extension activating...');

  try {
    // Create tree provider first
    const { CodexTreeProvider } = require('./treeProvider');
    const tp = new CodexTreeProvider();
    treeProvider = tp;
    outputChannel.appendLine('Tree provider created');

    // Initialize drag & drop controller (needs tree provider)
    const dragController = new CodexDragAndDropController(treeProvider);
    context.subscriptions.push({ dispose: () => dragController.dispose() });
    outputChannel.appendLine('Drag & drop controller created');

    // Initialize tree view with both tree provider and drag controller
    const { treeView: tv } = createCodexTreeView(context, treeProvider, dragController);
    treeView = tv;
    outputChannel.appendLine('Tree view created with drag & drop support');

    // Phase 5: Register expansion state handlers
    treeView.onDidCollapseElement(async (event) => {
      if (event.element instanceof IndexNodeTreeItem) {
        await updateNodeExpandedState(event.element, false);
      }
    });

    treeView.onDidExpandElement(async (event) => {
      if (event.element instanceof IndexNodeTreeItem) {
        await updateNodeExpandedState(event.element, true);
      }
    });
    outputChannel.appendLine('Tree expansion state handlers registered');

    // Create multi-index manager (non-critical - continue if fails)
    try {
      multiIndexManager = new MultiIndexManager(context);

      // Create master index tree provider
      masterTreeProvider = new MasterIndexTreeProvider();
      const masterView = vscode.window.createTreeView('chapterwiseCodexMaster', {
        treeDataProvider: masterTreeProvider,
        showCollapseAll: true,
        canSelectMany: true
      });
      context.subscriptions.push(masterView);

      // Create sub-index tree providers (8 slots)
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

    // Sync ordering index on startup (non-blocking)
    const wsRootForSync = getWorkspaceRoot();
    if (wsRootForSync) {
      void (async () => {
        try {
          const { getOrderingManager } = await import('./orderingManager');
          const om = getOrderingManager(wsRootForSync);
          await om.syncWithFilesystem();
        } catch (e) {
          console.error('[ChapterWise Codex] Failed to sync ordering index:', e);
        }
      })();
    }

    // Initialize Writer View manager
    writerViewManager = new WriterViewManager(context);
    outputChannel.appendLine('Writer view manager created');

    // Set tree provider reference for author lookup
    writerViewManager.setTreeProvider(treeProvider);
    outputChannel.appendLine('Writer view manager linked to tree provider');

    // Initialize validation system
    initializeValidation(context);
    outputChannel.appendLine('Validation initialized');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    statusBarItem.command = 'chapterwiseCodex.openNavigator';
    context.subscriptions.push(statusBarItem);

    // Register commands
    registerCommands(context);
    outputChannel.appendLine('Commands registered');

    // Register Scrivener import command
    registerScrivenerImport(context);
    outputChannel.appendLine('Scrivener import command registered');

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

    // Search command
    context.subscriptions.push(
      vscode.commands.registerCommand('chapterwiseCodex.search', async () => {
        if (!searchIndexManager) {
          vscode.window.showErrorMessage('Search not initialized');
          return;
        }

        const index = searchIndexManager.getIndex();
        if (!index) {
          vscode.window.showWarningMessage(
            'Search index not ready. Set a context folder first.'
          );
          return;
        }

        const workspaceRoot = treeProvider?.getWorkspaceRoot();

        await openSearchUI(index, async (result: SearchResult) => {
          try {
            const isStructural = ['folder', 'book', 'index'].includes(result.type.toLowerCase());

            if (isStructural) {
              // Reveal structural nodes in tree view
              await vscode.commands.executeCommand(
                'chapterwiseCodex.navigateToNode',
                result.id
              );
            } else if (workspaceRoot) {
              // Open content in Writer View
              const fullPath = path.join(workspaceRoot, result.path);
              const uri = vscode.Uri.file(fullPath);

              // Parse the file to get a proper CodexTreeItem
              try {
                const fileContent = await vscode.workspace.fs.readFile(uri);
                const content = Buffer.from(fileContent).toString('utf-8');
                const codexDoc = isCodexFile(fullPath)
                  ? parseCodex(content)
                  : parseMarkdownAsCodex(content, fullPath);

                if (codexDoc && codexDoc.rootNode) {
                  // Find the target node by ID
                  const targetNode = result.id
                    ? codexDoc.allNodes.find(n => n.id === result.id) || codexDoc.rootNode
                    : codexDoc.rootNode;

                  const hasChildren = targetNode.children && targetNode.children.length > 0;
                  const tempTreeItem = new CodexTreeItem(
                    targetNode,
                    uri,
                    hasChildren || false,
                    false,
                    true
                  );

                  await writerViewManager.openWriterView(tempTreeItem);
                }
              } catch (parseError) {
                // Fallback: just open the file
                await vscode.window.showTextDocument(uri);
              }
            }
          } catch (navError) {
            outputChannel.appendLine(`[Search] Navigation error: ${navError}`);
            vscode.window.showErrorMessage(`Failed to open: ${result.name}`);
          }
        });
      })
    );
    outputChannel.appendLine('Search command registered');

    // Rebuild search index command
    context.subscriptions.push(
      vscode.commands.registerCommand('chapterwiseCodex.rebuildSearchIndex', async () => {
        if (!searchIndexManager) return;

        try {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Rebuilding search index...',
            cancellable: false
          }, async () => {
            await searchIndexManager!.forceRebuild();
          });

          vscode.window.showInformationMessage('Search index rebuilt.');
        } catch (error) {
          outputChannel.appendLine(`[Search] Rebuild failed: ${error}`);
          vscode.window.showErrorMessage('Failed to rebuild search index.');
        }
      })
    );
    outputChannel.appendLine('Rebuild search index command registered');

    // Update status bar based on active editor
    updateStatusBar();
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        updateStatusBar();
        // Don't auto-switch context - user must explicitly set context
      })
    );

    // Don't auto-set context on activation - user must explicitly choose context

    // Auto-discover index.codex.yaml in top-level folders
    autoDiscoverIndexFiles();

    // Restore last context if it was saved
    restoreLastContext(context);

    console.log('ChapterWise Codex extension activated successfully!');
  } catch (error) {
    console.error('ChapterWise Codex activation failed:', error);
    vscode.window.showErrorMessage(`ChapterWise Codex failed to activate: ${error}`);
  }
}

/**
 * Auto-discover index.codex.yaml files in top-level folders
 * This checks the top-level directories for index files and auto-loads them
 */
async function autoDiscoverIndexFiles(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  try {
    // Scan top-level directories only
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });

    for (const entry of entries) {
      // Security: Skip symlinks to prevent scanning outside workspace
      if (entry.isSymbolicLink()) {
        console.log(`[ChapterWise Codex] Skipping symlink during discovery: ${entry.name}`);
        continue;
      }

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const folderPath = path.join(workspaceRoot, entry.name);
        const indexPath = path.join(folderPath, 'index.codex.yaml');

        // Check for index.codex.yaml (without dot prefix)
        if (fs.existsSync(indexPath)) {
          console.log(`[ChapterWise Codex] Found index at top level: ${entry.name}/index.codex.yaml`);
          // Just log it for now - user can manually set context
          // Could optionally auto-load the first one found
        }
      }
    }

    // Also check for workspace root index
    const rootIndexPath = path.join(workspaceRoot, '.index.codex.json');
    if (fs.existsSync(rootIndexPath)) {
      console.log(`[ChapterWise Codex] Found workspace root index: .index.codex.json`);
      // This will be loaded automatically by INDEX mode
    }
  } catch (error) {
    console.error('[ChapterWise Codex] Error during auto-discovery:', error);
  }
}

/**
 * Register all commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Open Navigator command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.openNavigator', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isCodexFile(editor.document.fileName)) {
        treeProvider.setActiveDocument(editor.document);
        vscode.commands.executeCommand('chapterwiseCodexNavigator.focus');
      } else {
        vscode.window.showInformationMessage(
          'Open a .codex.yaml or .codex.json file to use the Codex Navigator'
        );
      }
    })
  );

  // Refresh tree command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.refresh', () => {
      // Just refresh the tree, don't change context
      treeProvider.refresh();
    })
  );

  // Filter by type command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.filterByType', async () => {
      const types = treeProvider.getTypes();

      if (types.length === 0) {
        vscode.window.showInformationMessage('No node types found in the current document');
        return;
      }

      const currentFilter = treeProvider.getFilter();
      const items = [
        {
          label: '$(list-flat) Show All',
          description: currentFilter === null ? '(current)' : '',
          value: null as string | null,
        },
        ...types.map((type) => ({
          label: `$(symbol-misc) ${type}`,
          description: currentFilter === type ? '(current)' : '',
          value: type,
        })),
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Filter nodes by type',
        title: 'Codex Node Filter',
      });

      if (selected !== undefined) {
        treeProvider.setFilter(selected.value);

        if (selected.value) {
          vscode.window.setStatusBarMessage(`Filtering: ${selected.value}`, 2000);
        } else {
          vscode.window.setStatusBarMessage('Showing all nodes', 2000);
        }
      }
    })
  );

  // Open Writer View command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.openWriterView',
      async (treeItem?: CodexTreeItem) => {
        if (treeItem) {
          await writerViewManager.openWriterView(treeItem);
        } else {
          vscode.window.showInformationMessage(
            'Select a node in the Codex Navigator to open Writer View'
          );
        }
      }
    )
  );

  // Go to YAML command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.goToYaml',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem | CodexFieldTreeItem) => {
        if (!treeItem) return;

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
          if (!resolved) return;
          const ed = await vscode.window.showTextDocument(resolved.doc);
          if (resolved.node.lineNumber) {
            const pos = new vscode.Position(resolved.node.lineNumber - 1, 0);
            ed.selection = new vscode.Selection(pos, pos);
            ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
          return;
        }

        if (treeItem instanceof CodexFieldTreeItem) {
          const document = treeProvider.getActiveTextDocument();
          if (document) {
            await vscode.window.showTextDocument(document);
          }
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) return;

        const lineNumber = (treeItem as CodexTreeItem).codexNode.lineNumber;
        if (lineNumber !== undefined) {
          const editor = await vscode.window.showTextDocument(document);
          const position = new vscode.Position(lineNumber - 1, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );
        } else {
          await vscode.window.showTextDocument(document);
        }
      }
    )
  );

  // Copy ID command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.copyId',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showInformationMessage('No ID to copy');
          return;
        }

        if (treeItem instanceof IndexNodeTreeItem) {
          await vscode.env.clipboard.writeText(treeItem.indexNode.id);
          vscode.window.setStatusBarMessage(`Copied ID: ${treeItem.indexNode.id}`, 3000);
          return;
        }

        if (!(treeItem as CodexTreeItem).codexNode?.id) {
          vscode.window.showInformationMessage('No ID to copy');
          return;
        }

        await vscode.env.clipboard.writeText((treeItem as CodexTreeItem).codexNode.id);
        vscode.window.setStatusBarMessage(
          `Copied: ${(treeItem as CodexTreeItem).codexNode.id}`,
          2000
        );
      }
    )
  );

  // Toggle field display command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.toggleFields', async () => {
      await treeProvider.toggleShowFields();
      const showFields = treeProvider.getShowFields();
      vscode.window.setStatusBarMessage(
        showFields ? '$(list-tree) Fields shown in tree' : '$(list-flat) Fields hidden in tree',
        2000
      );
    })
  );

  // Open Writer View for a specific field
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.openWriterViewForField',
      async (fieldItem?: CodexFieldTreeItem) => {
        if (!fieldItem) {
          return;
        }

        // Determine which field to open
        let targetField: string;
        if (fieldItem.fieldType === 'attributes') {
          targetField = '__attributes__';
        } else if (fieldItem.fieldType === 'content') {
          targetField = '__content__';
        } else {
          // Extract field name (remove any count suffix like "body" from "body (123 words)")
          targetField = fieldItem.fieldName.split(' ')[0].toLowerCase();
        }

        await writerViewManager.openWriterViewForField(fieldItem.parentNode, fieldItem.documentUri, targetField);
      }
    )
  );

  // Auto-Fix command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.autoFix', async () => {
      await runAutoFixer(false);
      // Refresh the tree after fixing
      treeProvider.refresh();
    })
  );

  // Auto-Fix with ID regeneration command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.autoFixRegenIds', async () => {
      await runAutoFixer(true);
      // Refresh the tree after fixing
      treeProvider.refresh();
    })
  );

  // Explode Codex command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.explodeCodex', async () => {
      await runExplodeCodex();
      // Refresh the tree after exploding
      treeProvider.refresh();
    })
  );

  // Implode Codex command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.implodeCodex', async () => {
      await runImplodeCodex();
      // Refresh the tree after imploding
      treeProvider.refresh();
    })
  );

  // Update Word Count command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.updateWordCount', async () => {
      await runUpdateWordCount();
      // Refresh the tree after updating word counts
      treeProvider.refresh();
    })
  );

  // Generate Tags command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.generateTags', async () => {
      await runGenerateTags();
      // Refresh the tree after generating tags
      treeProvider.refresh();
    })
  );

  // Generate Index command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.generateIndex', async () => {
      await runGenerateIndex();
    })
  );

  // Regenerate Index command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.regenerateIndex', async () => {
      await runRegenerateIndex();
    })
  );

  // Create Index File command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.createIndexFile', async () => {
      await runCreateIndexFile();
    })
  );

  // Open Index File command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.openIndexFile',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          return;
        }

        const filePath = treeItem.getFilePath();

        // Check if file exists
        try {
          const uri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);

          // Don't change context - let user keep their current context
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to open file: ${path.basename(filePath)}`
          );
          console.error('Failed to open index file:', error);
        }
      }
    )
  );

  // Open Index File in Writer View command (for .md Codex Lite files)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.openIndexFileInWriterView',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          outputChannel.appendLine('openIndexFileInWriterView: No treeItem provided');
          return;
        }

        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine(`openIndexFileInWriterView called for: ${treeItem.indexNode.name}`);
        outputChannel.appendLine(`Call stack: ${new Error().stack}`);
        outputChannel.appendLine(`TreeItem workspaceRoot: ${treeItem.workspaceRoot}`);
        outputChannel.appendLine(`TreeItem _computed_path: ${treeItem.indexNode._computed_path}`);
        outputChannel.appendLine(`TreeItem _filename: ${treeItem.indexNode._filename}`);

        const filePath = treeItem.getFilePath();
        outputChannel.appendLine(`File path: ${filePath}`);

        try {
          // Check if file exists first
          if (!fs.existsSync(filePath)) {
            const errorMsg = `File not found: ${filePath}`;
            outputChannel.appendLine(`ERROR: ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
            return;
          }

          outputChannel.appendLine(`File exists, reading file...`);
          // Read file directly - DON'T open in VS Code text editor
          // We only want to open it in the writer view
          const uri = vscode.Uri.file(filePath);
          const text = fs.readFileSync(filePath, 'utf-8');
          outputChannel.appendLine(`File read successfully, length: ${text.length}`);

          // Determine file type and parse accordingly
          const fileName = path.basename(filePath);
          const isMarkdown = fileName.endsWith('.md');
          const isCodexYaml = fileName.endsWith('.codex.yaml');

          let codexDoc;
          if (isMarkdown) {
            outputChannel.appendLine(`Parsing as Codex Lite (markdown), text length: ${text.length}`);
            codexDoc = parseMarkdownAsCodex(text, filePath);
          } else if (isCodexYaml) {
            outputChannel.appendLine(`Parsing as Codex YAML, text length: ${text.length}`);
            codexDoc = parseCodex(text);
          } else {
            outputChannel.appendLine(`ERROR: Unsupported file type: ${fileName}`);
            vscode.window.showErrorMessage(`Unsupported file type: ${fileName}`);
            return;
          }

          if (!codexDoc || !codexDoc.rootNode) {
            outputChannel.appendLine(`Failed to parse as Codex, falling back to text editor`);
            // Fallback to regular text editor if parsing fails
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            // Don't change context - user must explicitly set it
            return;
          }

          outputChannel.appendLine(`Parsed successfully, root node:`);
          outputChannel.appendLine(`  name: ${codexDoc.rootNode.name}`);
          outputChannel.appendLine(`  type: ${codexDoc.rootNode.type}`);
          outputChannel.appendLine(`  proseField: ${codexDoc.rootNode.proseField}`);
          outputChannel.appendLine(`  proseValue length: ${codexDoc.rootNode.proseValue?.length || 0}`);
          outputChannel.appendLine(`  proseValue preview: ${codexDoc.rootNode.proseValue?.substring(0, 100) || 'EMPTY'}`);
          outputChannel.appendLine(`  availableFields: ${codexDoc.rootNode.availableFields.join(', ')}`);

          // Create a temporary CodexTreeItem for the root node
          const hasChildren = codexDoc.rootNode.children && codexDoc.rootNode.children.length > 0;
          const tempTreeItem = new CodexTreeItem(
            codexDoc.rootNode,
            uri,
            hasChildren, // .codex.yaml files can have children, .md files typically don't
            false, // Don't expand
            true   // Show fields (body, etc.)
          );

          outputChannel.appendLine(`Created temp tree item, opening writer view...`);

          // Open in writer view
          await writerViewManager.openWriterView(tempTreeItem);

          outputChannel.appendLine(`Writer view opened successfully`);

          // Don't change context - let user keep their current index context
        } catch (error) {
          const errorMsg = `Failed to open file in Codex Editor: ${path.basename(filePath)}`;
          outputChannel.appendLine(`ERROR: ${errorMsg}`);
          outputChannel.appendLine(`Error details: ${error}`);
          outputChannel.appendLine(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
          vscode.window.showErrorMessage(errorMsg);
        }
      }
    )
  );

  // Phase 3: Navigate to Node command (opens Writer View)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.navigateToEntity',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No node selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const entityId = node.id;

        if (!parentFile || !entityId) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or node ID');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        // Resolve file path
        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        // Parse file to create CodexNode
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const codexDoc = parseCodex(fileContent);

        if (!codexDoc || !codexDoc.rootNode) {
          vscode.window.showErrorMessage('Failed to parse codex file');
          return;
        }

        // Find the node in the parsed document
        const entityNode = findNodeById(codexDoc.rootNode, entityId);

        if (!entityNode) {
          vscode.window.showErrorMessage(`Node ${entityId} not found in file`);
          return;
        }

        // Determine initial field based on node structure
        let initialField = '__overview__';  // default to overview

        // Count available fields
        const hasSummary = entityNode.availableFields.includes('summary');
        const hasBody = entityNode.availableFields.includes('body');
        const hasChildren = entityNode.children && entityNode.children.length > 0;
        const hasContentSections = entityNode.contentSections && entityNode.contentSections.length > 0;
        const hasAttributes = entityNode.attributes && entityNode.attributes.length > 0;

        // Count total fields
        const fieldCount = [hasSummary, hasBody, hasContentSections, hasAttributes, hasChildren].filter(Boolean).length;

        // Only show single field if there's literally just one field
        if (fieldCount === 1) {
          if (hasSummary) initialField = 'summary';
          else if (hasBody) initialField = 'body';
          // Otherwise stay in overview mode for single structured field
        }

        // Create document URI
        const documentUri = vscode.Uri.file(filePath);

        // Open Writer View with determined field
        await writerViewManager.openWriterViewForField(entityNode, documentUri, initialField);
      }
    )
  );

  // Phase 3: Navigate to Field command (opens Writer View)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.navigateToField',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No field selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const parentEntity = node._parent_entity;
        const fieldName = node._field_name;

        if (!parentFile || !fieldName) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or field name');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        // Resolve file path
        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        // Parse file to create CodexNode
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const codexDoc = parseCodex(fileContent);

        if (!codexDoc || !codexDoc.rootNode) {
          vscode.window.showErrorMessage('Failed to parse codex file');
          return;
        }

        // Find the parent node if specified
        let targetNode: CodexNode | null = null;

        if (parentEntity) {
          // Use allNodes for more reliable lookup (handles deeply nested nodes)
          targetNode = codexDoc.allNodes.find(n => n.id === parentEntity) || null;
          if (!targetNode) {
            // Fallback: try recursive search
            targetNode = findNodeById(codexDoc.rootNode, parentEntity);
          }
          if (!targetNode) {
            outputChannel.appendLine(`[navigateToField] Node ${parentEntity} not found. Available IDs: ${codexDoc.allNodes.map(n => n.id).join(', ')}`);
            vscode.window.showErrorMessage(`Parent node ${parentEntity} not found in file`);
            return;
          }
        } else {
          // If no parent node, use root node
          targetNode = codexDoc.rootNode;
        }

        // Create document URI
        const documentUri = vscode.Uri.file(filePath);

        // Map field names to Writer View's special field identifiers
        let writerViewFieldName = fieldName;
        if (fieldName === 'attributes') {
          writerViewFieldName = '__attributes__';
        } else if (fieldName === 'content') {
          writerViewFieldName = '__content__';
        } else if (fieldName === 'images') {
          writerViewFieldName = '__images__';
        }

        // Open Writer View with specific field selected
        await writerViewManager.openWriterViewForField(targetNode, documentUri, writerViewFieldName);
      }
    )
  );

  // Phase 3: Navigate to Node command (opens Writer View for nested nodes)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.navigateToNode',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem || !treeItem.indexNode) {
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;

        if (!parentFile) {
          vscode.window.showWarningMessage('Cannot navigate: No parent file found');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showWarningMessage('Cannot navigate: No workspace root');
          return;
        }

        const fullPath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(fullPath)) {
          vscode.window.showWarningMessage(`File not found: ${parentFile}`);
          return;
        }

        // Open the file and parse it
        const uri = vscode.Uri.file(fullPath);
        const fileContent = fs.readFileSync(fullPath, 'utf-8');

        // Parse based on file type
        const codexDoc = isMarkdownFile(fullPath)
          ? parseMarkdownAsCodex(fileContent, fullPath)
          : parseCodex(fileContent);

        if (!codexDoc || !codexDoc.rootNode) {
          // Fallback to text editor
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
          return;
        }

        // Find the target node by ID using allNodes for reliable lookup
        const targetNodeId = node.id;
        let targetNode: CodexNode | null = null;

        if (targetNodeId) {
          targetNode = codexDoc.allNodes.find(n => n.id === targetNodeId) || null;
          if (!targetNode) {
            // Fallback: try recursive search
            targetNode = findNodeById(codexDoc.rootNode, targetNodeId);
          }
        }

        if (targetNode) {
          // Open Writer View focused on this node
          await writerViewManager.openWriterViewForField(targetNode, uri, '__overview__');
        } else {
          outputChannel.appendLine(`[navigateToNode] Node ${targetNodeId} not found. Available IDs: ${codexDoc.allNodes.map(n => n.id).join(', ')}`);
          // Fallback: open file in Writer View at root
          const hasChildren = codexDoc.rootNode.children && codexDoc.rootNode.children.length > 0;
          const tempTreeItem = new CodexTreeItem(
            codexDoc.rootNode,
            uri,
            hasChildren,
            false,
            true
          );
          await writerViewManager.openWriterView(tempTreeItem);
        }
      }
    )
  );

  // Navigate to Node in Code View (alternative to Writer View)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.navigateToEntityInCodeView',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No node selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const entityId = node.id;

        if (!parentFile || !entityId) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or node ID');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        // Resolve file path
        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        // Open file in text editor
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);

        // Find node in file by ID
        const text = doc.getText();
        const lines = text.split('\n');
        let entityLineStart = -1;

        // Helper function to escape special regex characters
        const escapeRegExp = (str: string): string => {
          return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        // Try multiple patterns to find the node ID
        const idPatterns = [
          new RegExp(`^\\s*id:\\s*${escapeRegExp(entityId)}\\s*$`, 'i'),           // YAML: id: value
          new RegExp(`^\\s*id:\\s*["']${escapeRegExp(entityId)}["']\\s*$`, 'i'),  // YAML: id: "value" or id: 'value'
          new RegExp(`^\\s*["']id["']:\\s*["']${escapeRegExp(entityId)}["']`, 'i'), // JSON: "id": "value"
        ];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (idPatterns.some(pattern => pattern.test(line))) {
            entityLineStart = i;
            break;
          }
        }

        if (entityLineStart >= 0) {
          // Scroll to node
          const position = new vscode.Position(entityLineStart, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );
        } else {
          vscode.window.showWarningMessage(`Node ${entityId} not found in file`);
        }
      }
    )
  );

  // Backward-compat alias for renamed command (can remove in next major version)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.navigateToNodeInCodeView',
      (...args: any[]) => vscode.commands.executeCommand('chapterwiseCodex.navigateToEntityInCodeView', ...args)
    )
  );

  // Navigate to Field in Code View (alternative to Writer View)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.navigateToFieldInCodeView',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showErrorMessage('No field selected');
          return;
        }

        const node = treeItem.indexNode as any;
        const parentFile = node._parent_file;
        const parentEntity = node._parent_entity;
        const fieldName = node._field_name;

        if (!parentFile || !fieldName) {
          vscode.window.showErrorMessage('Cannot navigate: missing file or field name');
          return;
        }

        const workspaceRoot = treeProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace root found');
          return;
        }

        // Resolve file path
        const filePath = path.join(workspaceRoot, parentFile);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`File not found: ${parentFile}`);
          return;
        }

        // Open file in text editor
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);

        // Find node first (if specified), then field within it
        const text = doc.getText();
        const lines = text.split('\n');
        let fieldLineStart = -1;
        let entityLineStart = -1;

        // Helper function to escape special regex characters
        const escapeRegExp = (str: string): string => {
          return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        // If parent node specified, find it first
        if (parentEntity) {
          const idPatterns = [
            new RegExp(`^\\s*id:\\s*${escapeRegExp(parentEntity)}\\s*$`, 'i'),
            new RegExp(`^\\s*id:\\s*["']${escapeRegExp(parentEntity)}["']\\s*$`, 'i'),
            new RegExp(`^\\s*["']id["']:\\s*["']${escapeRegExp(parentEntity)}["']`, 'i'),
          ];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (idPatterns.some(pattern => pattern.test(line))) {
              entityLineStart = i;
              break;
            }
          }
        }

        // Find field within node or file
        const fieldPatterns = [
          new RegExp(`^\\s*${escapeRegExp(fieldName)}:\\s*`, 'i'),           // YAML: field:
          new RegExp(`^\\s*["']${escapeRegExp(fieldName)}["']:\\s*`, 'i'),  // JSON: "field":
        ];

        const searchStart = entityLineStart >= 0 ? entityLineStart : 0;
        for (let i = searchStart; i < lines.length; i++) {
          const line = lines[i];
          if (fieldPatterns.some(pattern => pattern.test(line))) {
            fieldLineStart = i;
            break;
          }
        }

        if (fieldLineStart >= 0) {
          // Scroll to field
          const position = new vscode.Position(fieldLineStart, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );
        } else {
          vscode.window.showWarningMessage(`Field ${fieldName} not found in file`);
        }
      }
    )
  );

  // Phase 3: Show Error command (for missing/error nodes)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.showError',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          return;
        }

        const node = treeItem.indexNode as any;
        const nodeKind = node._node_kind;

        if (nodeKind === 'error') {
          const errorMsg = node._error_message || 'Unknown error';
          const originalInclude = node._original_include;
          vscode.window.showErrorMessage(
            `Error: ${errorMsg}${originalInclude ? `\nInclude: ${originalInclude}` : ''}`,
            'OK'
          );
        } else if (nodeKind === 'missing') {
          const originalInclude = node._original_include || node._computed_path;
          vscode.window.showWarningMessage(
            `Missing File: ${originalInclude}\n\nThe included file could not be found.`,
            'OK'
          );
        }
      }
    )
  );

  // Convert to Markdown command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.convertToMarkdown', async () => {
      await runConvertToMarkdown();
    })
  );

  // Convert Markdown to Codex command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.convertToCodex', async () => {
      await runConvertToCodex();
    })
  );

  // === GIT SETUP COMMANDS ===

  // Git Setup Wizard command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.git.setupWizard', async () => {
      await runGitSetupWizard();
    })
  );

  // Initialize Git Repository command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.git.initRepository', async () => {
      await initializeGitRepository();
    })
  );

  // Ensure Git Ignore command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.git.ensureGitIgnore', async () => {
      await ensureGitIgnore();
    })
  );

  // Setup Git LFS command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.git.setupLFS', async () => {
      await setupGitLFS();
    })
  );

  // === NEW NAVIGATOR COMMANDS ===

  // Add child node command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.addChildNode',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showInformationMessage('Select a node to add a child to');
          return;
        }

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;
          if (nodeKind === 'folder') {
            vscode.window.showInformationMessage('Use "Add File" for folders');
            return;
          }
          const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
          if (!resolved) return;
          const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
          if (!name) return;
          const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: 'scene' });
          if (!type) return;
          const { getStructureEditor } = await import('./structureEditor');
          const { getSettingsManager } = await import('./settingsManager');
          const editor = getStructureEditor();
          const settings = await getSettingsManager().getSettings(resolved.doc.uri);
          await editor.addNodeInDocument(resolved.doc, resolved.node, 'child', { name, type, proseField: 'body', proseValue: '' }, settings);
          await reloadTreeIndex();
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) {
          vscode.window.showErrorMessage('No active document');
          return;
        }

        // Import modules
        const { getStructureEditor } = await import('./structureEditor');
        const { getSettingsManager } = await import('./settingsManager');
        const { getFileOrganizer } = await import('./fileOrganizer');

        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);

        // Prompt for node data
        const name = await vscode.window.showInputBox({
          prompt: 'Enter node name',
          placeHolder: 'e.g., Scene 1, Chapter 2'
        });

        if (!name) return;

        const type = await vscode.window.showInputBox({
          prompt: 'Enter node type',
          placeHolder: 'e.g., scene, chapter, character'
        });

        if (!type) return;

        // Ask for mode if configured
        let mode = settings.defaultChildMode;
        if (mode === 'ask') {
          const choice = await vscode.window.showQuickPick(
            [
              { label: 'Inline', value: 'inline' as const },
              { label: 'Separate File', value: 'separate-file' as const }
            ],
            { placeHolder: 'How should the child be created?' }
          );
          mode = choice?.value || 'inline';
        }

        if (mode === 'separate-file') {
          // Create as separate file in INDEX mode
          const organizer = getFileOrganizer();
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
          if (!workspaceFolder) return;

          // Determine parent path from tree item
          // For now, create in workspace root
          const result = await organizer.createNodeFile(
            workspaceFolder.uri.fsPath,
            '', // parent path
            { name, type, proseField: 'body', proseValue: '' },
            settings
          );

          if (result.success && result.fileUri) {
            // Regenerate index
            const { generateIndex } = await import('./indexGenerator');
            await generateIndex({ workspaceRoot: workspaceFolder.uri.fsPath });

            // Open new file
            await vscode.window.showTextDocument(result.fileUri);

            // Refresh tree
            treeProvider.refresh();
          }
        } else {
          // Create inline in FILES mode
          const success = await editor.addNodeInDocument(
            document,
            treeItem.codexNode,
            'child',
            { name, type, proseField: 'body', proseValue: '' },
            settings
          );

          if (success) {
            // Refresh tree
            treeProvider.setActiveDocument(document);
            showTransientMessage(`✓ Added child: ${name}`, 3000);
          }
        }
      }
    )
  );

  // Add sibling node command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.addSiblingNode',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) {
          vscode.window.showInformationMessage('Select a node to add a sibling to');
          return;
        }

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;

          if (nodeKind === 'file') {
            const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
            if (!name) return;
            if (/[/\\]/.test(name) || name === '..' || name === '.') {
              vscode.window.showErrorMessage('Invalid node name');
              return;
            }
            const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: treeItem.indexNode.type || 'chapter' });
            if (!type) return;
            const filePath = treeItem.indexNode._computed_path;
            if (!filePath) return;
            const dir = path.dirname(filePath);

            const { getStructureEditor } = await import('./structureEditor');
            const { getSettingsManager } = await import('./settingsManager');
            const ed = getStructureEditor();
            const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
            const slugName = (ed as any).slugifyName(name, settings.naming);
            const newFilePath = path.join(dir, `${slugName}.codex.yaml`);
            const newFullPath = path.join(wsRoot, newFilePath);

            const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
            if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
              vscode.window.showErrorMessage('File path resolves outside workspace');
              return;
            }

            const { randomUUID } = await import('crypto');
            const content = `metadata:\n  formatVersion: "1.2"\nid: "${randomUUID()}"\ntype: ${type}\nname: "${name}"\nbody: ""\n`;
            await vscode.workspace.fs.writeFile(vscode.Uri.file(newFullPath), Buffer.from(content, 'utf-8'));
            await regenerateAndReload(wsRoot);
          } else if (nodeKind === 'node') {
            const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
            if (!resolved) return;
            const name = await vscode.window.showInputBox({ prompt: 'Enter node name' });
            if (!name) return;
            const type = await vscode.window.showInputBox({ prompt: 'Enter node type', value: treeItem.indexNode.type || 'scene' });
            if (!type) return;
            const { getStructureEditor } = await import('./structureEditor');
            const { getSettingsManager } = await import('./settingsManager');
            const ed = getStructureEditor();
            const settings = await getSettingsManager().getSettings(resolved.doc.uri);
            await ed.addNodeInDocument(resolved.doc, resolved.node, 'sibling-after', { name, type, proseField: 'body', proseValue: '' }, settings);
            await reloadTreeIndex();
          }
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) {
          vscode.window.showErrorMessage('No active document');
          return;
        }

        const { getStructureEditor } = await import('./structureEditor');
        const { getSettingsManager } = await import('./settingsManager');

        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);

        const name = await vscode.window.showInputBox({
          prompt: 'Enter node name',
          placeHolder: 'e.g., Scene 2, Chapter 3'
        });

        if (!name) return;

        const type = await vscode.window.showInputBox({
          prompt: 'Enter node type',
          value: (treeItem as CodexTreeItem).codexNode.type,
          placeHolder: 'e.g., scene, chapter'
        });

        if (!type) return;

        const success = await editor.addNodeInDocument(
          document,
          (treeItem as CodexTreeItem).codexNode,
          'sibling-after',
          { name, type, proseField: 'body', proseValue: '' },
          settings
        );

        if (success) {
          treeProvider.setActiveDocument(document);
          showTransientMessage(`✓ Added sibling: ${name}`, 3000);
        }
      }
    )
  );

  // Remove node command (move to trash)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.removeNode',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;
          if (nodeKind === 'file' || nodeKind === 'folder') {
            const filePath = treeItem.indexNode._computed_path;
            if (!filePath) return;
            const { getStructureEditor } = await import('./structureEditor');
            const { getSettingsManager } = await import('./settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
            await editor.removeFileFromIndex(wsRoot, filePath, false, settings);
            await regenerateAndReload(wsRoot);
          } else if (nodeKind === 'node') {
            const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
            if (!resolved) return;
            const { getStructureEditor } = await import('./structureEditor');
            const { getSettingsManager } = await import('./settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(resolved.doc.uri);
            await editor.removeNodeFromDocument(resolved.doc, resolved.node, false, settings);
            await reloadTreeIndex();
          }
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) return;

        const { getStructureEditor } = await import('./structureEditor');
        const { getSettingsManager } = await import('./settingsManager');

        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);

        const success = await editor.removeNodeFromDocument(
          document,
          (treeItem as CodexTreeItem).codexNode,
          false,
          settings
        );

        if (success) {
          treeProvider.setActiveDocument(document);
          showTransientMessage(`✓ Removed: ${(treeItem as CodexTreeItem).codexNode.name}`, 3000);
        }
      }
    )
  );

  // Delete node permanently command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.deleteNodePermanently',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;
          if (nodeKind === 'file' || nodeKind === 'folder') {
            const filePath = treeItem.indexNode._computed_path;
            if (!filePath) return;
            const { getStructureEditor } = await import('./structureEditor');
            const { getSettingsManager } = await import('./settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
            await editor.removeFileFromIndex(wsRoot, filePath, true, settings);
            await regenerateAndReload(wsRoot);
          } else if (nodeKind === 'node') {
            const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
            if (!resolved) return;
            const { getStructureEditor } = await import('./structureEditor');
            const { getSettingsManager } = await import('./settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(resolved.doc.uri);
            await editor.removeNodeFromDocument(resolved.doc, resolved.node, true, settings);
            await reloadTreeIndex();
          }
          return;
        }

        const document = treeProvider.getActiveTextDocument();
        if (!document) return;

        const { getStructureEditor } = await import('./structureEditor');
        const { getSettingsManager } = await import('./settingsManager');

        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);

        const success = await editor.removeNodeFromDocument(
          document,
          (treeItem as CodexTreeItem).codexNode,
          true,
          settings
        );

        if (success) {
          treeProvider.setActiveDocument(document);
          showTransientMessage(`✓ Deleted: ${(treeItem as CodexTreeItem).codexNode.name}`, 3000);
        }
      }
    )
  );

  // Rename node command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.renameNode',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (treeItem instanceof IndexNodeTreeItem) {
          const wsRoot = getWorkspaceRoot();
          if (!wsRoot) return;
          const nodeKind = (treeItem.indexNode as any)._node_kind;
          const currentName = treeItem.indexNode.name || treeItem.indexNode.title || '';
          const newName = await vscode.window.showInputBox({ prompt: 'Enter new name', value: currentName });
          if (!newName || newName === currentName) return;

          if (nodeKind === 'file') {
            const filePath = treeItem.indexNode._computed_path;
            if (!filePath) return;
            const { getStructureEditor } = await import('./structureEditor');
            const { getSettingsManager } = await import('./settingsManager');
            const editor = getStructureEditor();
            const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
            await editor.renameFileInIndex(wsRoot, filePath, newName, settings);
            await regenerateAndReload(wsRoot);
          } else if (nodeKind === 'node') {
            const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
            if (!resolved) return;
            const { getStructureEditor } = await import('./structureEditor');
            const editor = getStructureEditor();
            await editor.renameNodeInDocument(resolved.doc, resolved.node, newName);
            await reloadTreeIndex();
          }
          return;
        }

        const newName = await vscode.window.showInputBox({
          prompt: 'Enter new name',
          value: (treeItem as CodexTreeItem).codexNode.name,
          placeHolder: 'New node name'
        });

        if (!newName || newName === (treeItem as CodexTreeItem).codexNode.name) return;

        const document = treeProvider.getActiveTextDocument();
        if (!document) {
          vscode.window.showErrorMessage('No active document');
          return;
        }

        const { getStructureEditor } = await import('./structureEditor');
        const editor = getStructureEditor();

        const success = await editor.renameNodeInDocument(
          document,
          (treeItem as CodexTreeItem).codexNode,
          newName
        );

        if (success) {
          treeProvider.setActiveDocument(document);
          showTransientMessage(`✓ Renamed to: ${newName}`, 3000);
        }
      }
    )
  );

  // Move node up command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.moveNodeUp',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (!(treeItem instanceof IndexNodeTreeItem)) {
          vscode.window.showInformationMessage('Move up/down only works in Index mode');
          return;
        }

        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;

        const filePath = treeItem.getFilePath();
        const relativePath = path.relative(wsRoot, filePath);

        const { getStructureEditor } = await import('./structureEditor');
        const editor = getStructureEditor();

        const result = await editor.moveFileUp(wsRoot, relativePath);

        if (result.success) {
          showTransientMessage(result.message || '✓ Moved up', 3000);
          await reloadTreeIndex();
        } else {
          vscode.window.showWarningMessage(result.message || 'Failed to move up');
        }
      }
    )
  );

  // Move node down command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.moveNodeDown',
      async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
        if (!treeItem) return;

        if (!(treeItem instanceof IndexNodeTreeItem)) {
          vscode.window.showInformationMessage('Move up/down only works in Index mode');
          return;
        }

        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;

        const filePath = treeItem.getFilePath();
        const relativePath = path.relative(wsRoot, filePath);

        const { getStructureEditor } = await import('./structureEditor');
        const editor = getStructureEditor();

        const result = await editor.moveFileDown(wsRoot, relativePath);

        if (result.success) {
          showTransientMessage(result.message || '✓ Moved down', 3000);
          await reloadTreeIndex();
        } else {
          vscode.window.showWarningMessage(result.message || 'Failed to move down');
        }
      }
    )
  );

  // Change color command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwiseCodex.changeColor',
      async (treeItem?: CodexTreeItem) => {
        if (!treeItem) return;

        const document = treeProvider.getActiveTextDocument();
        if (!document) return;

        const { getColorManager } = await import('./colorManager');
        const colorManager = getColorManager();

        const success = await colorManager.changeColor(treeItem.codexNode, document);

        if (success) {
          treeProvider.setActiveDocument(document);
        }
      }
    )
  );

  // === Stage 6: New Command Handlers ===

  // Add field to node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.addField', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const fieldName = await vscode.window.showInputBox({ prompt: 'Enter field name', placeHolder: 'e.g., synopsis, notes' });
      if (!fieldName) return;
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.addFieldToNode(doc, treeItem.codexNode, fieldName);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.addFieldToNode(resolved.doc, resolved.node, fieldName);
      }
      await reloadTreeIndex();
    })
  );

  // Delete field from node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.deleteField', async (treeItem?: CodexFieldTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexFieldTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.removeFieldFromNode(doc, treeItem.parentNode, treeItem.fieldName);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const fieldName = (treeItem.indexNode as any)._field_name;
        if (!fieldName) return;
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.removeFieldFromNode(resolved.doc, resolved.node, fieldName);
      }
      await reloadTreeIndex();
    })
  );

  // Rename field on node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.renameField', async (treeItem?: CodexFieldTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      let oldName: string | undefined;
      if (treeItem instanceof CodexFieldTreeItem) {
        oldName = treeItem.fieldName;
      } else if (treeItem instanceof IndexNodeTreeItem) {
        oldName = (treeItem.indexNode as any)._field_name;
      }
      if (!oldName) return;
      const newName = await vscode.window.showInputBox({ prompt: 'Enter new field name', value: oldName });
      if (!newName || newName === oldName) return;
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexFieldTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.renameFieldOnNode(doc, treeItem.parentNode, oldName, newName);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.renameFieldOnNode(resolved.doc, resolved.node, oldName, newName);
      }
      await reloadTreeIndex();
    })
  );

  // Change node type
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.changeType', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const types = ['book', 'chapter', 'scene', 'character', 'location', 'item', 'event', 'note', 'world', 'faction', 'lore'];
      const picked = await vscode.window.showQuickPick(types, { placeHolder: 'Select node type' });
      if (!picked) return;
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.changeNodeType(doc, treeItem.codexNode, picked);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.changeNodeType(resolved.doc, resolved.node, picked);
      }
      await reloadTreeIndex();
    })
  );

  // Change icon/emoji
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.changeIcon', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const emoji = await vscode.window.showInputBox({ prompt: 'Enter emoji', placeHolder: 'e.g., 📖 🗡️ 🏰' });
      if (!emoji) return;
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.setEmojiOnNode(doc, treeItem.codexNode, emoji);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.setEmojiOnNode(resolved.doc, resolved.node, emoji);
      }
      await reloadTreeIndex();
    })
  );

  // Add tags to node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.addTags', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const input = await vscode.window.showInputBox({ prompt: 'Enter tags (comma-separated)', placeHolder: 'e.g., action, drama, mystery' });
      if (!input) return;
      const tags = input.split(',').map(t => t.trim()).filter(Boolean);
      if (tags.length === 0) return;
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.addTagsToNode(doc, treeItem.codexNode, tags);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.addTagsToNode(resolved.doc, resolved.node, tags);
      }
      await reloadTreeIndex();
    })
  );

  // Add relation to node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.addRelation', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const targetId = await vscode.window.showInputBox({ prompt: 'Enter target node ID' });
      if (!targetId) return;
      const relTypes = ['follows', 'precedes', 'references', 'parent-of', 'child-of', 'related-to'];
      const relType = await vscode.window.showQuickPick(relTypes, { placeHolder: 'Select relation type' });
      if (!relType) return;
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.addRelationToNode(doc, treeItem.codexNode, targetId, relType);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (resolved) await editor.addRelationToNode(resolved.doc, resolved.node, targetId, relType);
      }
      await reloadTreeIndex();
    })
  );

  // Copy path (index files/folders only)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.copyPath', async (treeItem?: IndexNodeTreeItem) => {
      if (!treeItem) return;
      const cp = treeItem.indexNode._computed_path;
      if (!cp) return;
      await vscode.env.clipboard.writeText(cp);
      vscode.window.setStatusBarMessage(`Copied path: ${cp}`, 3000);
    })
  );

  // Open in file explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.openInFinder', async (treeItem?: IndexNodeTreeItem) => {
      if (!treeItem) return;
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const cp = treeItem.indexNode._computed_path;
      if (!cp) return;
      const fullPath = path.join(wsRoot, cp);
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(fullPath));
    })
  );

  // Move to trash
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.moveToTrash', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const nodeKind = (treeItem.indexNode as any)._node_kind;
        if (nodeKind === 'file' || nodeKind === 'folder') {
          const filePath = treeItem.indexNode._computed_path;
          if (!filePath) return;
          const { getStructureEditor } = await import('./structureEditor');
          const { getSettingsManager } = await import('./settingsManager');
          const editor = getStructureEditor();
          const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
          await editor.removeFileFromIndex(wsRoot, filePath, false, settings);
          await regenerateAndReload(wsRoot);
          return;
        } else if (nodeKind === 'node') {
          const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
          if (!resolved) return;
          const { getStructureEditor } = await import('./structureEditor');
          const { getSettingsManager } = await import('./settingsManager');
          const editor = getStructureEditor();
          const settings = await getSettingsManager().getSettings(resolved.doc.uri);
          await editor.removeNodeFromDocument(resolved.doc, resolved.node, false, settings);
          await reloadTreeIndex();
          return;
        }
      }
      if (treeItem instanceof CodexTreeItem) {
        const document = treeProvider.getActiveTextDocument();
        if (!document) return;
        const { getStructureEditor } = await import('./structureEditor');
        const { getSettingsManager } = await import('./settingsManager');
        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);
        await editor.removeNodeFromDocument(document, treeItem.codexNode, false, settings);
        treeProvider.setActiveDocument(document);
      }
    })
  );

  // Duplicate node
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.duplicateNode', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        await editor.duplicateNodeInDocument(doc, treeItem.codexNode);
        treeProvider.setActiveDocument(doc);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const nodeKind = (treeItem.indexNode as any)._node_kind;
        if (nodeKind === 'file') {
          const filePath = treeItem.indexNode._computed_path;
          if (!filePath) return;
          const fullPath = path.join(wsRoot, filePath);
          const ext = path.extname(filePath);
          const base = filePath.slice(0, -ext.length);
          const newPath = `${base}-copy${ext}`;
          const newFullPath = path.join(wsRoot, newPath);
          const fsPromises = (await import('fs/promises'));
          await fsPromises.copyFile(fullPath, newFullPath);
          await regenerateAndReload(wsRoot);
        } else if (nodeKind === 'node') {
          const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
          if (!resolved) return;
          await editor.duplicateNodeInDocument(resolved.doc, resolved.node);
          await reloadTreeIndex();
        }
      }
    })
  );

  // Cut node (store in clipboard)
  // ClipboardManager is lazily initialized on first cut
  let clipboardManager: ClipboardManager | null = null;
  const getClipboard = async () => {
    if (!clipboardManager) {
      const { ClipboardManager } = await import('./clipboardManager');
      clipboardManager = new ClipboardManager();
      context.subscriptions.push(clipboardManager);
      treeProvider.setIsCutFn(
        (nodeId: string) => clipboardManager.isCut(nodeId),
        clipboardManager.onDidChange
      );
    }
    return clipboardManager;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.cutNode', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const cb = await getClipboard();
      if (treeItem instanceof CodexTreeItem) {
        cb.cut({
          nodeId: treeItem.codexNode.id,
          nodeType: treeItem.codexNode.type,
          nodeName: treeItem.codexNode.name,
          sourceUri: treeItem.documentUri,
          sourcePath: treeItem.codexNode.path || [],
          isFileBacked: false,
        });
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const nodeKind = (treeItem.indexNode as any)._node_kind;
        cb.cut({
          nodeId: treeItem.indexNode.id,
          nodeType: treeItem.indexNode.type || '',
          nodeName: treeItem.indexNode.name || treeItem.indexNode.title || '',
          sourceUri: treeItem.documentUri,
          sourcePath: [],
          isFileBacked: nodeKind === 'file',
          filePath: nodeKind === 'file' ? treeItem.indexNode._computed_path : undefined,
        });
      }
      await reloadTreeIndex();
      showTransientMessage('Cut to clipboard', 2000);
    })
  );

  // Paste node as child
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.pasteNodeAsChild', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const cb = await getClipboard();
      const entry = cb.getCutEntry();
      if (!entry) {
        vscode.window.showInformationMessage('Nothing in clipboard');
        return;
      }
      if (entry.isFileBacked && treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const nodeKind = (treeItem.indexNode as any)._node_kind;
        if (nodeKind === 'folder' && entry.filePath) {
          const destFolder = treeItem.indexNode._computed_path || '';
          const { getStructureEditor } = await import('./structureEditor');
          const { getSettingsManager } = await import('./settingsManager');
          const editor = getStructureEditor();
          const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, entry.filePath)));
          await editor.moveFileInIndex(wsRoot, entry.filePath, destFolder, settings);
          cb.clear();
          await regenerateAndReload(wsRoot);
          return;
        }
      }
      cb.clear();
      await reloadTreeIndex();
    })
  );

  // Paste node as sibling
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.pasteNodeAsSibling', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const cb = await getClipboard();
      const entry = cb.getCutEntry();
      if (!entry) {
        vscode.window.showInformationMessage('Nothing in clipboard');
        return;
      }
      if (entry.isFileBacked && treeItem instanceof IndexNodeTreeItem && entry.filePath) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const targetPath = treeItem.indexNode._computed_path;
        if (!targetPath) return;
        const destFolder = path.dirname(targetPath);
        const { getStructureEditor } = await import('./structureEditor');
        const { getSettingsManager } = await import('./settingsManager');
        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, entry.filePath)));
        await editor.moveFileInIndex(wsRoot, entry.filePath, destFolder, settings);
        cb.clear();
        await regenerateAndReload(wsRoot);
        return;
      }
      cb.clear();
      await reloadTreeIndex();
    })
  );

  // Restore from trash
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.restoreFromTrash', async () => {
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const { TrashManager } = await import('./trashManager');
      const trash = new TrashManager(wsRoot);
      const items = await trash.listTrash();
      if (items.length === 0) {
        vscode.window.showInformationMessage('Trash is empty');
        return;
      }
      const picked = await vscode.window.showQuickPick(items.map(i => ({ label: i.name, item: i })), { placeHolder: 'Select item to restore' });
      if (!picked) return;
      await trash.restoreFromTrash(picked.item.name);
      await regenerateAndReload(wsRoot);
    })
  );

  // Empty trash
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.emptyTrash', async () => {
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const { TrashManager } = await import('./trashManager');
      const trash = new TrashManager(wsRoot);
      const hasItems = await trash.hasTrash();
      if (!hasItems) {
        vscode.window.showInformationMessage('Trash is already empty');
        return;
      }
      const confirm = await vscode.window.showWarningMessage('Permanently delete all items in trash?', { modal: true }, 'Empty Trash');
      if (confirm !== 'Empty Trash') return;
      await trash.emptyTrash();
      showTransientMessage('Trash emptied', 3000);
    })
  );

  // Extract node to file
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.extractToFile', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const { getStructureEditor } = await import('./structureEditor');
      const { getSettingsManager } = await import('./settingsManager');
      const editor = getStructureEditor();
      if (treeItem instanceof CodexTreeItem) {
        const doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        const settings = await getSettingsManager().getSettings(doc.uri);
        await editor.extractNodeToFile(doc, treeItem.codexNode, wsRoot, settings);
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (!resolved) return;
        const settings = await getSettingsManager().getSettings(resolved.doc.uri);
        await editor.extractNodeToFile(resolved.doc, resolved.node, wsRoot, settings);
      }
      await regenerateAndReload(wsRoot);
    })
  );

  // Add child file (index folders)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.addChildFile', async (treeItem?: IndexNodeTreeItem) => {
      if (!treeItem) return;
      const nodeKind = (treeItem.indexNode as any)._node_kind;
      if (nodeKind !== 'folder') return;
      const name = await vscode.window.showInputBox({ prompt: 'Enter file name' });
      if (!name) return;
      if (/[/\\]/.test(name) || name === '..' || name === '.') {
        vscode.window.showErrorMessage('Invalid file name');
        return;
      }
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const parentPath = treeItem.indexNode._computed_path || '';
      const { getStructureEditor } = await import('./structureEditor');
      const { getSettingsManager } = await import('./settingsManager');
      const editor = getStructureEditor();
      const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, parentPath)));
      const slugName = (editor as any).slugifyName(name, settings.naming);
      const newFilePath = path.join(parentPath, `${slugName}.codex.yaml`);
      const newFullPath = path.join(wsRoot, newFilePath);
      const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
      if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
        vscode.window.showErrorMessage('File path resolves outside workspace');
        return;
      }
      const { randomUUID } = await import('crypto');
      const content = `metadata:\n  formatVersion: "1.2"\nid: "${randomUUID()}"\ntype: chapter\nname: "${name}"\nbody: ""\n`;
      await vscode.workspace.fs.writeFile(vscode.Uri.file(newFullPath), Buffer.from(content, 'utf-8'));
      const { getOrderingManager } = await import('./orderingManager');
      const om = getOrderingManager(wsRoot);
      await om.addEntry(parentPath, { name: `${slugName}.codex.yaml`, type: 'file' });
      await regenerateAndReload(wsRoot);
    })
  );

  // Rename folder
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.renameFolder', async (treeItem?: IndexNodeTreeItem) => {
      if (!treeItem) return;
      const nodeKind = (treeItem.indexNode as any)._node_kind;
      if (nodeKind !== 'folder') return;
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const oldPath = treeItem.indexNode._computed_path;
      if (!oldPath) return;
      const oldName = path.basename(oldPath);
      const newName = await vscode.window.showInputBox({ prompt: 'Enter new folder name', value: oldName });
      if (!newName || newName === oldName) return;
      if (/[/\\]/.test(newName) || newName === '..' || newName === '.') {
        vscode.window.showErrorMessage('Invalid folder name');
        return;
      }
      const parentDir = path.dirname(oldPath);
      const newPath = parentDir === '.' ? newName : path.join(parentDir, newName);
      const oldFullPath = path.join(wsRoot, oldPath);
      const newFullPath = path.join(wsRoot, newPath);
      const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
      if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
        vscode.window.showErrorMessage('Folder path resolves outside workspace');
        return;
      }
      const fsPromises = await import('fs/promises');
      await fsPromises.rename(oldFullPath, newFullPath);
      await regenerateAndReload(wsRoot);
    })
  );

  // Batch move to trash (multi-select)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.batchMoveToTrash',
      async (item: CodexTreeItem | IndexNodeTreeItem, selectedItems: (CodexTreeItem | IndexNodeTreeItem)[]) => {
        const items = selectedItems || [item];
        const confirm = await vscode.window.showWarningMessage(
          `Move ${items.length} items to trash?`, { modal: true }, 'Move to Trash'
        );
        if (confirm !== 'Move to Trash') return;
        for (const ti of items) {
          await vscode.commands.executeCommand('chapterwiseCodex.moveToTrash', ti);
        }
      }
    )
  );

  // Batch add tags (multi-select)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.batchAddTags',
      async (item: CodexTreeItem | IndexNodeTreeItem, selectedItems: (CodexTreeItem | IndexNodeTreeItem)[]) => {
        const items = selectedItems || [item];
        const input = await vscode.window.showInputBox({ prompt: `Add tags to ${items.length} items (comma-separated)` });
        if (!input) return;
        const tags = input.split(',').map(t => t.trim()).filter(Boolean);
        if (tags.length === 0) return;
        const wsRoot = getWorkspaceRoot();
        const { getStructureEditor } = await import('./structureEditor');
        const editor = getStructureEditor();
        for (const ti of items) {
          if (ti instanceof CodexTreeItem) {
            const doc = await vscode.workspace.openTextDocument(ti.documentUri);
            await editor.addTagsToNode(doc, ti.codexNode, tags);
          } else if (ti instanceof IndexNodeTreeItem) {
            if (!wsRoot) continue;
            const resolved = await resolveIndexNodeForEdit(ti, wsRoot);
            if (resolved) await editor.addTagsToNode(resolved.doc, resolved.node, tags);
          }
        }
        await reloadTreeIndex();
      }
    )
  );

  // Inline This File (reverse of extractToFile)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.inlineThisFile', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      let doc: vscode.TextDocument;
      let node: any;

      if (treeItem instanceof CodexTreeItem) {
        if (!(treeItem.codexNode as any).includePath) {
          vscode.window.showInformationMessage('This node is not an include reference');
          return;
        }
        doc = await vscode.workspace.openTextDocument(treeItem.documentUri);
        node = treeItem.codexNode;
      } else if (treeItem instanceof IndexNodeTreeItem) {
        const wsRoot = getWorkspaceRoot();
        if (!wsRoot) return;
        const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
        if (!resolved || !(resolved.node as any).includePath) {
          vscode.window.showInformationMessage('This node is not an include reference');
          return;
        }
        doc = resolved.doc;
        node = resolved.node;
      } else {
        return;
      }

      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;

      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Keep original file', value: false },
          { label: 'Delete original file', value: true },
        ],
        { placeHolder: 'What to do with the original file?' }
      );
      if (!choice) return;

      const { getStructureEditor } = await import('./structureEditor');
      const editor = getStructureEditor();
      const result = await editor.inlineThisFile(doc, node, wsRoot, choice.value);
      if (result) {
        if (choice.value) {
          await regenerateAndReload(wsRoot);
        } else {
          await reloadTreeIndex();
        }
      }
    })
  );

  // Add child folder (subfolder)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.addChildFolder', async (treeItem?: IndexNodeTreeItem) => {
      if (!treeItem) return;
      const nodeKind = (treeItem.indexNode as any)._node_kind;
      if (nodeKind !== 'folder') return;
      const folderName = await vscode.window.showInputBox({ prompt: 'Enter subfolder name' });
      if (!folderName) return;
      if (/[/\\]/.test(folderName) || folderName === '..' || folderName === '.') {
        vscode.window.showErrorMessage('Invalid folder name');
        return;
      }
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const parentPath = treeItem.indexNode._computed_path || '';
      const newFolderPath = path.join(wsRoot, parentPath, folderName);
      const { isPathWithinWorkspace } = await import('./writerView/utils/helpers');
      if (!isPathWithinWorkspace(newFolderPath, wsRoot)) {
        vscode.window.showErrorMessage('Folder path resolves outside workspace');
        return;
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(newFolderPath));
      const { getOrderingManager } = await import('./orderingManager');
      const om = getOrderingManager(wsRoot);
      await om.addEntry(parentPath, { name: folderName, type: 'folder', children: [] });
      await regenerateAndReload(wsRoot);
    })
  );

  // Switch to INDEX mode command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.switchToIndexMode', async () => {
      treeProvider.setNavigationMode('index');

      // Set context for button highlighting
      await vscode.commands.executeCommand('setContext', 'codexNavigatorMode', 'index');

      // Auto-open .index.codex.json if it exists
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
      if (workspaceRoot) {
        const indexPath = path.join(workspaceRoot.uri.fsPath, '.index.codex.json');
        if (fs.existsSync(indexPath)) {
          const doc = await vscode.workspace.openTextDocument(indexPath);
          treeProvider.setActiveDocument(doc);
        }
      }
    })
  );


  // Autofix Folder command (run CodexAutoFixer on all files in folder)
  // Note: Order renormalization removed — ordering now managed by index.codex.yaml array position
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.autofixFolder', async (item: any) => {
      if (!item || !item.indexNode) {
        vscode.window.showErrorMessage('No folder selected');
        return;
      }

      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
      }

      const folderPath = item.indexNode._computed_path || item.indexNode.name;

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Autofixing folder: ${item.indexNode.name}...`,
        cancellable: false,
      }, async (progress) => {
        const { CodexAutoFixer } = await import('./autoFixer');

        progress.report({ message: 'Finding Codex files...', increment: 10 });

        const folderFullPath = path.join(wsRoot, folderPath);
        if (!fs.existsSync(folderFullPath)) {
          vscode.window.showWarningMessage(`Folder not found: ${folderPath}`);
          return;
        }

        const files = fs.readdirSync(folderFullPath)
          .filter(file => file.endsWith('.codex.yaml'))
          .map(file => path.join(folderFullPath, file));

        if (files.length === 0) {
          treeProvider.refresh();
          showTransientMessage(`Autofix complete: no .codex.yaml files found`, 4000);
          return;
        }

        const fixer = new CodexAutoFixer();
        let fixedCount = 0;
        let totalFixes = 0;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fileName = path.basename(file);
          progress.report({ message: `Fixing ${fileName} (${i + 1}/${files.length})...`, increment: 80 / files.length });

          try {
            const content = fs.readFileSync(file, 'utf-8');
            const fixResult = fixer.autoFixCodex(content, false);
            if (fixResult.success && fixResult.fixesApplied.length > 0) {
              fs.writeFileSync(file, fixResult.fixedText, 'utf-8');
              fixedCount++;
              totalFixes += fixResult.fixesApplied.length;
            }
          } catch (error) {
            outputChannel.appendLine(`[autofixFolder] ${fileName}: Exception - ${error}`);
          }
        }

        treeProvider.refresh();
        vscode.window.showInformationMessage(
          `Autofix complete for "${item.indexNode.name}": Fixed ${fixedCount}/${files.length} files (${totalFixes} total fixes)`
        );
      });
    })
  );

  // Set Context Folder command (scope navigator to a specific folder)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.setContextFolder', async (uri: vscode.Uri) => {
      if (!uri) {
        vscode.window.showErrorMessage('No folder selected');
        return;
      }

      // Find the workspace folder that contains this URI
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('Could not determine workspace folder for selected path');
        return;
      }

      const workspaceRoot = workspaceFolder.uri.fsPath;
      const folderPath = path.relative(workspaceRoot, uri.fsPath);

      outputChannel.appendLine(`[setContextFolder] Called for folder: ${folderPath}`);
      outputChannel.appendLine(`[setContextFolder] Workspace root: ${workspaceRoot}`);

      // Generate index if needed (always regenerate)
      const indexPath = path.join(uri.fsPath, '.index.codex.json');

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Setting context to: ${path.basename(uri.fsPath)}...`,
        cancellable: true,  // ← Change to true
      }, async (progress, token) => {  // ← Add token parameter
        outputChannel.appendLine(`[setContextFolder] Regenerating index hierarchy for: ${folderPath}`);

        // Create progress reporter with cancellation
        const progressReporter: IndexGenerationProgress = {
          report: (message: string, increment?: number) => {
            progress.report({ message, increment });
          },
          token
        };

        try {
          // Always regenerate index hierarchy recursively
          await generateFolderHierarchy(workspaceRoot, folderPath, progressReporter);
        } catch (error: any) {
          if (error.message?.includes('cancelled')) {
            outputChannel.appendLine('[setContextFolder] Cancelled by user');
            vscode.window.showInformationMessage('Index generation cancelled');
            return;  // Exit early
          }
          throw error;  // Re-throw other errors
        }

        // EXPLICITLY set context in tree provider
        outputChannel.appendLine(`[setContextFolder] Calling treeProvider.setContextFolder()`);
        progress.report({ message: 'Loading index into tree view...', increment: 5 });

        await treeProvider.setContextFolder(folderPath, workspaceRoot);

        outputChannel.appendLine(`[setContextFolder] Tree view loaded`);

        // Update tree view title
        treeView.title = `📋 ${path.basename(uri.fsPath)}`;

        // Save context for next session
        await context.workspaceState.update('chapterwiseCodex.lastContextPath', uri.fsPath);
        await context.workspaceState.update('chapterwiseCodex.lastContextType', 'folder');
        outputChannel.appendLine(`[setContextFolder] Context saved to workspace state`);

        // After setting context folder, discover indexes for multi-index mode
        if (multiIndexManager && workspaceRoot) {
          const config = vscode.workspace.getConfiguration('chapterwiseCodex');
          const displayMode = config.get<string>('indexDisplayMode', 'stacked');

          if (displayMode === 'stacked') {
            outputChannel.appendLine(`[setContextFolder] Discovering indexes for stacked mode...`);
            const indexes = await multiIndexManager.discoverIndexes(workspaceRoot);
            outputChannel.appendLine(`[setContextFolder] Found ${indexes.length} indexes`);

            // Update master tree provider
            if (masterTreeProvider) {
              masterTreeProvider.setManager(multiIndexManager, workspaceRoot);
            }

            // Assign sub-indexes to view slots
            const subIndexes = multiIndexManager.getSubIndexes();
            subIndexes.forEach((index, i) => {
              if (i < subIndexProviders.length) {
                subIndexProviders[i].setIndex(index);
                // Update view title
                subIndexViews[i].title = index.displayName;
              }
            });

            // Clear unused slots
            for (let i = subIndexes.length; i < subIndexProviders.length; i++) {
              subIndexProviders[i].setIndex(null);
            }

            outputChannel.appendLine(`[setContextFolder] Multi-index views configured`);
          }
        }
      });

      outputChannel.appendLine(`[setContextFolder] Complete - Viewing: ${path.basename(uri.fsPath)}`);
      showTransientMessage(`📋 Viewing: ${path.basename(uri.fsPath)}`, 3000);
    })
  );

  // Set Context File command (for individual .codex.yaml files)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.setContextFile', async (uri?: vscode.Uri) => {
      if (!uri) {
        vscode.window.showErrorMessage('No file selected');
        return;
      }

      outputChannel.appendLine(`[setContextFile] Called for file: ${uri.fsPath}`);

      // Find workspace root
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('Could not determine workspace folder');
        return;
      }

      try {
        // Open the file
        const doc = await vscode.workspace.openTextDocument(uri.fsPath);
        await vscode.window.showTextDocument(doc);

        // EXPLICITLY set context - this is an explicit user action
        outputChannel.appendLine(`[setContextFile] Calling treeProvider.setActiveDocument(explicit=true)`);
        treeProvider.setActiveDocument(doc, true);

        // Update tree view title
        treeView.title = `📄 ${path.basename(uri.fsPath, '.codex.yaml')}`;

        // Save context for next session
        await context.workspaceState.update('chapterwiseCodex.lastContextPath', uri.fsPath);
        await context.workspaceState.update('chapterwiseCodex.lastContextType', 'file');
        outputChannel.appendLine(`[setContextFile] Context saved to workspace state`);

        outputChannel.appendLine(`[setContextFile] Complete - Viewing: ${path.basename(uri.fsPath)}`);
        showTransientMessage(`📄 Viewing: ${path.basename(uri.fsPath)}`, 3000);
      } catch (error) {
        outputChannel.appendLine(`[setContextFile] ERROR: ${error}`);
        vscode.window.showErrorMessage(`Failed to open file: ${error}`);
      }
    })
  );

  // Reset Context command (return to workspace root)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.resetContext', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      // Clear context folder
      await treeProvider.setContextFolder(null, workspaceRoot);

      // Reset tree view title
      treeView.title = 'ChapterWise Codex';

      // Clear saved context state
      await context.workspaceState.update('chapterwiseCodex.lastContextPath', undefined);
      await context.workspaceState.update('chapterwiseCodex.lastContextType', undefined);
      outputChannel.appendLine(`[resetContext] Context cleared from workspace state`);

      // Stay in INDEX mode but show workspace root
      treeProvider.refresh();

      vscode.window.showInformationMessage('📋 Reset to workspace root');
    })
  );
}

/**
 * Update status bar based on current editor
 */
function updateStatusBar(): void {
  const editor = vscode.window.activeTextEditor;

  if (editor && isCodexFile(editor.document.fileName)) {
    if (treeProvider?.isInIndexMode()) {
      const indexDoc = treeProvider.getIndexDocument();
      const fileCount = indexDoc ? countIndexFiles(indexDoc.children) : 0;

      statusBarItem.text = `$(list-tree) Index: ${fileCount} files`;
      statusBarItem.tooltip = `ChapterWise Index\n${fileCount} files in project\nClick to open Navigator`;
    } else {
    const codexDoc = treeProvider?.getCodexDocument();
    const nodeCount = codexDoc?.allNodes.length ?? 0;
    const typeCount = codexDoc?.types.size ?? 0;

    statusBarItem.text = `$(book) Codex: ${nodeCount} nodes`;
    statusBarItem.tooltip = `ChapterWise Codex\n${nodeCount} nodes, ${typeCount} types\nClick to open Navigator`;
    }
    statusBarItem.show();
  } else {
    statusBarItem?.hide();
  }
}

// ============================================================================
// Navigation Helper Functions
// ============================================================================

/**
 * Recursively find a node by ID in the codex tree
 */
function findNodeById(node: CodexNode, targetId: string): CodexNode | null {
  if (node.id === targetId) {
    return node;
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findNodeById(child, targetId);
      if (found) return found;
    }
  }

  return null;
}

// ============================================================================
// Phase 5: Tree State Management Helper Functions
// ============================================================================

/**
 * Update the expansion state of a node (debounced)
 */
async function updateNodeExpandedState(
  item: IndexNodeTreeItem,
  expanded: boolean
): Promise<void> {
  const workspaceRoot = treeProvider.getWorkspaceRoot();
  if (!workspaceRoot) return;

  // Determine which index file contains this node
  const indexPath = determineIndexFileForNode(item, workspaceRoot);
  if (!fs.existsSync(indexPath)) return;

  const nodeId = item.indexNode.id;
  if (!nodeId) return;

  // Queue the update
  const updateKey = `${indexPath}::${nodeId}`;
  expandedUpdateQueue.set(updateKey, { indexPath, nodeId, expanded });

  // Debounce: wait 500ms for more updates before writing
  if (expandedUpdateTimeout) {
    clearTimeout(expandedUpdateTimeout);
  }

  expandedUpdateTimeout = setTimeout(async () => {
    await flushExpandedUpdates();
    expandedUpdateQueue.clear();
    expandedUpdateTimeout = null;
  }, 500);
}

/**
 * Flush all queued expansion state updates to disk (batched by file)
 */
async function flushExpandedUpdates(): Promise<void> {
  // Group updates by index file
  const fileUpdates = new Map<string, Array<{ nodeId: string; expanded: boolean }>>();

  for (const [key, update] of expandedUpdateQueue) {
    if (!fileUpdates.has(update.indexPath)) {
      fileUpdates.set(update.indexPath, []);
    }
    fileUpdates.get(update.indexPath)!.push({
      nodeId: update.nodeId,
      expanded: update.expanded
    });
  }

  // Apply updates to each index file
  for (const [indexPath, updates] of fileUpdates) {
    try {
      await updateIndexFileExpansionState(indexPath, updates);
      outputChannel.appendLine(`[TreeState] Updated ${updates.length} nodes in ${path.basename(indexPath)}`);
    } catch (error) {
      outputChannel.appendLine(`[TreeState] Failed to update ${indexPath}: ${error}`);
    }
  }
}

/**
 * Update the expansion state in an index file
 * Security: Validates JSON structure and UUID format before processing
 */
async function updateIndexFileExpansionState(
  indexPath: string,
  updates: Array<{ nodeId: string; expanded: boolean }>
): Promise<void> {
  // Read and parse index file with error handling
  let content: string;
  let indexData: unknown;

  try {
    content = fs.readFileSync(indexPath, 'utf-8');
  } catch (error) {
    outputChannel.appendLine(`[updateIndexFileExpansionState] Failed to read index file: ${indexPath}`);
    return;
  }

  try {
    indexData = JSON.parse(content);
  } catch (error) {
    outputChannel.appendLine(`[updateIndexFileExpansionState] Invalid JSON in index file: ${indexPath}`);
    return;
  }

  // Security: Validate index structure before processing
  if (!isValidIndexStructure(indexData)) {
    outputChannel.appendLine(`[updateIndexFileExpansionState] Invalid index structure in: ${indexPath}`);
    return;
  }

  // Filter to only valid UUID updates (security: prevent injection)
  const validUpdates = updates.filter(update => {
    if (!isValidUuid(update.nodeId)) {
      outputChannel.appendLine(`[updateIndexFileExpansionState] Skipping invalid nodeId: ${update.nodeId}`);
      return false;
    }
    return true;
  });

  if (validUpdates.length === 0) {
    return;
  }

  // Apply all valid updates
  let changesApplied = 0;
  for (const update of validUpdates) {
    if (updateExpandedInTree(indexData.children as unknown[], update.nodeId, update.expanded)) {
      changesApplied++;
    }
  }

  if (changesApplied > 0) {
    // Write back to file
    try {
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
    } catch (error) {
      outputChannel.appendLine(`[updateIndexFileExpansionState] Failed to write index file: ${indexPath}`);
    }
  }
}

/**
 * Recursively search tree and update expanded property
 * Security: Only processes nodes with valid structure
 */
function updateExpandedInTree(
  children: unknown[],
  targetId: string,
  expanded: boolean
): boolean {
  if (!Array.isArray(children)) {
    return false;
  }

  for (const child of children) {
    // Validate child is an object with expected properties
    if (!child || typeof child !== 'object') {
      continue;
    }

    const node = child as Record<string, unknown>;

    // Check if this is the target node (id must be a string)
    if (typeof node.id === 'string' && node.id === targetId) {
      node.expanded = expanded;
      return true;
    }

    // Recurse into children if they exist and are an array
    if (Array.isArray(node.children)) {
      if (updateExpandedInTree(node.children, targetId, expanded)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Determine which index file contains a given node
 */
function determineIndexFileForNode(
  item: IndexNodeTreeItem,
  workspaceRoot: string
): string {
  const node = item.indexNode as any;

  // If node has _parent_file, it's a node/field - use parent file's folder
  if (node._parent_file) {
    const parentFilePath = node._parent_file;
    const folderPath = path.dirname(parentFilePath);
    const perFolderIndex = path.join(workspaceRoot, folderPath, '.index.codex.json');

    if (fs.existsSync(perFolderIndex)) {
      return perFolderIndex;
    }
  }

  // If node has _computed_path, use its directory
  if (node._computed_path) {
    const folderPath = path.dirname(node._computed_path);
    const perFolderIndex = path.join(workspaceRoot, folderPath, '.index.codex.json');

    if (fs.existsSync(perFolderIndex)) {
      return perFolderIndex;
    }
  }

  // Fall back to workspace root index
  return path.join(workspaceRoot, '.index.codex.json');
}

// ============================================================================
// Extension Deactivation
// ============================================================================

/**
 * Extension deactivation
 */
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
    (multiIndexManager as any)?.dispose?.();
  } catch (e) {
    console.error('Error disposing multi-index manager:', e);
  }

  try {
    (masterTreeProvider as any)?.dispose?.();
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

// Export for use by other modules
export function log(message: string): void {
  outputChannel?.appendLine(message);
}

export function getSearchIndexManager(): SearchIndexManager | null {
  return searchIndexManager;
}
