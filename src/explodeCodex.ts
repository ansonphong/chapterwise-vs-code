/**
 * Explode Codex - Extract and Modularize Codex Children
 *
 * Extracts direct children from a codex file based on node type,
 * saves each as a standalone V1.0 codex file, and replaces them with
 * include directives in the parent file.
 *
 * Ported from Python explode_codex.py
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { parseCodex, isCodexFile, generateUuid } from './codexModel';
import { CodexAutoFixer } from './autoFixer';

/**
 * Options for explode operation
 */
export interface ExplodeOptions {
  types?: string[];           // Node types to extract (undefined = all)
  outputPattern: string;      // Path pattern with {type}, {name}, {id}, {index}
  format: 'yaml' | 'json';
  dryRun: boolean;
  backup: boolean;
  autoFix: boolean;
  force: boolean;
}

/**
 * Result of explode operation
 */
export interface ExplodeResult {
  success: boolean;
  extractedCount: number;
  extractedFiles: string[];
  extractionMap: Map<string, string>;  // childId -> filePath
  autoFixResults?: {
    totalFiles: number;
    fixedFiles: number;
    totalFixes: number;
  };
  errors: string[];
}

/**
 * Codex Exploder - Extract children into separate files
 */
export class CodexExploder {
  private extractedFiles: string[] = [];
  private extractionMap: Map<string, string> = new Map();
  private errors: string[] = [];

