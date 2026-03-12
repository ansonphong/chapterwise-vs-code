/**
 * Git Setup Wizard for ChapterWise Codex
 * Interactive wizard that guides users through complete Git setup
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  checkGitInstalled,
  checkGitLFSInstalled,
  isGitRepository,
  runGitCommand,
  appendUniqueLines,
} from '../gitSetup';
import { isPathWithinWorkspace } from '../writerView/utils/helpers';
import { GITIGNORE_TEMPLATE, GITATTRIBUTES_TEMPLATE, getGitIgnoreDescription, getGitAttributesDescription } from './templates';

/**
 * Wizard step result
 */
interface WizardStepResult {
  action: 'continue' | 'cancel' | 'back';
}

/**
 * Wizard state to track progress
 */
interface WizardState {
  workspaceRoot: string;
  hasGit: boolean;
  hasGitLFS: boolean;
  isRepo: boolean;
  stepsCompleted: {
    init: boolean;
    gitignore: boolean;
    lfs: boolean;
    commit: boolean;
  };
}

/**
 * Run the complete Git setup wizard
 */
export async function runGitSetupWizard(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
    return;
  }

  const state: WizardState = {
    workspaceRoot: workspaceFolder.uri.fsPath,
    hasGit: false,
    hasGitLFS: false,
    isRepo: false,
    stepsCompleted: {
      init: false,
      gitignore: false,
      lfs: false,
      commit: false
    }
  };

  // Step 1: Welcome and requirements check
  const welcomeResult = await showWelcomeStep(state);
  if (welcomeResult.action !== 'continue') {
    return;
  }

  // Step 2: Repository initialization
  const initResult = await showInitRepoStep(state);
  if (initResult.action === 'cancel') {
    return;
  }

  // Step 3: Git ignore setup
  const ignoreResult = await showGitIgnoreStep(state);
  if (ignoreResult.action === 'cancel') {
    return;
  }

  // Step 4: Git LFS setup (if available)
  if (state.hasGitLFS) {
    const lfsResult = await showGitLFSStep(state);
    if (lfsResult.action === 'cancel') {
      return;
    }
  }

  // Step 5: Initial commit
  const commitResult = await showInitialCommitStep(state);
  if (commitResult.action === 'cancel') {
    return;
  }

  // Step 6: Show completion summary
  await showCompletionSummary(state);
}

/**
 * Step 1: Welcome and requirements check
 */
async function showWelcomeStep(state: WizardState): Promise<WizardStepResult> {
  // Check requirements
  state.hasGit = await checkGitInstalled();
  state.hasGitLFS = await checkGitLFSInstalled();
  state.isRepo = await isGitRepository(state.workspaceRoot);

  // Build welcome message
  const folderName = path.basename(state.workspaceRoot);
  let message = `🚀 Welcome to the ChapterWise Git Setup Wizard!\n\n`;
  message += `This wizard will help you set up version control for your writing project: "${folderName}"\n\n`;
  message += `What this wizard will do:\n`;
  message += `• Initialize a Git repository (if needed)\n`;
  message += `• Create .gitignore with writing-specific patterns\n`;
  message += `• Setup Git LFS for large files (if installed)\n`;
  message += `• Create an initial commit\n\n`;
  message += `Status Check:\n`;
  message += `${state.hasGit ? '✅' : '❌'} Git ${state.hasGit ? 'installed' : 'NOT installed'}\n`;
  message += `${state.hasGitLFS ? '✅' : '⚠️'} Git LFS ${state.hasGitLFS ? 'installed' : 'not installed (optional)'}\n`;
  message += `${state.isRepo ? '✅' : 'ℹ️'} ${state.isRepo ? 'Git repository exists' : 'New repository will be created'}\n`;

  if (!state.hasGit) {
    const choice = await vscode.window.showErrorMessage(
      message + '\n\n❌ Git is required to continue.',
      'Install Git',
      'Cancel'
    );
    
    if (choice === 'Install Git') {
      vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
    }
    
    return { action: 'cancel' };
  }

  if (!state.hasGitLFS) {
    message += `\n⚠️ Git LFS is recommended for tracking large binary files (images, documents, etc.)\nYou can install it later if needed.`;
  }

  const choice = await vscode.window.showInformationMessage(
    message,
    { modal: true },
    'Continue',
    'Cancel'
  );

  if (choice !== 'Continue') {
    return { action: 'cancel' };
  }

  return { action: 'continue' };
}

/**
 * Step 2: Repository initialization
 */
