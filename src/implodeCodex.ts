/**
 * Implode Codex - Merge Included Files Back Into Parent
 *
 * Resolves include directives in a codex file, reading the referenced files
 * and merging their content back into the parent document. This is the
 * inverse of the Explode operation.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { isCodexFile } from './codexModel';

/**
 * Options for implode operation
 */
export interface ImplodeOptions {
  dryRun: boolean;              // Preview without making changes
  deleteSourceFiles: boolean;   // Remove included files after merge
  backup: boolean;              // Backup parent before modifying
  recursive: boolean;           // Resolve nested includes
  deleteEmptyFolders: boolean;  // Delete folders that become empty after deleting source files
}

/**
 * Result of implode operation
 */
export interface ImplodeResult {
  success: boolean;
  mergedCount: number;          // Number of includes resolved
  mergedFiles: string[];        // List of files that were merged
  deletedFiles: string[];       // List of files deleted (if deleteSourceFiles)
  deletedFolders: string[];     // List of folders deleted (if deleteEmptyFolders)
  errors: string[];
}

/**
 * Codex Imploder - Merge included files back into parent
 */
export class CodexImploder {
  private mergedFiles: string[] = [];
  private deletedFiles: string[] = [];
  private deletedFolders: string[] = [];
  private errors: string[] = [];
  /** Tracks files currently being processed to detect circular includes */
  private visitedPaths: Set<string> = new Set();

