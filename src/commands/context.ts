import * as vscode from 'vscode';
import * as path from 'path';
import type { CommandDeps } from './types';
import { generateFolderHierarchy, IndexGenerationProgress } from '../indexGenerator';

export function registerContextCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, treeView, outputChannel, multiIndexManager, masterTreeProvider, subIndexProviders, subIndexViews, showTransientMessage } = deps;

  // Set Context Folder command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.setContextFolder', async (uri: vscode.Uri) => {
      if (!uri) {
        vscode.window.showErrorMessage('No folder selected');
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('Could not determine workspace folder for selected path');
        return;
      }

      const workspaceRoot = workspaceFolder.uri.fsPath;
      const folderPath = path.relative(workspaceRoot, uri.fsPath);

      outputChannel.appendLine(`[setContextFolder] Called for folder: ${folderPath}`);
      outputChannel.appendLine(`[setContextFolder] Workspace root: ${workspaceRoot}`);

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Setting context to: ${path.basename(uri.fsPath)}...`,
        cancellable: true,
      }, async (progress, token) => {
        outputChannel.appendLine(`[setContextFolder] Regenerating index hierarchy for: ${folderPath}`);

        const progressReporter: IndexGenerationProgress = {
          report: (message: string, increment?: number) => {
            progress.report({ message, increment });
          },
          token
        };

        try {
          await generateFolderHierarchy(workspaceRoot, folderPath, progressReporter);
        } catch (error: any) {
          if (error.message?.includes('cancelled')) {
            outputChannel.appendLine('[setContextFolder] Cancelled by user');
            vscode.window.showInformationMessage('Index generation cancelled');
            return;
          }
          throw error;
        }

        outputChannel.appendLine(`[setContextFolder] Calling treeProvider.setContextFolder()`);
        progress.report({ message: 'Loading index into tree view...', increment: 5 });

        await treeProvider.setContextFolder(folderPath, workspaceRoot);

        outputChannel.appendLine(`[setContextFolder] Tree view loaded`);

        treeView.title = `📋 ${path.basename(uri.fsPath)}`;

        await context.workspaceState.update('chapterwise.lastContextPath', uri.fsPath);
        await context.workspaceState.update('chapterwise.lastContextType', 'folder');
        outputChannel.appendLine(`[setContextFolder] Context saved to workspace state`);

        if (multiIndexManager && workspaceRoot) {
          const config = vscode.workspace.getConfiguration('chapterwise');
          const displayMode = config.get<string>('indexDisplayMode', 'stacked');

          if (displayMode === 'stacked') {
            outputChannel.appendLine(`[setContextFolder] Discovering indexes for stacked mode...`);
            const indexes = await multiIndexManager.discoverIndexes(workspaceRoot);
            outputChannel.appendLine(`[setContextFolder] Found ${indexes.length} indexes`);

            if (masterTreeProvider) {
              masterTreeProvider.setManager(multiIndexManager, workspaceRoot);
            }

            const subIndexes = multiIndexManager.getSubIndexes();
            subIndexes.forEach((index, i) => {
              if (i < subIndexProviders.length) {
                subIndexProviders[i].setIndex(index);
                subIndexViews[i].title = index.displayName;
              }
            });

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

  // Set Context File command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.setContextFile', async (uri?: vscode.Uri) => {
      if (!uri) {
        vscode.window.showErrorMessage('No file selected');
        return;
      }

      outputChannel.appendLine(`[setContextFile] Called for file: ${uri.fsPath}`);

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('Could not determine workspace folder');
        return;
      }

      try {
        const doc = await vscode.workspace.openTextDocument(uri.fsPath);
        await vscode.window.showTextDocument(doc);

        outputChannel.appendLine(`[setContextFile] Calling treeProvider.setActiveDocument(explicit=true)`);
        treeProvider.setActiveDocument(doc, true);

        treeView.title = `📄 ${path.basename(uri.fsPath, '.codex.yaml')}`;

        await context.workspaceState.update('chapterwise.lastContextPath', uri.fsPath);
        await context.workspaceState.update('chapterwise.lastContextType', 'file');
        outputChannel.appendLine(`[setContextFile] Context saved to workspace state`);

        outputChannel.appendLine(`[setContextFile] Complete - Viewing: ${path.basename(uri.fsPath)}`);
        showTransientMessage(`📄 Viewing: ${path.basename(uri.fsPath)}`, 3000);
      } catch (error) {
        outputChannel.appendLine(`[setContextFile] ERROR: ${error}`);
        vscode.window.showErrorMessage(`Failed to open file: ${error}`);
      }
    })
  );

  // Reset Context command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.resetContext', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      await treeProvider.setContextFolder(null, workspaceRoot);

      treeView.title = 'ChapterWise';

      await context.workspaceState.update('chapterwise.lastContextPath', undefined);
      await context.workspaceState.update('chapterwise.lastContextType', undefined);
      outputChannel.appendLine(`[resetContext] Context cleared from workspace state`);

      treeProvider.refresh();

      vscode.window.showInformationMessage('📋 Reset to workspace root');
    })
  );
}
