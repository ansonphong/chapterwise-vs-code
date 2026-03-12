/**
 * Git Setup Utilities for ChapterWise Codex
 * Provides Git initialization, .gitignore management, and Git LFS setup
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GITIGNORE_TEMPLATE, GITATTRIBUTES_TEMPLATE, getGitIgnoreDescription, getGitAttributesDescription } from './gitSetup/templates';
import { isPathWithinWorkspace } from './writerView/utils/helpers';

const execFileAsync = promisify(execFile);

const GIT_COMMAND_TIMEOUT = 30_000;

const outputChannel = vscode.window.createOutputChannel('ChapterWise Git');

/**
 * Shell metacharacters that must not appear in git arguments
 */
const SHELL_METACHAR_RE = /[;|&$`()<>{}!\n\r]/;

/**
 * Sanitize an error into a safe, user-facing message.
 * Full details are logged to the output channel.
 */
function sanitizeGitError(error: unknown, context: string): string {
  const message = error instanceof Error ? error.message : String(error);
  outputChannel.appendLine(`[${new Date().toISOString()}] ${context}: ${message}`);
  return `${context}. Check the "ChapterWise Git" output channel for details.`;
}

/**
 * Result of a Git command execution
 */
export interface GitCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Check if Git is installed and available in PATH
 */
export async function checkGitInstalled(): Promise<boolean> {
  try {
    const result = await runGitCommand(['--version'], process.cwd());
    return result.success && result.output.includes('git version');
  } catch (error) {
    return false;
  }
}

/**
 * Check if Git LFS is installed and available
 */
export async function checkGitLFSInstalled(): Promise<boolean> {
  try {
    const result = await runGitCommand(['lfs', 'version'], process.cwd());
    return result.success && result.output.toLowerCase().includes('git-lfs');
  } catch (error) {
    return false;
  }
}

/**
 * Run a Git command in the specified directory.
 * Uses execFile (no shell) with argument array to prevent command injection.
 */
export async function runGitCommand(args: string[], cwd: string): Promise<GitCommandResult> {
  // Validate cwd against workspace boundary when a workspace is open
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot && !isPathWithinWorkspace(cwd, workspaceRoot)) {
    const sanitized = sanitizeGitError(
      new Error(`cwd "${cwd}" is outside workspace "${workspaceRoot}"`),
      'Git command rejected — working directory outside workspace'
    );
    return { success: false, output: '', error: sanitized };
  }

  // Validate each argument against shell metacharacters (defense-in-depth)
  for (const arg of args) {
    if (SHELL_METACHAR_RE.test(arg)) {
      const sanitized = sanitizeGitError(
        new Error(`Rejected argument containing shell metacharacter: ${arg}`),
        'Git command validation failed'
      );
      return { success: false, output: '', error: sanitized };
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT,
    });
    return {
      success: true,
      output: stdout.trim(),
      error: stderr.trim() || undefined
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    outputChannel.appendLine(`[${new Date().toISOString()}] git ${args.join(' ')} failed: ${message}`);
    return {
      success: false,
      output: '',
      error: message
    };
  }
}

/**
 * Check if a directory is already a Git repository
 */
export async function isGitRepository(workspaceRoot: string): Promise<boolean> {
  const gitDir = path.join(workspaceRoot, '.git');
  try {
    await fs.promises.access(gitDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize a new Git repository
 */
export async function initializeGitRepository(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;

  // Check if Git is installed
  if (!await checkGitInstalled()) {
    const choice = await vscode.window.showErrorMessage(
      'Git is not installed or not found in PATH.',
      'Learn How to Install',
      'Cancel'
    );
    if (choice === 'Learn How to Install') {
      vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
    }
    return;
  }

  // Check if already a Git repo
  if (await isGitRepository(workspaceRoot)) {
    await vscode.window.showInformationMessage(
      'This folder is already a Git repository.',
      'OK'
    );
    return;
  }

  // Confirm initialization
  const confirm = await vscode.window.showInformationMessage(
    `Initialize Git repository in:\n${workspaceRoot}`,
    'Initialize',
    'Cancel'
  );

  if (confirm !== 'Initialize') {
    return;
  }

  // Initialize the repository
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Initializing Git repository...',
    cancellable: false
  }, async () => {
    const result = await runGitCommand(['init'], workspaceRoot);

    if (result.success) {
      vscode.window.showInformationMessage(
        `✅ Git repository initialized successfully in ${path.basename(workspaceRoot)}`
      );
    } else {
      vscode.window.showErrorMessage(
        sanitizeGitError(result.error, 'Failed to initialize Git repository')
      );
    }
  });
}

/**
 * Read file content or return empty string if file doesn't exist
 */
async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Parse lines into sections: each section is a group of comment/blank header
 * lines followed by pattern lines, ending at the next comment or EOF.
 */
function parseSections(lines: string[]): Array<{ headers: string[]; patterns: string[] }> {
  const sections: Array<{ headers: string[]; patterns: string[] }> = [];
  let currentHeaders: string[] = [];
  let currentPatterns: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      // If we have accumulated patterns, flush the current section
      if (currentPatterns.length > 0) {
        sections.push({ headers: currentHeaders, patterns: currentPatterns });
        currentHeaders = [];
        currentPatterns = [];
      }
      currentHeaders.push(line);
    } else {
      currentPatterns.push(line);
    }
  }

  // Flush final section
  if (currentHeaders.length > 0 || currentPatterns.length > 0) {
    sections.push({ headers: currentHeaders, patterns: currentPatterns });
  }

  return sections;
}

/**
 * Append unique lines to content (only add if they don't already exist).
 * Processes template in section chunks so comment headers are only added
 * when at least one pattern from the section is new.
 */
export function appendUniqueLines(existingContent: string, newLines: string): string {
  const existingLines = existingContent.split('\n');
  const existingSet = new Set(existingLines.map(l => l.trim()));

  const sections = parseSections(newLines.split('\n'));
  const result = [...existingLines];

  for (const section of sections) {
    // Determine which patterns are actually new
    const newPatterns = section.patterns.filter(p => !existingSet.has(p.trim()));

    if (newPatterns.length > 0) {
      // Add headers + only the new patterns
      result.push(...section.headers);
      result.push(...newPatterns);
    }
    // If no new patterns, skip the entire section (headers + patterns)
  }

  return result.join('\n');
}

/**
 * Create or update .gitignore file with writing-specific patterns
 */
export async function ensureGitIgnore(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const gitignorePath = path.join(workspaceRoot, '.gitignore');

  if (!isPathWithinWorkspace(gitignorePath, workspaceRoot)) {
    vscode.window.showErrorMessage('Invalid .gitignore path.');
    return;
  }

  let exists: boolean;
  try {
    await fs.promises.access(gitignorePath);
    exists = true;
  } catch {
    exists = false;
  }

  // Show preview of what will be added
  const action = exists ? 'update' : 'create';
  const description = getGitIgnoreDescription();

  const confirm = await vscode.window.showInformationMessage(
    exists
      ? `Update .gitignore with writing project patterns?\n\n${description}\n\nExisting patterns will be preserved.`
      : `Create .gitignore for your writing project?\n\n${description}`,
    'Show Preview',
    action === 'create' ? 'Create' : 'Update',
    'Cancel'
  );

  if (confirm === 'Cancel' || !confirm) {
    return;
  }

  if (confirm === 'Show Preview') {
    // Show preview in a new document
    const doc = await vscode.workspace.openTextDocument({
      content: GITIGNORE_TEMPLATE,
      language: 'gitignore'
    });
    await vscode.window.showTextDocument(doc, { preview: true });

    // Ask again after preview
    const confirmAfterPreview = await vscode.window.showInformationMessage(
      `${action === 'create' ? 'Create' : 'Update'} .gitignore with these patterns?`,
      action === 'create' ? 'Create' : 'Update',
      'Cancel'
    );

    if (confirmAfterPreview !== (action === 'create' ? 'Create' : 'Update')) {
      return;
    }
  }

  // Create or update the file
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `${action === 'create' ? 'Creating' : 'Updating'} .gitignore...`,
    cancellable: false
  }, async () => {
    try {
      let content: string;

      if (exists) {
        // Update existing file — merge, preserving existing patterns
        const existingContent = await readFileOrEmpty(gitignorePath);
        content = appendUniqueLines(existingContent, '\n' + GITIGNORE_TEMPLATE);
      } else {
        // Create new file
        content = GITIGNORE_TEMPLATE;
      }

      await fs.promises.writeFile(gitignorePath, content, 'utf-8');

      vscode.window.showInformationMessage(
        `✅ .gitignore ${action === 'create' ? 'created' : 'updated'} successfully with ${description}`
      );

      // Open the file
      const doc = await vscode.workspace.openTextDocument(gitignorePath);
      await vscode.window.showTextDocument(doc);

    } catch (error: unknown) {
      vscode.window.showErrorMessage(
        sanitizeGitError(error, `Failed to ${action} .gitignore`)
      );
    }
  });
}

/**
 * Setup Git LFS and create/update .gitattributes
 */
export async function setupGitLFS(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;

  // Check if Git LFS is installed
  if (!await checkGitLFSInstalled()) {
    const choice = await vscode.window.showErrorMessage(
      'Git LFS is not installed. Git LFS is required to track large binary files.',
      'Learn How to Install',
      'Cancel'
    );
    if (choice === 'Learn How to Install') {
      vscode.env.openExternal(vscode.Uri.parse('https://git-lfs.github.com/'));
    }
    return;
  }

  const gitattributesPath = path.join(workspaceRoot, '.gitattributes');

  if (!isPathWithinWorkspace(gitattributesPath, workspaceRoot)) {
    vscode.window.showErrorMessage('Invalid .gitattributes path.');
    return;
  }

  let exists: boolean;
  try {
    await fs.promises.access(gitattributesPath);
    exists = true;
  } catch {
    exists = false;
  }

  // Show what LFS will track
  const description = getGitAttributesDescription();

  const confirm = await vscode.window.showInformationMessage(
    exists
      ? `Setup Git LFS for large files?\n\n${description}\n\nExisting attributes will be preserved.`
      : `Setup Git LFS to track large binary files?\n\n${description}\n\nThis will enable efficient storage for images, documents, audio, and video.`,
    'Show Preview',
    'Setup LFS',
    'Cancel'
  );

  if (confirm === 'Cancel' || !confirm) {
    return;
  }

  if (confirm === 'Show Preview') {
    // Show preview
    const doc = await vscode.workspace.openTextDocument({
      content: GITATTRIBUTES_TEMPLATE,
      language: 'gitattributes'
    });
    await vscode.window.showTextDocument(doc, { preview: true });

    // Ask again
    const confirmAfterPreview = await vscode.window.showInformationMessage(
      'Setup Git LFS with these file types?',
      'Setup LFS',
      'Cancel'
    );

    if (confirmAfterPreview !== 'Setup LFS') {
      return;
    }
  }

  // Setup Git LFS
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Setting up Git LFS...',
    cancellable: false
  }, async (progress) => {
    try {
      // Install Git LFS for the user
      progress.report({ message: 'Installing Git LFS hooks...', increment: 25 });
      const installResult = await runGitCommand(['lfs', 'install'], workspaceRoot);

      if (!installResult.success) {
        throw new Error(installResult.error || 'Failed to install Git LFS');
      }

      // Create or update .gitattributes
      progress.report({ message: 'Configuring file tracking...', increment: 50 });

      let content: string;
      if (exists) {
        const existingContent = await readFileOrEmpty(gitattributesPath);
        content = appendUniqueLines(existingContent, '\n' + GITATTRIBUTES_TEMPLATE);
      } else {
        content = GITATTRIBUTES_TEMPLATE;
      }

      await fs.promises.writeFile(gitattributesPath, content, 'utf-8');

      progress.report({ message: 'Complete!', increment: 25 });

      vscode.window.showInformationMessage(
        `✅ Git LFS setup complete!\n\nNow tracking ${description}`
      );

      // Open the file
      const doc = await vscode.workspace.openTextDocument(gitattributesPath);
      await vscode.window.showTextDocument(doc);

    } catch (error: unknown) {
      vscode.window.showErrorMessage(
        sanitizeGitError(error, 'Failed to setup Git LFS')
      );
    }
  });
}

/**
 * Create initial commit with .gitignore and .gitattributes
 */
export async function createInitialCommit(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found.');
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;

  if (!await isGitRepository(workspaceRoot)) {
    vscode.window.showErrorMessage('Not a Git repository. Initialize Git first.');
    return;
  }

  const confirm = await vscode.window.showInformationMessage(
    'Create initial commit with your project files?',
    'Create Commit',
    'Cancel'
  );

  if (confirm !== 'Create Commit') {
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Creating initial commit...',
    cancellable: false
  }, async (progress) => {
    try {
      // Stage all files
      progress.report({ message: 'Staging files...', increment: 33 });
      const addResult = await runGitCommand(['add', '.'], workspaceRoot);

      if (!addResult.success) {
        throw new Error(addResult.error || 'Failed to stage files');
      }

      // Create commit
      progress.report({ message: 'Creating commit...', increment: 34 });
      const commitResult = await runGitCommand(
        ['commit', '-m', 'Initial commit - ChapterWise project setup'],
        workspaceRoot
      );

      if (!commitResult.success) {
        // Check if there's nothing to commit
        if (commitResult.error?.includes('nothing to commit')) {
          vscode.window.showInformationMessage('No changes to commit.');
          return;
        }
        throw new Error(commitResult.error || 'Failed to create commit');
      }

      progress.report({ message: 'Complete!', increment: 33 });

      vscode.window.showInformationMessage(
        '✅ Initial commit created successfully!\n\nYour project is now version-controlled.'
      );

    } catch (error: unknown) {
      vscode.window.showErrorMessage(
        sanitizeGitError(error, 'Failed to create commit')
      );
    }
  });
}

/**
 * Dispose of any resources
 */
export function disposeGitSetup(): void {
  outputChannel.dispose();
}

