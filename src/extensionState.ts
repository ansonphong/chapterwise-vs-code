import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CodexTreeProvider, CodexTreeItemType, IndexNodeTreeItem } from './treeProvider';
import type { WriterViewManager } from './writerView';
import type { MultiIndexManager } from './multiIndexManager';
import type { SubIndexTreeProvider } from './subIndexTreeProvider';
import type { MasterIndexTreeProvider } from './masterIndexTreeProvider';
import type { SearchIndexManager } from './search';
import { isCodexFile, parseCodex, CodexNode } from './codexModel';
import { countFilesInIndex as countIndexFiles } from './indexParser';
import type { CommandDeps } from './commands/types';

// ============================================================================
// Module-level state
// ============================================================================

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
// State initialization
// ============================================================================

export function initState(
  tp: CodexTreeProvider,
  tv: vscode.TreeView<CodexTreeItemType>,
  wvm: WriterViewManager,
  sbi: vscode.StatusBarItem,
  oc: vscode.OutputChannel,
  mim: MultiIndexManager | undefined,
  mtp: MasterIndexTreeProvider | undefined,
  sips: SubIndexTreeProvider[],
  sivs: vscode.TreeView<CodexTreeItemType>[]
): void {
  treeProvider = tp;
  treeView = tv;
  writerViewManager = wvm;
  statusBarItem = sbi;
  outputChannel = oc;
  multiIndexManager = mim;
  masterTreeProvider = mtp;
  // Copy arrays by reference — caller already owns these
  sips.forEach(p => subIndexProviders.push(p));
  sivs.forEach(v => subIndexViews.push(v));
}

// Write-back setter — called by commands/search.ts after creating SearchIndexManager
export function setSearchIndexManager(sim: SearchIndexManager | null): void {
  searchIndexManager = sim;
}

// ============================================================================
// getDeps — builds the CommandDeps object for command modules
// ============================================================================

export function getDeps(): CommandDeps {
  return {
    treeProvider,
    treeView,
    writerViewManager,
    outputChannel,
    multiIndexManager,
    masterTreeProvider,
    subIndexProviders,
    subIndexViews,
    // Function closure — always reads current module-level variable
    getSearchIndexManager: () => searchIndexManager,
    getWorkspaceRoot,
    reloadTreeIndex,
    regenerateAndReload,
    resolveIndexNodeForEdit,
    showTransientMessage,
    findNodeById,
  };
}

// ============================================================================
// Disposal — called from deactivate() for non-subscription resources
// ============================================================================

export function disposeState(): void {
  try { writerViewManager?.dispose(); } catch (e) { /* swallow */ }
  subIndexViews.length = 0;
  subIndexProviders.length = 0;
  try { (multiIndexManager as any)?.dispose?.(); } catch (e) { /* swallow */ }
  try { (masterTreeProvider as any)?.dispose?.(); } catch (e) { /* swallow */ }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Notification Helper - Show transient messages that auto-dismiss
 */
export function showTransientMessage(message: string, duration: number = 3000): void {
  vscode.window.setStatusBarMessage(message, duration);
}

/**
 * Validate UUID v4 format
 */
export function isValidUuid(uuidStr: string): boolean {
  if (!uuidStr || typeof uuidStr !== 'string') {
    return false;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(uuidStr);
}

/**
 * Validate index file JSON structure
 */
export function isValidIndexStructure(data: unknown): data is { children: unknown[] } {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.children);
}

/** Get the first workspace folder's root path. */
export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Resolve an IndexNodeTreeItem to its backing document + CodexNode. */
export async function resolveIndexNodeForEdit(treeItem: IndexNodeTreeItem, wsRoot: string): Promise<{ doc: vscode.TextDocument; node: CodexNode } | null> {
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
 */
export async function reloadTreeIndex(): Promise<void> {
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
 */
export async function regenerateAndReload(wsRoot: string): Promise<void> {
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
 * Execute a promise with a timeout
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
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
export async function restoreLastContext(context: vscode.ExtensionContext): Promise<void> {
  const RESTORE_TIMEOUT_MS = 10000;

  try {
    const savedContextPath = context.workspaceState.get<string>('chapterwiseCodex.lastContextPath');
    const savedContextType = context.workspaceState.get<string>('chapterwiseCodex.lastContextType');

    if (!savedContextPath || !savedContextType) {
      return;
    }

    outputChannel.appendLine(`[restoreLastContext] Attempting to restore context: ${savedContextPath}`);

    if (!fs.existsSync(savedContextPath)) {
      outputChannel.appendLine(`[restoreLastContext] Saved context path no longer exists: ${savedContextPath}`);
      await context.workspaceState.update('chapterwiseCodex.lastContextPath', undefined);
      await context.workspaceState.update('chapterwiseCodex.lastContextType', undefined);
      return;
    }

    const uri = vscode.Uri.file(savedContextPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      outputChannel.appendLine(`[restoreLastContext] Saved context is not in a workspace`);
      return;
    }

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
  }
}

/**
 * Auto-discover index.codex.yaml files in top-level folders
 */
export async function autoDiscoverIndexFiles(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        console.log(`[ChapterWise Codex] Skipping symlink during discovery: ${entry.name}`);
        continue;
      }

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const folderPath = path.join(workspaceRoot, entry.name);
        const indexPath = path.join(folderPath, 'index.codex.yaml');

        if (fs.existsSync(indexPath)) {
          console.log(`[ChapterWise Codex] Found index at top level: ${entry.name}/index.codex.yaml`);
        }
      }
    }

    const rootIndexPath = path.join(workspaceRoot, '.index.codex.json');
    if (fs.existsSync(rootIndexPath)) {
      console.log(`[ChapterWise Codex] Found workspace root index: .index.codex.json`);
    }
  } catch (error) {
    console.error('[ChapterWise Codex] Error during auto-discovery:', error);
  }
}

/**
 * Sync ordering on startup (non-blocking)
 */
export function syncOrderingOnStartup(): void {
  const wsRoot = getWorkspaceRoot();
  if (wsRoot) {
    void (async () => {
      try {
        const { getOrderingManager } = await import('./orderingManager');
        const om = getOrderingManager(wsRoot);
        await om.syncWithFilesystem();
      } catch (e) {
        console.error('[ChapterWise Codex] Failed to sync ordering index:', e);
      }
    })();
  }
}

/**
 * Update status bar based on current editor
 */
export function updateStatusBar(): void {
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

/**
 * Recursively find a node by ID in the codex tree
 */
export function findNodeById(node: CodexNode, targetId: string): CodexNode | null {
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
// Re-exports for external consumers (treeProvider.ts, indexGenerator.ts)
// ============================================================================

export function getOutputChannel(): vscode.OutputChannel | undefined {
  return outputChannel;
}

export function getSearchIndexManager(): SearchIndexManager | null {
  return searchIndexManager;
}

export function log(message: string): void {
  outputChannel?.appendLine(message);
}
