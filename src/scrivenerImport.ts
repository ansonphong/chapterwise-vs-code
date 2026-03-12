/**
 * Scrivener Import - VS Code Integration
 *
 * Thin TypeScript wrapper that calls shared Python scripts.
 * Provides VS Code UI (QuickPick, Progress) around Python core.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

// Configuration
const SCRIPTS_DIR = 'scripts/scrivener';
const MAIN_SCRIPT = 'scrivener_import.py';

/**
 * Import options from user
 */
export interface ScrivenerImportOptions {
  scrivPath: string;
  outputDir: string;
  format: 'markdown' | 'yaml' | 'json';
  generateIndex: boolean;
  indexDepth: number; // V2: 0=single, 1=per-book, 2=per-act
}

/**
 * Progress update from Python script
 */
interface ProgressUpdate {
  type: 'progress' | 'result' | 'error' | 'preview';
  message?: string;
  current?: number;
  total?: number;
  percent?: number;
  success?: boolean;
  filesGenerated?: number;
  outputDir?: string;
}

/**
 * Python command candidates in order of preference
 * - python3: Standard on macOS/Linux
 * - python: May be Python 3 on some systems
 * - py: Windows Python launcher
 */
const PYTHON_COMMANDS = ['python3', 'python', 'py'];

/** Cached Python command after successful detection */
let cachedPythonCommand: string | null = null;

/**
 * Try to run a Python command and check if it's Python 3
 */
async function tryPythonCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
    const python = spawn(cmd, args);
    let output = '';

    python.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    python.on('close', (code) => {
      // Check if it's Python 3.x
      const isPython3 = code === 0 && output.includes('Python 3');
      resolve(isPython3);
    });

    python.on('error', () => resolve(false));
  });
}

/**
 * Find a working Python 3 command
 * Returns the command string or null if not found
 */
async function findPythonCommand(): Promise<string | null> {
  // Return cached command if available
  if (cachedPythonCommand) {
    return cachedPythonCommand;
  }

  for (const cmd of PYTHON_COMMANDS) {
    if (await tryPythonCommand(cmd)) {
      cachedPythonCommand = cmd;
      return cmd;
    }
  }

  return null;
}

/**
 * Get the Python executable arguments
 * For 'py' launcher, we need to add '-3' flag
 */
function getPythonArgs(pythonCmd: string, scriptArgs: string[]): string[] {
  if (pythonCmd === 'py') {
    return ['-3', ...scriptArgs];
  }
  return scriptArgs;
}

/**
 * Check if Python 3 is available
 */
async function checkPython(): Promise<boolean> {
  const pythonCmd = await findPythonCommand();
  return pythonCmd !== null;
}

/**
 * Check if required Python packages are installed
 */
async function checkDependencies(): Promise<{ installed: boolean; missing: string[] }> {
  const pythonCmd = await findPythonCommand();
  if (!pythonCmd) {
    return { installed: false, missing: ['pyyaml', 'striprtf'] };
  }

  return new Promise((resolve) => {
    const args = getPythonArgs(pythonCmd, ['-c', 'import yaml; import striprtf']);
    const python = spawn(pythonCmd, args);
    python.on('close', (code) => {
      if (code === 0) {
        resolve({ installed: true, missing: [] });
      } else {
        resolve({ installed: false, missing: ['pyyaml', 'striprtf'] });
      }
    });
    python.on('error', () => resolve({ installed: false, missing: ['pyyaml', 'striprtf'] }));
  });
}

/**
 * Validate Scrivener project folder
 */
function validateScrivenerProject(scrivPath: string): boolean {
  if (!fs.existsSync(scrivPath) || !fs.statSync(scrivPath).isDirectory()) {
    return false;
  }

  // Check for .scrivx file
  const files = fs.readdirSync(scrivPath);
  const hasScrivx = files.some(f => f.toLowerCase().endsWith('.scrivx'));

  if (!hasScrivx) {
    return false;
  }

  // Check for Files/Data directory
  const dataDir = path.join(scrivPath, 'Files', 'Data');
  return fs.existsSync(dataDir);
}