async function showInitRepoStep(state: WizardState): Promise<WizardStepResult> {
  if (state.isRepo) {
    // Already a repo, skip this step
    vscode.window.showInformationMessage(
      '✅ Git repository already exists. Skipping initialization.'
    );
    state.stepsCompleted.init = true;
    return { action: 'continue' };
  }

  const choice = await vscode.window.showInformationMessage(
    `📂 Initialize Git Repository\n\nCreate a new Git repository in:\n${state.workspaceRoot}\n\nThis will create a .git folder to track your project's history.`,
    { modal: true },
    'Initialize',
    'Skip',
    'Cancel'
  );

  if (choice === 'Cancel') {
    return { action: 'cancel' };
  }

  if (choice === 'Skip') {
    return { action: 'continue' };
  }

  // Initialize repository
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Initializing Git repository...',
    cancellable: false
  }, async () => {
    const result = await runGitCommand(['init'], state.workspaceRoot);

    if (result.success) {
      state.isRepo = true;
      state.stepsCompleted.init = true;
      vscode.window.showInformationMessage(
        '✅ Git repository initialized successfully!'
      );
    } else {
      vscode.window.showErrorMessage(
        'Failed to initialize repository. Check the "ChapterWise Git" output channel for details.'
      );
    }
  });

  return { action: 'continue' };
}

/**
 * Step 3: Git ignore setup
 */
async function showGitIgnoreStep(state: WizardState): Promise<WizardStepResult> {
  const description = getGitIgnoreDescription();
  
  const choice = await vscode.window.showInformationMessage(
    `📝 Create .gitignore File\n\nAdd recommended patterns for writing projects?\n\n${description}\n\nThis will prevent unnecessary files (backups, OS files, cache) from being tracked.`,
    { modal: true },
    'Create',
    'Preview First',
    'Skip',
    'Cancel'
  );

  if (choice === 'Cancel') {
    return { action: 'cancel' };
  }

  if (choice === 'Skip') {
    return { action: 'continue' };
  }

  if (choice === 'Preview First') {
    // Show preview, then ask again
    const doc = await vscode.workspace.openTextDocument({
      content: GITIGNORE_TEMPLATE,
      language: 'gitignore'
    });
    await vscode.window.showTextDocument(doc, { preview: true });
    
    const confirmChoice = await vscode.window.showInformationMessage(
      'Create .gitignore with these patterns?',
      'Create',
      'Skip',
      'Cancel'
    );
    
    if (confirmChoice === 'Cancel') {
      return { action: 'cancel' };
    }
    
    if (confirmChoice === 'Skip') {
      return { action: 'continue' };
    }
  }

  // Create or update .gitignore (merge if it already exists)
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Creating .gitignore...',
    cancellable: false
  }, async () => {
    try {
      const gitignorePath = path.join(state.workspaceRoot, '.gitignore');

      if (!isPathWithinWorkspace(gitignorePath, state.workspaceRoot)) {
        vscode.window.showErrorMessage('Invalid .gitignore path.');
        return;
      }

      let content: string;
      try {
        const existing = await fs.promises.readFile(gitignorePath, 'utf-8');
        content = appendUniqueLines(existing, '\n' + GITIGNORE_TEMPLATE);
      } catch {
        content = GITIGNORE_TEMPLATE;
      }

      await fs.promises.writeFile(gitignorePath, content, 'utf-8');
      state.stepsCompleted.gitignore = true;

      vscode.window.showInformationMessage(
        `✅ .gitignore created with ${description}`
      );
    } catch (error: unknown) {
      vscode.window.showErrorMessage(
        'Failed to create .gitignore. Check the "ChapterWise Git" output channel for details.'
      );
    }
  });

  return { action: 'continue' };
}

/**
 * Step 4: Git LFS setup
 */