  /**
   * Implode a codex file - resolve includes and merge content
   */
  async implode(
    documentUri: vscode.Uri,
    options: ImplodeOptions
  ): Promise<ImplodeResult> {
    // Reset state
    this.mergedFiles = [];
    this.deletedFiles = [];
    this.deletedFolders = [];
    this.errors = [];
    this.visitedPaths = new Set();

    try {
      // Read input file
      const inputPath = documentUri.fsPath;
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
      }

      // === SECURITY: Reject symlinks to prevent path escape attacks ===
      if (fs.lstatSync(inputPath).isSymbolicLink()) {
        throw new Error(`Symlinks not allowed: ${inputPath}`);
      }

      const fileContent = fs.readFileSync(inputPath, 'utf-8');
      const isJson = inputPath.toLowerCase().endsWith('.json');

      let codexData: Record<string, unknown>;
      if (isJson) {
        codexData = JSON.parse(fileContent);
      } else {
        codexData = YAML.parse(fileContent) as Record<string, unknown>;
      }

      // Validate structure
      if (!codexData || typeof codexData !== 'object') {
        throw new Error('Invalid codex file structure');
      }

      // Check for children
      if (!('children' in codexData) || !Array.isArray(codexData.children)) {
        throw new Error("No 'children' array found in codex file");
      }

      const parentDir = path.dirname(inputPath);

      // Debug: log include count
      const includeCount = this.countIncludes(codexData.children as Record<string, unknown>[]);
      console.log(`[Implode] Found ${includeCount} include directives in codex file`);

      if (includeCount === 0) {
        return {
          success: true,
          mergedCount: 0,
          mergedFiles: [],
          deletedFiles: [],
          deletedFolders: [],
          errors: ['No include directives found - nothing to merge']
        };
      }

      // Resolve all includes
      const resolvedChildren = await this.resolveIncludes(
        codexData.children as Record<string, unknown>[],
        parentDir,
        options
      );

      if (options.dryRun) {
        // In dry run, just report what would happen
        return {
          success: true,
          mergedCount: this.mergedFiles.length,
          mergedFiles: this.mergedFiles,
          deletedFiles: options.deleteSourceFiles ? [...this.mergedFiles] : [],
          deletedFolders: [],
          errors: this.errors
        };
      }

      // Update the parent file
      codexData.children = resolvedChildren;

      // Update metadata
      if (!codexData.metadata) {
        codexData.metadata = {};
      }
      const metadata = codexData.metadata as Record<string, unknown>;
      metadata.updated = new Date().toISOString();

      // Remove exploded metadata since we're imploding
      if ('exploded' in metadata) {
        delete metadata.exploded;
      }

      // Add imploded metadata
      metadata.imploded = {
        timestamp: new Date().toISOString(),
        mergedCount: this.mergedFiles.length
      };

      // Create backup
      if (options.backup) {
        const backupPath = inputPath + '.backup';
        fs.copyFileSync(inputPath, backupPath);
      }

      // Write updated parent file
      this.writeCodexFile(inputPath, codexData, isJson ? 'json' : 'yaml');

      // Delete source files if requested
      if (options.deleteSourceFiles && this.mergedFiles.length > 0) {
        await this.deleteSourceFiles(parentDir, options.deleteEmptyFolders);
      }

      return {
        success: true,
        mergedCount: this.mergedFiles.length,
        mergedFiles: this.mergedFiles,
        deletedFiles: this.deletedFiles,
        deletedFolders: this.deletedFolders,
        errors: this.errors
      };

    } catch (e) {
      return {
        success: false,
        mergedCount: 0,
        mergedFiles: [],
        deletedFiles: [],
        deletedFolders: [],
        errors: [String(e), ...this.errors]
      };
    }
  }

  /**
   * Count include directives in children array
   */
  private countIncludes(children: Record<string, unknown>[]): number {
    let count = 0;
    for (const child of children) {
      if ('include' in child && typeof child.include === 'string') {
        count++;
      }
    }
    return count;
  }

  /**
   * Resolve all include directives in children array
   */
  private async resolveIncludes(
    children: Record<string, unknown>[],
    parentDir: string,
    options: ImplodeOptions
  ): Promise<Record<string, unknown>[]> {
    const resolved: Record<string, unknown>[] = [];

    for (const child of children) {
      if ('include' in child && typeof child.include === 'string') {
        // This is an include directive
        const includePath = child.include as string;

        try {
          const resolvedContent = await this.resolveInclude(includePath, parentDir, options);
          if (resolvedContent) {
            resolved.push(resolvedContent);
          } else {
            // Keep the include directive if resolution failed
            resolved.push(child);
          }
        } catch (e) {
          this.errors.push(`Failed to resolve include "${includePath}": ${e}`);
          // Keep the original include directive on failure
          resolved.push(child);
        }
      } else {
        // Regular child - keep as-is, but check for nested includes if recursive
        if (options.recursive && 'children' in child && Array.isArray(child.children)) {
          const nestedResolved = await this.resolveIncludes(
            child.children as Record<string, unknown>[],
            parentDir,
            options
          );
          resolved.push({ ...child, children: nestedResolved });
        } else {
          resolved.push(child);
        }
      }
    }

    return resolved;
  }

  /**
   * Resolve a single include directive
   */
  private async resolveInclude(
    includePath: string,
    parentDir: string,
    options: ImplodeOptions
  ): Promise<Record<string, unknown> | null> {
    // === SECURITY: Validate include path doesn't escape parent directory ===
    // Reject absolute paths (starting with drive letter on Windows or / on Unix)
    if (path.isAbsolute(includePath) && !includePath.startsWith('/')) {
      this.errors.push(`Absolute include paths not allowed: ${includePath}`);
      return null;
    }

    // Resolve the path relative to parent directory
    // Include paths typically start with / which means relative to parent dir
    let fullPath: string;
    if (includePath.startsWith('/')) {
      fullPath = path.join(parentDir, includePath);
    } else {
      fullPath = path.resolve(parentDir, includePath);
    }

    // === SECURITY: Validate resolved path stays within parent directory ===
    const normalizedFull = path.normalize(fullPath);
    const normalizedParent = path.normalize(parentDir);
    if (!normalizedFull.startsWith(normalizedParent + path.sep) && normalizedFull !== normalizedParent) {
      this.errors.push(`Include path escapes parent directory boundary: ${includePath}`);
      return null;
    }

    // === CIRCULAR INCLUDE DETECTION ===
    if (this.visitedPaths.has(normalizedFull)) {
      this.errors.push(`Circular include detected: ${includePath} (already processing ${normalizedFull})`);
      return null;
    }

    // Validate file exists
    if (!fs.existsSync(fullPath)) {
      this.errors.push(`Include file not found: ${fullPath}`);
      return null;
    }

    // === SECURITY: Reject symlinks to prevent path escape attacks ===
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      this.errors.push(`Symlinks not allowed for includes: ${fullPath}`);
      return null;
    }

    // Validate it's a codex file
    if (!isCodexFile(fullPath)) {
      this.errors.push(`Include is not a valid codex file: ${fullPath}`);
      return null;
    }

    // Mark as being processed to detect circular includes
    this.visitedPaths.add(normalizedFull);

    // Read and parse the file
    const content = fs.readFileSync(fullPath, 'utf-8');
    const isJson = fullPath.toLowerCase().endsWith('.json');

    let includedData: Record<string, unknown>;
    try {
      if (isJson) {
        includedData = JSON.parse(content);
      } else {
        includedData = YAML.parse(content) as Record<string, unknown>;
      }
    } catch (e) {
      this.errors.push(`Failed to parse include file "${fullPath}": ${e}`);
      return null;
    }

    // Track merged file
    this.mergedFiles.push(fullPath);
    console.log(`[Implode] Resolved include: ${includePath} -> ${fullPath}`);

    // Extract the node data, removing metadata that's specific to standalone files
    const entityData = this.extractEntityData(includedData);

    // Handle recursive includes if the included file has children with includes
    if (options.recursive && 'children' in entityData && Array.isArray(entityData.children)) {
      const includedDir = path.dirname(fullPath);
      entityData.children = await this.resolveIncludes(
        entityData.children as Record<string, unknown>[],
        includedDir,
        options
      );
    }

    return entityData;
  }

  /**
   * Extract node data from included file, removing standalone metadata
   */
  private extractEntityData(includedData: Record<string, unknown>): Record<string, unknown> {
    const entityData: Record<string, unknown> = {};

    // Copy all fields except metadata
    for (const [key, value] of Object.entries(includedData)) {
      if (key === 'metadata') {
        // Skip metadata from included file - it's for standalone use only
        continue;
      }
      entityData[key] = value;
    }

    return entityData;
  }

  /**
   * Delete source files after successful merge
   */
  private async deleteSourceFiles(parentDir: string, deleteEmptyFolders: boolean): Promise<void> {
    const foldersToCheck = new Set<string>();
    const normalizedParent = path.normalize(parentDir);

    for (const filePath of this.mergedFiles) {
      try {
        // === SECURITY: Re-validate path is within parent directory before deletion ===
        const normalizedPath = path.normalize(filePath);
        if (!normalizedPath.startsWith(normalizedParent + path.sep)) {
          this.errors.push(`Refusing to delete file outside parent scope: ${filePath}`);
          continue;
        }

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.deletedFiles.push(filePath);

          // Track parent folder for potential cleanup
          const folder = path.dirname(filePath);
          foldersToCheck.add(folder);
        }
      } catch (e) {
        this.errors.push(`Failed to delete file "${filePath}": ${e}`);
      }
    }

    // Delete empty folders if requested
    if (deleteEmptyFolders) {
      // Sort by depth (deepest first) to handle nested empty folders
      const sortedFolders = Array.from(foldersToCheck).sort((a, b) =>
        b.split(path.sep).length - a.split(path.sep).length
      );

      for (const folder of sortedFolders) {
        try {
          // === SECURITY: Only delete folders within parent scope ===
          const normalizedFolder = path.normalize(folder);
          if (!normalizedFolder.startsWith(normalizedParent + path.sep)) {
            continue;
          }

          const contents = fs.readdirSync(folder);
          if (contents.length === 0) {
            fs.rmdirSync(folder);
            this.deletedFolders.push(folder);
            console.log(`[Implode] Deleted empty folder: ${folder}`);
          }
        } catch (e) {
          // Ignore errors when checking/deleting folders
          console.log(`[Implode] Could not delete folder "${folder}": ${e}`);
        }
      }
    }
  }

  /**
   * Write codex data to file with proper formatting
   */
  private writeCodexFile(
    filePath: string,
    data: Record<string, unknown>,
    format: 'yaml' | 'json'
  ): void {
    if (format === 'yaml') {
      const doc = new YAML.Document(data);

      // Set block scalar style for long/multiline strings
      const setBlockStyle = (node: unknown): void => {
        if (YAML.isMap(node)) {
          for (const pair of node.items) {
            if (YAML.isScalar(pair.value) && typeof pair.value.value === 'string') {
              const str = pair.value.value;
              if (str.includes('\n') || str.length > 60) {
                pair.value.type = YAML.Scalar.BLOCK_LITERAL;
              }
            } else {
              setBlockStyle(pair.value);
            }
          }
        } else if (YAML.isSeq(node)) {
          for (const item of node.items) {
            setBlockStyle(item);
          }
        }
      };

      setBlockStyle(doc.contents);

      fs.writeFileSync(filePath, doc.toString({ lineWidth: 120 }), 'utf-8');
    } else {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
  }

  /**
   * Get count of include directives from a codex document text
   */
  static getIncludeCount(documentText: string): number {
    try {
      const isJson = documentText.trim().startsWith('{');
      const data = isJson ? JSON.parse(documentText) : YAML.parse(documentText);

      if (!data?.children || !Array.isArray(data.children)) {
        return 0;
      }

      let count = 0;
      for (const child of data.children) {
        if (child && typeof child === 'object' && 'include' in child) {
          count++;
        }
      }

      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Get list of include paths from a codex document text
   */
  static getIncludePaths(documentText: string): string[] {
    try {
      const isJson = documentText.trim().startsWith('{');
      const data = isJson ? JSON.parse(documentText) : YAML.parse(documentText);

      if (!data?.children || !Array.isArray(data.children)) {
        return [];
      }

      const paths: string[] = [];
      for (const child of data.children) {
        if (child && typeof child === 'object' && 'include' in child && typeof child.include === 'string') {
          paths.push(child.include);
        }
      }

      return paths;
    } catch {
      return [];
    }
  }
}

/**
 * Output channel for implode logs
 */
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('ChapterWise Imploder');
  }
  return outputChannel;
}