/**
 * Show folder picker for Scrivener project
 */
async function selectScrivenerProject(): Promise<string | undefined> {
  const result = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    title: 'Select Scrivener Project (.scriv)',
    filters: { 'Scrivener Projects': ['scriv'] }
  });

  if (!result || result.length === 0) {
    return undefined;
  }

  const scrivPath = result[0].fsPath;

  if (!validateScrivenerProject(scrivPath)) {
    vscode.window.showErrorMessage(
      'Selected folder is not a valid Scrivener project. Missing .scrivx file or Files/Data directory.'
    );
    return undefined;
  }

  return scrivPath;
}

/**
 * Get import options from user
 */
async function getImportOptions(scrivPath: string): Promise<ScrivenerImportOptions | undefined> {
  const projectName = path.basename(scrivPath, '.scriv');

  // Format selection
  const formatChoice = await vscode.window.showQuickPick([
    { label: '$(markdown) Codex Lite (Markdown)', description: 'Recommended', detail: 'Human-readable, Git-friendly', value: 'markdown' as const },
    { label: '$(symbol-file) Codex YAML', description: 'Full format', detail: 'Hierarchical structure', value: 'yaml' as const },
    { label: '$(json) Codex JSON', description: 'Machine-readable', detail: 'API-friendly', value: 'json' as const }
  ], {
    title: 'Output Format',
    placeHolder: 'How should Scrivener content be saved?'
  });

  if (!formatChoice) { return undefined; }

  // V2: Index structure selection
  const depthChoice = await vscode.window.showQuickPick([
    { label: '$(file-code) Single index', description: 'One index.codex.yaml at root', detail: 'All hierarchy in one file', value: 0 },
    { label: '$(folder-library) Per book (Recommended)', description: 'Index per major section', detail: 'Best for multi-book projects', value: 1 },
    { label: '$(folder-opened) Per act', description: 'Index for each act/part', detail: 'Fine-grained control', value: 2 }
  ], {
    title: 'Index Structure',
    placeHolder: 'How should the hierarchy be organized?'
  });

  if (depthChoice === undefined) { return undefined; }

  // Output location
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let outputDir: string;

  if (workspaceFolders && workspaceFolders.length > 0) {
    const locationChoice = await vscode.window.showQuickPick([
      { label: '$(folder) Current Workspace', description: `Create ${projectName}/ here`, value: 'workspace' },
      { label: '$(folder-opened) Choose Location', description: 'Select custom folder', value: 'custom' }
    ], {
      title: 'Output Location'
    });

    if (!locationChoice) { return undefined; }

    if (locationChoice.value === 'workspace') {
      outputDir = path.join(workspaceFolders[0].uri.fsPath, projectName);
    } else {
      const customResult = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        title: 'Select Output Folder'
      });
      if (!customResult || customResult.length === 0) { return undefined; }
      outputDir = path.join(customResult[0].fsPath, projectName);
    }
  } else {
    const customResult = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Select Output Folder'
    });
    if (!customResult || customResult.length === 0) { return undefined; }
    outputDir = path.join(customResult[0].fsPath, projectName);
  }

  // Index generation
  const indexChoice = await vscode.window.showQuickPick([
    { label: '$(check) Yes, generate index', description: 'Recommended', detail: 'Creates index.codex.yaml for navigation', value: true },
    { label: '$(x) No, just import files', description: 'Skip index', detail: 'Generate later with /index command', value: false }
  ], {
    title: 'Generate Index?'
  });

  if (indexChoice === undefined) { return undefined; }

  return {
    scrivPath,
    outputDir,
    format: formatChoice.value,
    generateIndex: indexChoice.value,
    indexDepth: depthChoice.value
  };
}

/**
 * Run the Python import script with progress
 */