async function showGitLFSStep(state: WizardState): Promise<WizardStepResult> {
  const description = getGitAttributesDescription();
  
  const choice = await vscode.window.showInformationMessage(
    `💾 Setup Git LFS (Large File Storage)\n\nEnable efficient storage for large binary files?\n\n${description}\n\nRecommended for projects with images, documents, audio, or video files.`,
    { modal: true },
    'Setup LFS',
    'Preview First',
    'Skip',
    'Cancel'
  );

  if (choice === 'Cancel') {
    return { action: 'cancel' };
  }

  if (choice === 'Skip') {
    return { action: 'continue' };
  }

  if (choice === 'Preview First') {
    const doc = await vscode.workspace.openTextDocument({
      content: GITATTRIBUTES_TEMPLATE,
      language: 'gitattributes'
    });
    await vscode.window.showTextDocument(doc, { preview: true });
    
    const confirmChoice = await vscode.window.showInformationMessage(
      'Setup Git LFS for these file types?',
      'Setup LFS',
      'Skip',
      'Cancel'
    );
    
    if (confirmChoice === 'Cancel') {
      return { action: 'cancel' };
    }
    
    if (confirmChoice === 'Skip') {
      return { action: 'continue' };
    }
  }

  // Setup Git LFS
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Setting up Git LFS...',
    cancellable: false
  }, async (progress) => {
    try {
      // Install LFS hooks
      progress.report({ message: 'Installing Git LFS hooks...', increment: 33 });
      const installResult = await runGitCommand(['lfs', 'install'], state.workspaceRoot);

      if (!installResult.success) {
        throw new Error(installResult.error || 'Failed to install Git LFS');
      }

      // Create or update .gitattributes (merge if it already exists)
      progress.report({ message: 'Configuring file tracking...', increment: 34 });
      const gitattributesPath = path.join(state.workspaceRoot, '.gitattributes');

      if (!isPathWithinWorkspace(gitattributesPath, state.workspaceRoot)) {
        vscode.window.showErrorMessage('Invalid .gitattributes path.');
        return;
      }

      let content: string;
      try {
        const existing = await fs.promises.readFile(gitattributesPath, 'utf-8');
        content = appendUniqueLines(existing, '\n' + GITATTRIBUTES_TEMPLATE);
      } catch {
        content = GITATTRIBUTES_TEMPLATE;
      }

      await fs.promises.writeFile(gitattributesPath, content, 'utf-8');
      state.stepsCompleted.lfs = true;

      progress.report({ message: 'Complete!', increment: 33 });

      vscode.window.showInformationMessage(
        `✅ Git LFS setup complete! Now tracking ${description}`
      );
    } catch (error: unknown) {
      vscode.window.showErrorMessage(
        'Failed to setup Git LFS. Check the "ChapterWise Git" output channel for details.'
      );
    }
  });

  return { action: 'continue' };
}

/**
 * Step 5: Initial commit
 */
async function showInitialCommitStep(state: WizardState): Promise<WizardStepResult> {
  if (!state.isRepo) {
    // Can't commit without a repo
    return { action: 'continue' };
  }

  const choice = await vscode.window.showInformationMessage(
    `📦 Create Initial Commit\n\nCreate an initial commit with your project files?\n\nThis will save the current state of your project to Git history.\n\nNote: Files will be committed locally only. You can push to GitHub/GitLab later.`,
    { modal: true },
    'Create Commit',
    'Skip',
    'Cancel'
  );

  if (choice === 'Cancel') {
    return { action: 'cancel' };
  }

  if (choice === 'Skip') {
    return { action: 'continue' };
  }

  // Create initial commit
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Creating initial commit...',
    cancellable: false
  }, async (progress) => {
    try {
      // Stage all files
      progress.report({ message: 'Staging files...', increment: 50 });
      const addResult = await runGitCommand(['add', '.'], state.workspaceRoot);

      if (!addResult.success) {
        throw new Error(addResult.error || 'Failed to stage files');
      }

      // Create commit
      progress.report({ message: 'Creating commit...', increment: 50 });
      const commitResult = await runGitCommand(
        ['commit', '-m', 'Initial commit - ChapterWise project setup'],
        state.workspaceRoot
      );

      if (!commitResult.success) {
        // Check if there's nothing to commit
        if (commitResult.error?.includes('nothing to commit')) {
          vscode.window.showInformationMessage('No changes to commit.');
          return;
        }
        throw new Error(commitResult.error || 'Failed to create commit');
      }

      state.stepsCompleted.commit = true;

      vscode.window.showInformationMessage(
        '✅ Initial commit created successfully!'
      );

    } catch (error: unknown) {
      vscode.window.showErrorMessage(
        'Failed to create commit. Check the "ChapterWise Git" output channel for details.'
      );
    }
  });

  return { action: 'continue' };
}

/**
 * Step 6: Show completion summary
 */
async function showCompletionSummary(state: WizardState): Promise<void> {
  const completedSteps: string[] = [];
  
  if (state.stepsCompleted.init) {
    completedSteps.push('✓ Git repository initialized');
  }
  if (state.stepsCompleted.gitignore) {
    completedSteps.push('✓ .gitignore created');
  }
  if (state.stepsCompleted.lfs) {
    completedSteps.push('✓ Git LFS enabled');
  }
  if (state.stepsCompleted.commit) {
    completedSteps.push('✓ Initial commit created');
  }

  const summary = `✅ Git Setup Complete!\n\n` +
    `Your writing project is now version-controlled:\n` +
    completedSteps.join('\n') + '\n\n' +
    `Next steps:\n` +
    `• Start working on your codex files\n` +
    `• Commits will be saved locally\n` +
    `• When ready, add a remote: git remote add origin <url>\n` +
    `• Push to GitHub/GitLab: git push -u origin main`;

  const choice = await vscode.window.showInformationMessage(
    summary,
    { modal: true },
    'Done',
    'Learn More About Git'
  );

  if (choice === 'Learn More About Git') {
    vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/doc'));
  }
}