/**
 * Run the Implode Codex command with user input flow
 */
export async function runImplodeCodex(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage('No active editor. Open a Codex file first.');
    return;
  }

  if (!isCodexFile(editor.document.fileName)) {
    vscode.window.showErrorMessage('Current file is not a Codex file (.codex.yaml, .codex.json, or .codex)');
    return;
  }

  const documentText = editor.document.getText();
  const documentUri = editor.document.uri;

  // Step 1: Check for includes
  const includeCount = CodexImploder.getIncludeCount(documentText);
  const includePaths = CodexImploder.getIncludePaths(documentText);

  if (includeCount === 0) {
    vscode.window.showWarningMessage('No include directives found in this codex file. Nothing to implode.');
    return;
  }

  // Show what was found
  const proceed = await vscode.window.showInformationMessage(
    `Found ${includeCount} include directive${includeCount > 1 ? 's' : ''} to merge.`,
    { modal: true },
    'Continue',
    'Show Includes'
  );

  if (!proceed) {
    return;
  }

  if (proceed === 'Show Includes') {
    const channel = getOutputChannel();
    channel.appendLine(`\nIncludes found in ${editor.document.fileName}:`);
    includePaths.forEach((p, i) => channel.appendLine(`  ${i + 1}. ${p}`));
    channel.show();

    // Ask again after showing
    const continueAfterShow = await vscode.window.showInformationMessage(
      `Found ${includeCount} include directive${includeCount > 1 ? 's' : ''}. Continue with implode?`,
      { modal: true },
      'Continue'
    );
    if (!continueAfterShow) {
      return;
    }
  }

  // Step 2: Options selection
  const optionItems: vscode.QuickPickItem[] = [
    {
      label: '$(file-add) Create Backup',
      description: 'Backup parent file before modifying',
      picked: true
    },
    {
      label: '$(sync) Recursive',
      description: 'Resolve nested includes (includes within included files)',
      picked: false
    }
  ];

  const selectedOptions = await vscode.window.showQuickPick(optionItems, {
    title: 'Implode Codex - Step 1/2: Options',
    placeHolder: 'Select options (use Space to toggle, Enter to confirm)',
    canPickMany: true
  });

  if (selectedOptions === undefined) {
    return; // User cancelled
  }

  // Step 3: Delete source files option
  const deleteChoice = await vscode.window.showInformationMessage(
    'After merging, would you like to delete the original included files?',
    { modal: true },
    '🗑️ Delete Source Files',
    '📦 Keep Source Files'
  );

  if (!deleteChoice) {
    return; // User cancelled
  }

  const deleteSourceFiles = deleteChoice.includes('Delete');
  let deleteEmptyFolders = false;

  // If deleting files, ask about folders
  if (deleteSourceFiles) {
    const folderChoice = await vscode.window.showInformationMessage(
      'Also delete folders that become empty after removing source files?',
      { modal: true },
      'Yes, Delete Empty Folders',
      'No, Keep Folders'
    );

    if (!folderChoice) {
      return; // User cancelled
    }

    deleteEmptyFolders = folderChoice.includes('Yes');
  }

  // Step 4: Dry Run or Execute
  const runChoice = await vscode.window.showInformationMessage(
    `Ready to merge ${includeCount} include${includeCount > 1 ? 's' : ''}. What would you like to do?`,
    { modal: true },
    '👁️ Preview Only (Dry Run)',
    '🚀 Execute for Real'
  );

  if (!runChoice) {
    return; // User cancelled
  }

  const isDryRun = runChoice.includes('Preview') || runChoice.includes('Dry Run');

  // Build options
  const options: ImplodeOptions = {
    dryRun: isDryRun,
    deleteSourceFiles: deleteSourceFiles,
    backup: selectedOptions?.some(o => o.label.includes('Backup')) ?? true,
    recursive: selectedOptions?.some(o => o.label.includes('Recursive')) ?? false,
    deleteEmptyFolders: deleteEmptyFolders
  };

  // Step 5: Final confirmation for real execution
  if (!options.dryRun) {
    let warningMsg = `⚠️ This will MODIFY the codex file, merging ${includeCount} included files.`;
    if (options.deleteSourceFiles) {
      warningMsg += ` The original ${includeCount} source file${includeCount > 1 ? 's' : ''} will be DELETED.`;
    }
    warningMsg += ' Are you sure?';

    const confirm = await vscode.window.showWarningMessage(
      warningMsg,
      { modal: true },
      'Yes, Do It!'
    );
    if (!confirm) {
      return;
    }
  }

  // Run with progress
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.dryRun ? 'Previewing Implode...' : 'Imploding Codex...',
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: 'Resolving includes...' });

      const imploder = new CodexImploder();
      return await imploder.implode(documentUri, options);
    }
  );

  // Log results
  const channel = getOutputChannel();
  channel.appendLine(`\n${'='.repeat(60)}`);
  channel.appendLine(`Implode Codex Results - ${new Date().toLocaleString()}`);
  channel.appendLine(`File: ${documentUri.fsPath}`);
  channel.appendLine(`Dry Run: ${options.dryRun}`);
  channel.appendLine(`Delete Source Files: ${options.deleteSourceFiles}`);
  channel.appendLine(`Recursive: ${options.recursive}`);
  channel.appendLine(`${'='.repeat(60)}`);

  if (result.success) {
    if (options.dryRun) {
      channel.appendLine(`✅ [DRY RUN] Would merge ${result.mergedCount} includes (no changes made)`);
    } else {
      channel.appendLine(`✅ Success! Merged ${result.mergedCount} includes`);
    }

    if (result.mergedFiles.length > 0) {
      channel.appendLine(options.dryRun ? `\nWould merge files:` : `\nMerged files:`);
      result.mergedFiles.forEach((f, i) => {
        channel.appendLine(`  ${i + 1}. ${f}`);
      });
    }

    if (result.deletedFiles.length > 0) {
      channel.appendLine(`\nDeleted files:`);
      result.deletedFiles.forEach((f, i) => {
        channel.appendLine(`  ${i + 1}. ${f}`);
      });
    }

    if (result.deletedFolders.length > 0) {
      channel.appendLine(`\nDeleted empty folders:`);
      result.deletedFolders.forEach((f, i) => {
        channel.appendLine(`  ${i + 1}. ${f}`);
      });
    }

    if (result.errors.length > 0) {
      channel.appendLine(`\nWarnings:`);
      result.errors.forEach(e => channel.appendLine(`  - ${e}`));
    }

    // Show success message
    let successMsg = options.dryRun
      ? `[DRY RUN] Would merge ${result.mergedCount} includes`
      : `✅ Merged ${result.mergedCount} includes into the codex file`;

    if (!options.dryRun && result.deletedFiles.length > 0) {
      successMsg += ` (deleted ${result.deletedFiles.length} source files)`;
    }

    const action = await vscode.window.showInformationMessage(
      successMsg,
      'Show Details'
    );

    if (action === 'Show Details') {
      channel.show();
    }

  } else {
    channel.appendLine(`❌ Failed!`);
    result.errors.forEach(e => channel.appendLine(`  Error: ${e}`));

    vscode.window.showErrorMessage(
      `Implode failed: ${result.errors[0]}`,
      'Show Details'
    ).then(action => {
      if (action === 'Show Details') {
        channel.show();
      }
    });
  }

  channel.appendLine(`${'='.repeat(60)}\n`);
}

/**
 * Dispose of resources
 */
export function disposeImplodeCodex(): void {
  outputChannel?.dispose();
}



































