async function runImport(
  context: vscode.ExtensionContext,
  options: ScrivenerImportOptions,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<ProgressUpdate> {
  const pythonCmd = await findPythonCommand();
  if (!pythonCmd) {
    throw new Error('Python 3 not found');
  }

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(context.extensionPath, SCRIPTS_DIR, MAIN_SCRIPT);

    const scriptArgs = [
      scriptPath,
      options.scrivPath,
      '--format', options.format,
      '--output', options.outputDir,
      '--index-depth', String(options.indexDepth),
      '--json',
      '--verbose'
    ];

    if (!options.generateIndex) {
      scriptArgs.push('--no-index');
    }

    // V2: Use nested structure by default (unless index depth is 0 with flat flag)
    if (options.indexDepth === 0) {
      scriptArgs.push('--flat');
    }

    const args = getPythonArgs(pythonCmd, scriptArgs);
    const python = spawn(pythonCmd, args);

    let lastResult: ProgressUpdate | null = null;
    let lastPercent = 0;

    python.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const update: ProgressUpdate = JSON.parse(line);

          if (update.type === 'progress') {
            const increment = update.percent ? update.percent - lastPercent : undefined;
            lastPercent = update.percent || lastPercent;
            progress.report({
              message: update.message,
              increment: increment
            });
          } else if (update.type === 'result' || update.type === 'error') {
            lastResult = update;
          }
        } catch {
          // Non-JSON output, ignore
        }
      }
    });

    python.stderr.on('data', (data: Buffer) => {
      console.error(`Scrivener import stderr: ${data}`);
    });

    python.on('close', (code) => {
      if (code === 0 && lastResult) {
        resolve(lastResult);
      } else if (lastResult?.type === 'error') {
        reject(new Error(lastResult.message || 'Import failed'));
      } else {
        reject(new Error(`Import failed with exit code ${code}`));
      }
    });

    python.on('error', (err) => {
      reject(new Error(`Failed to start Python: ${err.message}`));
    });

    // Handle cancellation
    token.onCancellationRequested(() => {
      python.kill();
      reject(new Error('Import cancelled'));
    });
  });
}

/**
 * Main import command
 */
export async function runScrivenerImport(context: vscode.ExtensionContext): Promise<void> {
  // Check Python availability
  const hasPython = await checkPython();
  if (!hasPython) {
    const action = await vscode.window.showErrorMessage(
      'Python 3 is required for Scrivener import.',
      'Download Python'
    );
    if (action === 'Download Python') {
      vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
    }
    return;
  }

  // Check dependencies
  const deps = await checkDependencies();
  if (!deps.installed) {
    const action = await vscode.window.showWarningMessage(
      `Missing Python packages: ${deps.missing.join(', ')}`,
      'Install Now',
      'Continue Anyway'
    );
    if (action === 'Install Now') {
      const terminal = vscode.window.createTerminal('Install Dependencies');
      terminal.sendText(`pip3 install ${deps.missing.join(' ')}`);
      terminal.show();
      return;
    } else if (!action) {
      return;
    }
    // Continue anyway if user chose that option
  }

  // Select Scrivener project
  const scrivPath = await selectScrivenerProject();
  if (!scrivPath) { return; }

  // Get options
  const options = await getImportOptions(scrivPath);
  if (!options) { return; }

  // Run import with progress
  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Importing Scrivener Project',
      cancellable: true
    }, async (progress, token) => {
      return await runImport(context, options, progress, token);
    });

    if (result.success) {
      const action = await vscode.window.showInformationMessage(
        `Imported ${result.filesGenerated} files to ${result.outputDir}`,
        'Open Folder',
        'Open Index'
      );

      if (action === 'Open Folder') {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.outputDir!));
      } else if (action === 'Open Index') {
        const indexPath = path.join(result.outputDir!, 'index.codex.yaml');
        if (fs.existsSync(indexPath)) {
          const doc = await vscode.workspace.openTextDocument(indexPath);
          await vscode.window.showTextDocument(doc);
        }
      }
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Scrivener import failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Register command
 */
export function registerScrivenerImport(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'chapterwiseCodex.importScrivener',
    () => runScrivenerImport(context)
  );
  context.subscriptions.push(command);
}

/**
 * Dispose
 */
export function disposeScrivenerImport(): void {
  // Cleanup if needed
}
