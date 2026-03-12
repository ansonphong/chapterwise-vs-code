import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandDeps } from './types';
import { isCodexFile } from '../codexModel';

export function registerNavigatorCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, getSearchIndexManager } = deps;

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

  // Switch to INDEX mode command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.switchToIndexMode', async () => {
      treeProvider.setNavigationMode('index');

      await vscode.commands.executeCommand('setContext', 'codexNavigatorMode', 'index');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
      if (workspaceRoot) {
        const indexPath = path.join(workspaceRoot.uri.fsPath, '.index.codex.json');
        if (fs.existsSync(indexPath)) {
          const doc = await vscode.workspace.openTextDocument(indexPath);
          treeProvider.setActiveDocument(doc, true);

          const searchManager = getSearchIndexManager();
          if (searchManager) {
            searchManager.initializeForContext('.', workspaceRoot.uri.fsPath);
          }
        }
      }
    })
  );
}
