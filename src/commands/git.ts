import * as vscode from 'vscode';
import type { CommandDeps } from './types';
import { initializeGitRepository, ensureGitIgnore, setupGitLFS } from '../gitSetup';
import { runGitSetupWizard } from '../gitSetup/wizard';

export function registerGitCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  // Git Setup Wizard command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.git.setupWizard', async () => {
      await runGitSetupWizard();
    })
  );

  // Initialize Git Repository command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.git.initRepository', async () => {
      await initializeGitRepository();
    })
  );

  // Ensure Git Ignore command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.git.ensureGitIgnore', async () => {
      await ensureGitIgnore();
    })
  );

  // Setup Git LFS command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwise.git.setupLFS', async () => {
      await setupGitLFS();
    })
  );
}
