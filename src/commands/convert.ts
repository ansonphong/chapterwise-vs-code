import * as vscode from 'vscode';
import type { CommandDeps } from './types';
import { runConvertToMarkdown, runConvertToCodex } from '../convertFormat';

export function registerConvertCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  // Convert to Markdown command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.convertToMarkdown', async () => {
      await runConvertToMarkdown();
    })
  );

  // Convert Markdown to Codex command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.convertToCodex', async () => {
      await runConvertToCodex();
    })
  );
}