  /**
   * Explode a codex file - extract children into separate files
   */
  async explode(
    documentUri: vscode.Uri,
    options: ExplodeOptions
  ): Promise<ExplodeResult> {
    // Reset state
    this.extractedFiles = [];
    this.extractionMap = new Map();
    this.errors = [];

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

      // Debug: log children count
      console.log(`[Explode] Found ${codexData.children.length} children in codex file`);
      console.log(`[Explode] Types filter: ${options.types?.join(', ') || 'all (no filter)'}`);

      if (codexData.children.length === 0) {
        return {
          success: true,
          extractedCount: 0,
          extractedFiles: [],
          extractionMap: new Map(),
          errors: ['Children array is empty - nothing to extract']
        };
      }

      // Extract matching children
      const { extracted, remaining } = this.extractChildren(
        codexData.children as Record<string, unknown>[],
        options.types
      );

      console.log(`[Explode] After filtering: ${extracted.length} extracted, ${remaining.length} remaining`);

      if (extracted.length === 0) {
        return {
          success: true,
          extractedCount: 0,
          extractedFiles: [],
          extractionMap: new Map(),
          errors: [`No children matched the specified types: ${options.types?.join(', ') || 'all'}`]
        };
      }

      const parentDir = path.dirname(inputPath);
      const parentMetadata = (codexData.metadata as Record<string, unknown>) || {};

      // Process each extracted child
      for (let idx = 0; idx < extracted.length; idx++) {
        const child = extracted[idx];

        try {
          const outputPath = this.resolveOutputPath(
            child,
            idx,
            options.outputPattern,
            parentDir,
            options.format
          );

          // === SECURITY: Reject symlinks at output path ===
          if (fs.existsSync(outputPath) && fs.lstatSync(outputPath).isSymbolicLink()) {
            this.errors.push(`Output path is a symlink, skipping: ${outputPath}`);
            continue;
          }

          // Check if file exists
          if (fs.existsSync(outputPath) && !options.force && !options.dryRun) {
            this.errors.push(`File already exists: ${outputPath} (use force option to overwrite)`);
            continue;
          }

          if (options.dryRun) {
            // Just record what would happen (still track the file for counting)
            console.log(`[DRY RUN] Would extract: ${child.name || 'Untitled'} -> ${outputPath}`);
            this.extractedFiles.push(outputPath);  // Track for count even in dry run
          } else {
            // Create extracted codex file
            const extractedCodex = this.createExtractedCodex(
              child,
              parentMetadata,
              inputPath
            );

            // Create directory if needed (recursive: true is safe if already exists)
            const outputDir = path.dirname(outputPath);
            fs.mkdirSync(outputDir, { recursive: true });

            // Write file
            this.writeCodexFile(outputPath, extractedCodex, options.format);
            this.extractedFiles.push(outputPath);
          }

          // Store mapping
          const childId = (child.id as string) || `child_${idx}`;
          this.extractionMap.set(childId, outputPath);

        } catch (e) {
          const errorMsg = `Failed to extract child ${idx}: ${e}`;
          this.errors.push(errorMsg);
        }
      }

      // Update parent file with include directives
      if (!options.dryRun && this.extractedFiles.length > 0) {
        const includeDirectives: unknown[] = [];

        for (const child of extracted) {
          const childId = (child.id as string) || '';
          if (this.extractionMap.has(childId)) {
            const outputPath = this.extractionMap.get(childId)!;
            const includePath = this.generateIncludePath(outputPath, parentDir);
            includeDirectives.push({ include: includePath });
          } else {
            // Keep original child if extraction failed
            includeDirectives.push(child);
          }
        }

        // Replace extracted children with includes, keep remaining
        codexData.children = [...includeDirectives, ...remaining];

        // Update metadata
        if (!codexData.metadata) {
          codexData.metadata = {};
        }
        const metadata = codexData.metadata as Record<string, unknown>;
        metadata.updated = new Date().toISOString();
        metadata.exploded = {
          timestamp: new Date().toISOString(),
          extractedTypes: options.types || 'all',
          extractedCount: this.extractedFiles.length
        };

        // Create backup
        if (options.backup) {
          const backupPath = inputPath + '.backup';
          fs.copyFileSync(inputPath, backupPath);
        }

        // Write updated parent file
        this.writeCodexFile(inputPath, codexData, options.format);
      }

      // Run auto-fixer on extracted files
      let autoFixResults: ExplodeResult['autoFixResults'];
      if (options.autoFix && this.extractedFiles.length > 0 && !options.dryRun) {
        autoFixResults = await this.autoFixExtractedFiles(this.extractedFiles);
      }

      return {
        success: true,
        extractedCount: this.extractedFiles.length,
        extractedFiles: this.extractedFiles,
        extractionMap: this.extractionMap,
        autoFixResults,
        errors: this.errors
      };

    } catch (e) {
      return {
        success: false,
        extractedCount: 0,
        extractedFiles: [],
        extractionMap: new Map(),
        errors: [String(e), ...this.errors]
      };
    }
  }

  /**
   * Extract children matching specified types
   */
  private extractChildren(
    children: Record<string, unknown>[],
    types?: string[]
  ): { extracted: Record<string, unknown>[]; remaining: Record<string, unknown>[] } {
    if (!types || types.length === 0) {
      // Extract all direct children
      return { extracted: children, remaining: [] };
    }

    const typesLower = types.map(t => t.toLowerCase());
    const extracted: Record<string, unknown>[] = [];
    const remaining: Record<string, unknown>[] = [];

    for (const child of children) {
      const childType = ((child.type as string) || '').toLowerCase();

      if (typesLower.includes(childType)) {
        extracted.push(child);
      } else {
        remaining.push(child);
      }
    }

    return { extracted, remaining };
  }

  /**
   * Create a standalone V1.0 codex file from a child node
   */
  private createExtractedCodex(
    child: Record<string, unknown>,
    parentMetadata: Record<string, unknown>,
    parentPath: string
  ): Record<string, unknown> {
    // Inherit all metadata from parent, except file-specific fields
    // These fields are specific to the standalone parent file and should not be copied
    const excludedFields = new Set([
      'created',
      'updated',
      'extractedFrom',
      'exploded',
      'imploded',
      'documentVersion'
    ]);

    // Deep clone all inheritable parent metadata
    const inheritedMetadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parentMetadata)) {
      if (!excludedFields.has(key)) {
        // Deep clone to avoid reference issues
        inheritedMetadata[key] = JSON.parse(JSON.stringify(value));
      }
    }

    // Build metadata with inherited fields, then override with extracted-file-specific fields
    const metadata: Record<string, unknown> = {
      ...inheritedMetadata,
      formatVersion: '1.1',
      documentVersion: '1.0.0',
      created: new Date().toISOString(),
      extractedFrom: parentPath
    };

    // Create codex structure
    const extractedCodex: Record<string, unknown> = { metadata };

    // Copy all child data
    for (const [key, value] of Object.entries(child)) {
      if (key !== 'metadata') {
        extractedCodex[key] = value;
      }
    }

    // Ensure required fields exist
    if (!extractedCodex.id) {
      extractedCodex.id = generateUuid();
    }
    if (!extractedCodex.type) {
      extractedCodex.type = 'node';
    }
    if (!extractedCodex.name && !extractedCodex.title) {
      extractedCodex.name = 'Untitled';
    }

    return extractedCodex;
  }

  /**
   * Resolve output path from pattern with placeholders
   */
  private resolveOutputPath(
    child: Record<string, unknown>,
    index: number,
    pattern: string,
    parentDir: string,
    format: 'yaml' | 'json'
  ): string {
    const childType = (child.type as string) || 'node';
    const childName = (child.name as string) || (child.title as string) || 'Untitled';
    const childId = (child.id as string) || `child_${index}`;

    // === SECURITY: Sanitize ALL user-controlled fields used in path construction ===
    const safeType = this.sanitizeFilename(childType);
    const safeName = this.sanitizeFilename(childName);
    const safeId = this.sanitizeFilename(childId);

    // Replace placeholders
    let outputStr = pattern
      .replace(/\{type\}/g, safeType)
      .replace(/\{name\}/g, safeName)
      .replace(/\{id\}/g, safeId)
      .replace(/\{index\}/g, String(index));

    // Ensure correct extension
    let outputPath = outputStr;
    if (format === 'yaml' && !outputPath.match(/\.(yaml|yml)$/i)) {
      outputPath = outputPath.replace(/\.[^.]+$/, '') + '.codex.yaml';
    } else if (format === 'json' && !outputPath.endsWith('.json')) {
      outputPath = outputPath.replace(/\.[^.]+$/, '') + '.codex.json';
    }

    // Resolve relative to parent directory
    if (!path.isAbsolute(outputPath)) {
      outputPath = path.resolve(parentDir, outputPath);
    }

    // === SECURITY: Validate resolved path stays within parent directory ===
    const normalizedOutput = path.normalize(outputPath);
    const normalizedParent = path.normalize(parentDir);
    if (!normalizedOutput.startsWith(normalizedParent + path.sep) && normalizedOutput !== normalizedParent) {
      throw new Error(`Output path escapes parent directory boundary: ${outputPath}`);
    }

    return outputPath;
  }

  /**
   * Sanitize a name for use as a filename
   */
  private sanitizeFilename(name: string): string {
    // === SECURITY: Handle special directory patterns ===
    if (name === '.' || name === '..') {
      return 'untitled';
    }

    // === SECURITY: Remove leading dots (hidden files) ===
    let safeName = name.startsWith('.') ? name.substring(1) : name;

    // Remove or replace invalid filename characters
    safeName = safeName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');

    // === SECURITY: Remove path traversal sequences after character replacement ===
    safeName = safeName.replace(/\.{2,}/g, '.');

    // Replace multiple spaces with single space
    safeName = safeName.replace(/\s+/g, ' ');

    // Trim and replace spaces with hyphens
    safeName = safeName.trim().replace(/ /g, '-');

    // Limit length
    if (safeName.length > 100) {
      safeName = safeName.substring(0, 100);
    }

    // Ensure not empty
    if (!safeName) {
      safeName = 'untitled';
    }

    return safeName;
  }

  /**
   * Generate relative include path from parent to output file
   */
  private generateIncludePath(outputPath: string, parentDir: string): string {
    try {
      // Get relative path
      const relPath = path.relative(parentDir, outputPath);
      // Convert to POSIX style (forward slashes) and add leading slash
      return '/' + relPath.replace(/\\/g, '/');
    } catch {
      // If can't be made relative, use absolute
      return outputPath.replace(/\\/g, '/');
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
   * Run auto-fixer on extracted files
   */
  private async autoFixExtractedFiles(
    filePaths: string[]
  ): Promise<{ totalFiles: number; fixedFiles: number; totalFixes: number }> {
    const results = {
      totalFiles: filePaths.length,
      fixedFiles: 0,
      totalFixes: 0
    };

    const fixer = new CodexAutoFixer();

    for (const filePath of filePaths) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const result = fixer.autoFixCodex(content, false);

        if (result.success && result.fixesApplied.length > 0) {
          fs.writeFileSync(filePath, result.fixedText, 'utf-8');
          results.fixedFiles++;
          results.totalFixes += result.fixesApplied.length;
        }
      } catch (e) {
        console.error(`Auto-fix failed for ${filePath}:`, e);
      }
    }

    return results;
  }

  /**
   * Get all unique child types from a codex document
   */
  static getChildTypes(documentText: string): string[] {
    try {
      const isJson = documentText.trim().startsWith('{');
      const data = isJson ? JSON.parse(documentText) : YAML.parse(documentText);

      if (!data?.children || !Array.isArray(data.children)) {
        return [];
      }

      const types = new Set<string>();
      for (const child of data.children) {
        if (child && typeof child === 'object' && child.type) {
          types.add(child.type as string);
        }
      }

      return Array.from(types).sort();
    } catch {
      return [];
    }
  }
}

