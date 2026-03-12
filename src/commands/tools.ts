import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandDeps } from './types';
import { runAutoFixer } from '../autoFixer';
import { runExplodeCodex } from '../explodeCodex';
import { runImplodeCodex } from '../implodeCodex';
import { runUpdateWordCount } from '../wordCount';
import { runGenerateTags } from '../tagGenerator';

export function registerToolsCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const { treeProvider, outputChannel, getWorkspaceRoot, showTransientMessage } = deps;

  // Auto-Fix command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.autoFix', async () => {
      await runAutoFixer(false);
      treeProvider.refresh();
    })
  );

  // Auto-Fix with ID regeneration command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.autoFixRegenIds', async () => {
      await runAutoFixer(true);
      treeProvider.refresh();
    })
  );

  // Explode Codex command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.explodeCodex', async () => {
      await runExplodeCodex();
      treeProvider.refresh();
    })
  );

  // Implode Codex command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.implodeCodex', async () => {
      await runImplodeCodex();
      treeProvider.refresh();
    })
  );

  // Update Word Count command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.updateWordCount', async () => {
      await runUpdateWordCount();
      treeProvider.refresh();
    })
  );

  // Generate Tags command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.generateTags', async () => {
      await runGenerateTags();
      treeProvider.refresh();
    })
  );

  // Autofix Folder command
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
        const { CodexAutoFixer } = await import('../autoFixer');

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
}
