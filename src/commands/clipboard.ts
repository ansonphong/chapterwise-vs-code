import * as vscode from 'vscode';
import * as path from 'path';
import type { CommandDeps } from './types';
import { CodexTreeItem, IndexNodeTreeItem } from '../treeProvider';
import type { ClipboardManager } from '../clipboardManager';

// Module-level clipboard state (lazily initialized)
let clipboardManager: ClipboardManager | null = null;

export function registerClipboardCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, getWorkspaceRoot, reloadTreeIndex, regenerateAndReload, showTransientMessage } = deps;

  const getClipboard = async () => {
    if (!clipboardManager) {
      const { ClipboardManager } = await import('../clipboardManager');
      const cm = new ClipboardManager();
      clipboardManager = cm;
      context.subscriptions.push(cm);
      treeProvider.setIsCutFn(
        (nodeId: string) => cm.isCut(nodeId),
        cm.onDidChange
      );
    }
    return clipboardManager;
  };

  // Copy ID command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.copyId',
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

  // Copy path (index files/folders only)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.copyPath', async (treeItem?: IndexNodeTreeItem) => {
      if (!treeItem) return;
      const cp = treeItem.indexNode._computed_path;
      if (!cp) return;
      await vscode.env.clipboard.writeText(cp);
      vscode.window.setStatusBarMessage(`Copied path: ${cp}`, 3000);
    })
  );

  // Cut node (store in clipboard)
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.cutNode', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
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
    vscode.commands.registerCommand('chapterwise.pasteNodeAsChild', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
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
          const { getStructureEditor } = await import('../structureEditor');
          const { getSettingsManager } = await import('../settingsManager');
          const editor = getStructureEditor();
          const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, entry.filePath)));
          await editor.moveFileInIndex(wsRoot, entry.filePath, destFolder, settings);
          cb.clear();
          await regenerateAndReload(wsRoot);
          return;
        }
      }
      vscode.window.showInformationMessage('Paste is only supported for file-backed nodes');
      cb.clear();
      await reloadTreeIndex();
    })
  );

  // Paste node as sibling
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.pasteNodeAsSibling', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
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
        const { getStructureEditor } = await import('../structureEditor');
        const { getSettingsManager } = await import('../settingsManager');
        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, entry.filePath)));
        await editor.moveFileInIndex(wsRoot, entry.filePath, destFolder, settings);
        cb.clear();
        await regenerateAndReload(wsRoot);
        return;
      }
      vscode.window.showInformationMessage('Paste is only supported for file-backed nodes');
      cb.clear();
      await reloadTreeIndex();
    })
  );
}