/**
 * Output channel for explode logs
 */
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('ChapterWise Codex Exploder');
  }
  return outputChannel;
}

/**
 * Run the Explode Codex command with user input flow
 */
export async function runExplodeCodex(): Promise<void> {
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

  // Step 1: Get available child types
  const availableTypes = CodexExploder.getChildTypes(documentText);

  if (availableTypes.length === 0) {
    vscode.window.showWarningMessage('No children found in this codex file, or children have no types defined.');
    return;
  }

  // Step 2: Select types to extract
  const typeItems: vscode.QuickPickItem[] = [
    {
      label: '$(list-flat) Extract All Children',
      description: `All ${availableTypes.length} types`,
      picked: true
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    ...availableTypes.map(type => ({
      label: `$(symbol-class) ${type}`,
      description: `Extract all "${type}" nodes`,
      picked: false
    }))
  ];

  const selectedTypes = await vscode.window.showQuickPick(typeItems, {
    title: 'Explode Codex - Step 1/3: Select Node Types',
    placeHolder: 'Which node types should be extracted into separate files?',
    canPickMany: true
  });

  if (!selectedTypes || selectedTypes.length === 0) {
    return; // User cancelled
  }

  // Parse selected types
  let types: string[] | undefined;
  const extractAll = selectedTypes.some(item => item.label.includes('Extract All'));
  if (!extractAll) {
    types = selectedTypes
      .filter(item => item.label.startsWith('$(symbol-class)'))
      .map(item => item.label.replace('$(symbol-class) ', ''));
  }

  // Step 3: Output pattern
  const outputPattern = await vscode.window.showInputBox({
    title: 'Explode Codex - Step 2/3: Output Pattern',
    prompt: 'Path pattern for extracted files. Placeholders: {type}, {name}, {id}, {index}',
    value: './{type}s/{name}.codex.yaml',
    placeHolder: './{type}s/{name}.codex.yaml',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Output pattern cannot be empty';
      }
      if (!value.includes('{name}') && !value.includes('{id}') && !value.includes('{index}')) {
        return 'Pattern should include at least one of: {name}, {id}, or {index} to ensure unique filenames';
      }
      return null;
    }
  });

  if (outputPattern === undefined) {
    return; // User cancelled
  }

  // Step 4: Additional options (backup, auto-fix)
  const optionItems: vscode.QuickPickItem[] = [
    {
      label: '$(file-add) Create Backup',
      description: 'Backup original file before modifying',
      picked: true
    },
    {
      label: '$(tools) Auto-Fix Extracted Files',
      description: 'Run auto-fixer on each extracted file',
      picked: true
    }
  ];

  const selectedOptions = await vscode.window.showQuickPick(optionItems, {
    title: 'Explode Codex - Step 3/3: Options',
    placeHolder: 'Select options (use Space to toggle, Enter to confirm)',
    canPickMany: true
  });

  if (selectedOptions === undefined) {
    return; // User cancelled
  }

  // Step 5: Dry Run or Execute - explicit choice with clear buttons
  const typesDesc = types ? types.join(', ') : 'all children';
  const runChoice = await vscode.window.showInformationMessage(
    `Ready to extract ${typesDesc}. What would you like to do?`,
    { modal: true },
    '👁️ Preview Only (Dry Run)',
    '🚀 Execute for Real'
  );

  if (!runChoice) {
    return; // User cancelled
  }

  const isDryRun = runChoice.includes('Preview') || runChoice.includes('Dry Run');

  // Parse options
  const options: ExplodeOptions = {
    types,
    outputPattern: outputPattern.trim(),
    format: outputPattern.toLowerCase().includes('.json') ? 'json' : 'yaml',
    dryRun: isDryRun,
    backup: selectedOptions?.some(o => o.label.includes('Backup')) ?? true,
    autoFix: selectedOptions?.some(o => o.label.includes('Auto-Fix')) ?? true,
    force: false
  };

  // Final confirmation for real execution
  if (!options.dryRun) {
    const confirm = await vscode.window.showWarningMessage(
      `⚠️ This will CREATE ${typesDesc === 'all children' ? 'files' : typesDesc + ' files'} and MODIFY the original codex. Are you sure?`,
      { modal: true },
      'Yes, Do It!'
    );
    if (!confirm) {
      return;
    }
  }

  // Run with progress - returns result so we can show messages AFTER progress completes
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.dryRun ? 'Previewing Explode...' : 'Exploding Codex...',
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: 'Extracting children...' });

      const exploder = new CodexExploder();
      return await exploder.explode(documentUri, options);
    }
  );

  // Log results AFTER progress completes (so progress indicator clears)
  const channel = getOutputChannel();
  channel.appendLine(`\n${'='.repeat(60)}`);
  channel.appendLine(`Explode Codex Results - ${new Date().toLocaleString()}`);
  channel.appendLine(`File: ${documentUri.fsPath}`);
  channel.appendLine(`Types: ${types?.join(', ') || 'all'}`);
  channel.appendLine(`Pattern: ${options.outputPattern}`);
  channel.appendLine(`Dry Run: ${options.dryRun}`);
  channel.appendLine(`${'='.repeat(60)}`);

  if (result.success) {
    if (options.dryRun) {
      channel.appendLine(`✅ [DRY RUN] Would extract ${result.extractedCount} nodes (no files created)`);
    } else {
      channel.appendLine(`✅ Success! Extracted ${result.extractedCount} nodes`);
    }

    if (result.extractedFiles.length > 0) {
      channel.appendLine(options.dryRun ? `\nWould create files:` : `\nExtracted files:`);
      result.extractedFiles.forEach((f, i) => {
        channel.appendLine(`  ${i + 1}. ${f}`);
      });
    }

    if (result.autoFixResults) {
      channel.appendLine(`\nAuto-fix results:`);
      channel.appendLine(`  Fixed files: ${result.autoFixResults.fixedFiles}/${result.autoFixResults.totalFiles}`);
      channel.appendLine(`  Total fixes: ${result.autoFixResults.totalFixes}`);
    }

    if (result.errors.length > 0) {
      channel.appendLine(`\nWarnings:`);
      result.errors.forEach(e => channel.appendLine(`  - ${e}`));
    }

    // Show success message (no longer blocks progress)
    const action = await vscode.window.showInformationMessage(
      options.dryRun
        ? `[DRY RUN] Would extract ${result.extractedCount} nodes`
        : `✅ Extracted ${result.extractedCount} nodes into separate files`,
      'Show Details',
      'Open Folder'
    );

    if (action === 'Show Details') {
      channel.show();
    } else if (action === 'Open Folder' && result.extractedFiles.length > 0) {
      const firstFile = result.extractedFiles[0];
      const folderUri = vscode.Uri.file(path.dirname(firstFile));
      vscode.commands.executeCommand('revealFileInOS', folderUri);
    }

  } else {
    channel.appendLine(`❌ Failed!`);
    result.errors.forEach(e => channel.appendLine(`  Error: ${e}`));

    vscode.window.showErrorMessage(
      `Explode failed: ${result.errors[0]}`,
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
export function disposeExplodeCodex(): void {
  outputChannel?.dispose();
}


