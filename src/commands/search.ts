import * as vscode from 'vscode';
import * as path from 'path';
import type { CommandDeps } from './types';
import { CodexTreeItem } from '../treeProvider';
import {
  SearchIndexManager,
  initializeStatusBar as initializeSearchStatusBar,
  updateStatusBar as updateSearchStatusBar,
  openSearchUI,
  SearchResult
} from '../search';
import { isCodexFile, parseCodex, parseMarkdownAsCodex } from '../codexModel';
import { setSearchIndexManager } from '../extensionState';

export function registerSearchCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, writerViewManager, outputChannel } = deps;

  // Initialize search (non-critical - continue if fails)
  try {
    initializeSearchStatusBar(context);
    outputChannel.appendLine('Search status bar initialized');

    const searchIndexManager = new SearchIndexManager();

    searchIndexManager.onBuildProgress(progress => {
      updateSearchStatusBar('building', progress);
    });

    searchIndexManager.onIndexReady(index => {
      updateSearchStatusBar('ready');
    });

    // Write-back to extensionState so deps.getSearchIndexManager() returns it
    setSearchIndexManager(searchIndexManager);

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
    vscode.commands.registerCommand('chapterwise.search', async () => {
      const searchIndexManager = deps.getSearchIndexManager();
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
            await vscode.commands.executeCommand(
              'chapterwise.navigateToNode',
              { nodeId: result.id, parentFile: result.path }
            );
          } else if (workspaceRoot) {
            const fullPath = path.join(workspaceRoot, result.path);
            const uri = vscode.Uri.file(fullPath);

            try {
              const fileContent = await vscode.workspace.fs.readFile(uri);
              const content = Buffer.from(fileContent).toString('utf-8');
              const codexDoc = isCodexFile(fullPath)
                ? parseCodex(content)
                : parseMarkdownAsCodex(content, fullPath);

              if (codexDoc && codexDoc.rootNode) {
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

  // Rebuild search index command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.rebuildSearchIndex', async () => {
      const searchIndexManager = deps.getSearchIndexManager();
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
}
