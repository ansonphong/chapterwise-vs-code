import * as vscode from 'vscode';
import * as path from 'path';
import type { CommandDeps } from './types';
import { CodexTreeItem, IndexNodeTreeItem } from '../treeProvider';

export function registerFileOpsCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, getWorkspaceRoot, resolveIndexNodeForEdit, reloadTreeIndex, regenerateAndReload } = deps;

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
      const { getStructureEditor } = await import('../structureEditor');
      const { getSettingsManager } = await import('../settingsManager');
      const editor = getStructureEditor();
      const settings = await getSettingsManager().getSettings(vscode.Uri.file(path.join(wsRoot, parentPath)));
      const slugName = editor.slugifyName(name, settings.naming);
      const newFilePath = path.join(parentPath, `${slugName}.codex.yaml`);
      const newFullPath = path.join(wsRoot, newFilePath);
      const { isPathWithinWorkspace } = await import('../writerView/utils/helpers');
      if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
        vscode.window.showErrorMessage('File path resolves outside workspace');
        return;
      }
      const { randomUUID } = await import('crypto');
      const content = `metadata:\n  formatVersion: "1.2"\nid: "${randomUUID()}"\ntype: chapter\nname: "${name}"\nbody: ""\n`;
      await vscode.workspace.fs.writeFile(vscode.Uri.file(newFullPath), Buffer.from(content, 'utf-8'));
      const { getOrderingManager } = await import('../orderingManager');
      const om = getOrderingManager(wsRoot);
      await om.addEntry(parentPath, { name: `${slugName}.codex.yaml`, type: 'file' });
      await regenerateAndReload(wsRoot);
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
      const { isPathWithinWorkspace } = await import('../writerView/utils/helpers');
      if (!isPathWithinWorkspace(newFolderPath, wsRoot)) {
        vscode.window.showErrorMessage('Folder path resolves outside workspace');
        return;
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(newFolderPath));
      const { getOrderingManager } = await import('../orderingManager');
      const om = getOrderingManager(wsRoot);
      await om.addEntry(parentPath, { name: folderName, type: 'folder', children: [] });
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
      const { isPathWithinWorkspace } = await import('../writerView/utils/helpers');
      if (!isPathWithinWorkspace(oldFullPath, wsRoot)) {
        vscode.window.showErrorMessage('Source path is outside workspace.');
        return;
      }
      if (!isPathWithinWorkspace(newFullPath, wsRoot)) {
        vscode.window.showErrorMessage('Folder path resolves outside workspace');
        return;
      }
      const fsPromises = await import('fs/promises');
      await fsPromises.rename(oldFullPath, newFullPath);
      const { getStructureEditor } = await import('../structureEditor');
      const editor = getStructureEditor();
      await editor.updateIncludePaths(wsRoot, oldPath, newPath);
      await regenerateAndReload(wsRoot);
    })
  );

  // Extract node to file
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.extractToFile', async (treeItem?: CodexTreeItem | IndexNodeTreeItem) => {
      if (!treeItem) return;
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const { getStructureEditor } = await import('../structureEditor');
      const { getSettingsManager } = await import('../settingsManager');
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

      const { getStructureEditor } = await import('../structureEditor');
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

  // Open in file explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.openInFinder', async (treeItem?: IndexNodeTreeItem) => {
      if (!treeItem) return;
      const wsRoot = getWorkspaceRoot();
      if (!wsRoot) return;
      const cp = treeItem.indexNode._computed_path;
      if (!cp) return;
      const fullPath = path.join(wsRoot, cp);
      const { isPathWithinWorkspace } = await import('../writerView/utils/helpers');
      if (!isPathWithinWorkspace(fullPath, wsRoot)) {
        vscode.window.showErrorMessage('Path is outside workspace.');
        return;
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(fullPath));
    })
  );
}
