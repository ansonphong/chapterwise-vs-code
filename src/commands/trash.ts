import * as vscode from 'vscode';
import * as path from 'path';
import type { CommandDeps } from './types';
import { CodexTreeItem, IndexNodeTreeItem } from '../treeProvider';

export function registerTrashCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, getWorkspaceRoot, resolveIndexNodeForEdit, reloadTreeIndex, regenerateAndReload, showTransientMessage } = deps;

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
          const { getStructureEditor } = await import('../structureEditor');
          const { getSettingsManager } = await import('../settingsManager');
          const editor = getStructureEditor();
          const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, filePath)));
          await editor.removeFileFromIndex(wsRoot, filePath, false, settings);
          await regenerateAndReload(wsRoot);
          return;
        } else if (nodeKind === 'node') {
          const resolved = await resolveIndexNodeForEdit(treeItem, wsRoot);
          if (!resolved) return;
          const { getStructureEditor } = await import('../structureEditor');
          const { getSettingsManager } = await import('../settingsManager');
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
        const { getStructureEditor } = await import('../structureEditor');
        const { getSettingsManager } = await import('../settingsManager');
        const editor = getStructureEditor();
        const settings = await getSettingsManager().getSettings(document.uri);
        await editor.removeNodeFromDocument(document, treeItem.codexNode, false, settings);
        treeProvider.setActiveDocument(document);
      }
    })
  );

  // Restore from trash
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.restoreFromTrash', async () => {
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const { TrashManager } = await import('../trashManager');
      const trash = new TrashManager(wsRoot);
      const items = await trash.listTrash();
      if (items.length === 0) {
        vscode.window.showInformationMessage('Trash is empty');
        return;
      }
      const picked = await vscode.window.showQuickPick(items.map(i => ({ label: i.relativePath, description: i.name, item: i })), { placeHolder: 'Select item to restore' });
      if (!picked) return;
      await trash.restoreFromTrash(picked.item.relativePath);
      await regenerateAndReload(wsRoot);
    })
  );

  // Empty trash
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.emptyTrash', async () => {
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const { TrashManager } = await import('../trashManager');
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
}
