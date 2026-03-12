import * as vscode from 'vscode';
import * as path from 'path';
import type { CommandDeps } from './types';
import { IndexNodeTreeItem } from '../treeProvider';
import { runGenerateIndex, runRegenerateIndex } from '../indexGenerator';
import { runCreateIndexFile } from '../indexBoilerplate';

export function registerIndexCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  // Generate Index command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.generateIndex', async () => {
      await runGenerateIndex();
    })
  );

  // Regenerate Index command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.regenerateIndex', async () => {
      await runRegenerateIndex();
    })
  );

  // Create Index File command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.createIndexFile', async () => {
      await runCreateIndexFile();
    })
  );

  // Open Index File command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'chapterwise.openIndexFile',
      async (treeItem?: IndexNodeTreeItem) => {
        if (!treeItem) {
          return;
        }

        const filePath = treeItem.getFilePath();

        try {
          const uri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to open file: ${path.basename(filePath)}`
          );
          console.error('Failed to open index file:', error);
        }
      }
    )
  );
}
