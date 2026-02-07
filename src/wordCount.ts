/**
 * Word Count - Update word_count attributes in Codex files
 *
 * Recursively traverses a codex file and its children, counts words in body
 * fields, and updates the word_count attribute on each node.
 *
 * Based on the Python script: 11-LIVES-CODEX/scripts/word_count.py
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
const fsPromises = fs.promises;
import * as YAML from 'yaml';
import { isCodexFile, isCodexLikeFile, isMarkdownFile } from './codexModel';

const MAX_RECURSION_DEPTH = 50;

/**
 * Options for word count operation
 */
export interface WordCountOptions {
  followIncludes: boolean;  // Also process included files
}

/**
 * Result of word count operation
 */
export interface WordCountResult {
  success: boolean;
  entitiesUpdated: number;    // Number of nodes with word counts updated
  totalWords: number;         // Total words across all nodes
  filesModified: string[];    // List of files that were modified
  errors: string[];
}

/**
 * Word Counter - Update word counts in codex files
 */
export class WordCounter {
  private entitiesUpdated: number = 0;
  private totalWords: number = 0;
  private filesModified: string[] = [];
  private errors: string[] = [];
  private processedFiles: Set<string> = new Set();
  private workspaceRoot: string = '';

  /**
   * Count words in a text string (split on whitespace)
   */
  private countWords(text: string): number {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    return text.split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Check if a resolved path is within the workspace root
   */
  private isPathWithinRoot(resolvedPath: string): boolean {
    const normalizedResolved = path.resolve(resolvedPath);
    const normalizedRoot = path.resolve(this.workspaceRoot);
    return normalizedResolved.startsWith(normalizedRoot + path.sep) || normalizedResolved === normalizedRoot;
  }

  /**
   * Find an existing word_count attribute or create a new one
   */
  private findOrCreateWordCountAttribute(
    attributes: Record<string, unknown>[]
  ): Record<string, unknown> {
    // Find existing attribute
    for (const attr of attributes) {
      if (attr.key === 'word_count') {
        return attr;
      }
    }

    // Create new attribute
    const newAttr: Record<string, unknown> = {
      key: 'word_count',
      name: 'Word Count',
      value: 0,
      dataType: 'int'
    };
    attributes.push(newAttr);
    return newAttr;
  }

  /**
   * Update word count in an object and its children recursively
   */
  private async updateWordCountInObject(
    obj: Record<string, unknown>,
    parentDir: string,
    options: WordCountOptions,
    depth: number = 0
  ): Promise<boolean> {
    if (depth > MAX_RECURSION_DEPTH) {
      this.errors.push(`Maximum recursion depth (${MAX_RECURSION_DEPTH}) exceeded — skipping deeper children`);
      return false;
    }

    let wasModified = false;

    // Check if this object has a body field
    if ('body' in obj && obj.body && typeof obj.body === 'string') {
      const wordCount = this.countWords(obj.body as string);
      this.totalWords += wordCount;

      // Ensure attributes array exists
      if (!('attributes' in obj) || !Array.isArray(obj.attributes)) {
        obj.attributes = [];
        wasModified = true;
      }

      // Find or create word_count attribute
      const attr = this.findOrCreateWordCountAttribute(
        obj.attributes as Record<string, unknown>[]
      );

      // Update if different
      if (attr.value !== wordCount) {
        attr.value = wordCount;
        attr.name = 'Word Count';
        attr.dataType = 'int';
        wasModified = true;
        this.entitiesUpdated++;
      }
    }

    // Process children recursively
    if ('children' in obj && Array.isArray(obj.children)) {
      for (const child of obj.children) {
        if (child && typeof child === 'object') {
          // Check if this is an include directive
          if ('include' in child && typeof child.include === 'string' && options.followIncludes) {
            // Process included file
            const includePath = child.include as string;
            let fullPath: string;
            if (includePath.startsWith('/')) {
              fullPath = path.join(parentDir, includePath);
            } else {
              fullPath = path.resolve(parentDir, includePath);
            }

            // Validate path stays within workspace
            if (!this.isPathWithinRoot(fullPath)) {
              this.errors.push(`Include path escapes workspace boundary: ${path.basename(fullPath)}`);
              continue;
            }

            // Process the included file if not already processed
            if (!this.processedFiles.has(fullPath)) {
              await this.processIncludedFile(fullPath, options);
            }
          } else {
            // Regular child - recurse
            const childModified = await this.updateWordCountInObject(
              child as Record<string, unknown>,
              parentDir,
              options,
              depth + 1
            );
            wasModified = wasModified || childModified;
          }
        }
      }
    }

    return wasModified;
  }

  /**
   * Process an included file
   */
  private async processIncludedFile(filePath: string, options: WordCountOptions): Promise<void> {
    // Mark as processed to avoid infinite loops
    this.processedFiles.add(filePath);

    // Check file exists
    try {
      await fsPromises.access(filePath);
    } catch {
      this.errors.push(`Include file not found: ${path.basename(filePath)}`);
      return;
    }

    // Reject symlinks
    try {
      const stat = await fsPromises.lstat(filePath);
      if (stat.isSymbolicLink()) {
        this.errors.push(`Skipping symlink include: ${path.basename(filePath)}`);
        return;
      }
    } catch {
      this.errors.push(`Cannot stat include file: ${path.basename(filePath)}`);
      return;
    }

    if (!isCodexFile(filePath)) {
      // Skip markdown files in includes for now
      if (isMarkdownFile(filePath)) {
        return;
      }
      this.errors.push(`Include is not a valid codex file: ${path.basename(filePath)}`);
      return;
    }

    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const isJson = filePath.toLowerCase().endsWith('.json');

      let data: Record<string, unknown>;
      if (isJson) {
        data = JSON.parse(content);
      } else {
        data = YAML.parse(content) as Record<string, unknown>;
      }

      const parentDir = path.dirname(filePath);
      const wasModified = await this.updateWordCountInObject(data, parentDir, options);

      if (wasModified) {
        // Save the file
        await this.writeCodexFile(filePath, data, isJson ? 'json' : 'yaml');
        this.filesModified.push(filePath);
        console.log(`[WordCount] Updated included file: ${filePath}`);
      }
    } catch (e) {
      this.errors.push(`Failed to process include "${path.basename(filePath)}"`);
    }
  }

  /**
   * Write codex data to file with proper formatting
   */
  private async writeCodexFile(
    filePath: string,
    data: Record<string, unknown>,
    format: 'yaml' | 'json'
  ): Promise<void> {
    const tmpPath = filePath + '.tmp';
    try {
      let content: string;
      if (format === 'yaml') {
        const doc = new YAML.Document(data);

        // Set block scalar style for long/multiline strings
        const setBlockStyle = (node: unknown, depth: number = 0): void => {
          if (depth > MAX_RECURSION_DEPTH) { return; }
          if (YAML.isMap(node)) {
            for (const pair of node.items) {
              if (YAML.isScalar(pair.value) && typeof pair.value.value === 'string') {
                const str = pair.value.value;
                if (str.includes('\n') || str.length > 80) {
                  pair.value.type = YAML.Scalar.BLOCK_LITERAL;
                }
              } else {
                setBlockStyle(pair.value, depth + 1);
              }
            }
          } else if (YAML.isSeq(node)) {
            for (const item of node.items) {
              setBlockStyle(item, depth + 1);
            }
          }
        };

        setBlockStyle(doc.contents);

        content = doc.toString({ lineWidth: 120 });
      } else {
        content = JSON.stringify(data, null, 2);
      }
      await fsPromises.writeFile(tmpPath, content, 'utf-8');
      await fsPromises.rename(tmpPath, filePath);
    } catch (e) {
      // Clean up temp file on failure
      try { await fsPromises.unlink(tmpPath); } catch { /* ignore */ }
      throw e;
    }
  }

  /**
   * Extract YAML frontmatter from markdown text
   */
  private extractFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
    const trimmed = text.trimStart();

    // Check for frontmatter delimiter
    if (!trimmed.startsWith('---')) {
      return { frontmatter: {}, body: text };
    }

    // Find the closing delimiter
    const afterFirst = trimmed.slice(3);
    const endIndex = afterFirst.indexOf('\n---');

    if (endIndex === -1) {
      return { frontmatter: {}, body: text };
    }

    const frontmatterText = afterFirst.slice(0, endIndex);
    const bodyStart = 3 + endIndex + 4; // "---" + content + "\n---"
    const body = trimmed.slice(bodyStart).trim();

    try {
      const frontmatter = YAML.parse(frontmatterText) as Record<string, unknown>;
      return { frontmatter: frontmatter || {}, body };
    } catch {
      return { frontmatter: {}, body: text };
    }
  }

  /**
   * Serialize frontmatter and body back to markdown format
   */
  private serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
    if (Object.keys(frontmatter).length === 0) {
      return body;
    }

    const fmYaml = YAML.stringify(frontmatter, { lineWidth: 0 }).trim();
    return `---\n${fmYaml}\n---\n\n${body}`;
  }

  /**
   * Update word count in a markdown file
   */
  private async updateWordCountInMarkdown(filePath: string): Promise<boolean> {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const { frontmatter, body } = this.extractFrontmatter(content);

      // Count words in body
      const wordCount = this.countWords(body);
      this.totalWords += wordCount;

      // Check if word_count needs to be updated
      const oldWordCount = frontmatter.word_count;
      if (oldWordCount === wordCount) {
        return false; // No change needed
      }

      // Update word count
      frontmatter.word_count = wordCount;
      this.entitiesUpdated++;

      // Write back to file atomically
      const newContent = this.serializeMarkdown(frontmatter, body);
      const tmpPath = filePath + '.tmp';
      try {
        await fsPromises.writeFile(tmpPath, newContent, 'utf-8');
        await fsPromises.rename(tmpPath, filePath);
      } catch (e) {
        try { await fsPromises.unlink(tmpPath); } catch { /* ignore */ }
        throw e;
      }

      return true;
    } catch (e) {
      this.errors.push(`Failed to update markdown file "${path.basename(filePath)}"`);
      return false;
    }
  }

  /**
   * Update word counts in a codex file
   */
  async updateWordCounts(
    documentUri: vscode.Uri,
    options: WordCountOptions
  ): Promise<WordCountResult> {
    // Reset state
    this.entitiesUpdated = 0;
    this.totalWords = 0;
    this.filesModified = [];
    this.errors = [];
    this.processedFiles = new Set();

    try {
      const inputPath = documentUri.fsPath;
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
      } else {
        this.workspaceRoot = path.dirname(inputPath);
      }

      try {
        await fsPromises.access(inputPath);
      } catch {
        throw new Error(`Input file not found: ${path.basename(inputPath)}`);
      }

      // Mark this file as processed
      this.processedFiles.add(inputPath);

      // Check if this is a markdown file
      if (isMarkdownFile(inputPath)) {
        // Handle Codex Lite (Markdown) format
        const wasModified = await this.updateWordCountInMarkdown(inputPath);

        if (wasModified) {
          this.filesModified.push(inputPath);
        }

        return {
          success: true,
          entitiesUpdated: this.entitiesUpdated,
          totalWords: this.totalWords,
          filesModified: this.filesModified,
          errors: this.errors
        };
      }

      // Handle full Codex format files
      const fileContent = await fsPromises.readFile(inputPath, 'utf-8');
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

      const parentDir = path.dirname(inputPath);

      // Update word counts recursively
      const wasModified = await this.updateWordCountInObject(codexData, parentDir, options);

      if (wasModified) {
        // Save the main file
        await this.writeCodexFile(inputPath, codexData, isJson ? 'json' : 'yaml');
        this.filesModified.push(inputPath);
      }

      return {
        success: true,
        entitiesUpdated: this.entitiesUpdated,
        totalWords: this.totalWords,
        filesModified: this.filesModified,
        errors: this.errors
      };

    } catch (e) {
      return {
        success: false,
        entitiesUpdated: 0,
        totalWords: 0,
        filesModified: [],
        errors: [String(e), ...this.errors]
      };
    }
  }

  /**
   * Get count of nodes with body fields from a codex document text
   */
  static getBodyCount(documentText: string): number {
    try {
      const isJson = documentText.trim().startsWith('{');
      const data = isJson ? JSON.parse(documentText) : YAML.parse(documentText);

      let count = 0;
      const countBodies = (obj: Record<string, unknown>): void => {
        if (obj && typeof obj === 'object') {
          if ('body' in obj && obj.body) {
            count++;
          }
          if ('children' in obj && Array.isArray(obj.children)) {
            for (const child of obj.children) {
              if (child && typeof child === 'object') {
                countBodies(child as Record<string, unknown>);
              }
            }
          }
        }
      };

      countBodies(data);
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Check if document has any include directives
   */
  static hasIncludes(documentText: string): boolean {
    try {
      const isJson = documentText.trim().startsWith('{');
      const data = isJson ? JSON.parse(documentText) : YAML.parse(documentText);

      const checkIncludes = (obj: Record<string, unknown>): boolean => {
        if (obj && typeof obj === 'object') {
          if ('include' in obj) {
            return true;
          }
          if ('children' in obj && Array.isArray(obj.children)) {
            for (const child of obj.children) {
              if (child && typeof child === 'object') {
                if (checkIncludes(child as Record<string, unknown>)) {
                  return true;
                }
              }
            }
          }
        }
        return false;
      };

      return checkIncludes(data);
    } catch {
      return false;
    }
  }
}

/**
 * Output channel for word count logs
 */
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('ChapterWise Codex Word Count');
  }
  return outputChannel;
}

/**
 * Run the Update Word Count command
 */
export async function runUpdateWordCount(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage('No active editor. Open a Codex file first.');
    return;
  }

  if (!isCodexLikeFile(editor.document.fileName)) {
    vscode.window.showErrorMessage('Current file is not a Codex file (.codex.yaml, .codex.json, .codex, or .md)');
    return;
  }

  // Save the document first to ensure we're working with latest content
  if (editor.document.isDirty) {
    await editor.document.save();
  }

  const documentText = editor.document.getText();
  const documentUri = editor.document.uri;
  const isMarkdown = isMarkdownFile(editor.document.fileName);

  // Check if document has includes (only for full Codex files)
  const hasIncludes = !isMarkdown && WordCounter.hasIncludes(documentText);
  let followIncludes = false;

  if (hasIncludes) {
    const choice = await vscode.window.showInformationMessage(
      'This document has include directives. Also update word counts in included files?',
      'Yes, Include All Files',
      'No, Just This File'
    );

    if (!choice) {
      return; // User cancelled
    }

    followIncludes = choice.includes('Yes');
  }

  // Build options
  const options: WordCountOptions = {
    followIncludes
  };

  // Run with progress
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Updating Word Counts...',
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: 'Counting words...' });

      const counter = new WordCounter();
      return await counter.updateWordCounts(documentUri, options);
    }
  );

  // Log results
  const channel = getOutputChannel();
  channel.appendLine(`\n${'='.repeat(60)}`);
  channel.appendLine(`Update Word Count - ${new Date().toLocaleString()}`);
  channel.appendLine(`File: ${documentUri.fsPath}`);
  channel.appendLine(`Follow Includes: ${options.followIncludes}`);
  channel.appendLine(`${'='.repeat(60)}`);

  if (result.success) {
    channel.appendLine(`✅ Success!`);
    channel.appendLine(`  Nodes updated: ${result.entitiesUpdated}`);
    channel.appendLine(`  Total words: ${result.totalWords.toLocaleString()}`);

    if (result.filesModified.length > 0) {
      channel.appendLine(`\nFiles modified:`);
      result.filesModified.forEach((f, i) => {
        channel.appendLine(`  ${i + 1}. ${f}`);
      });
    }

    if (result.errors.length > 0) {
      channel.appendLine(`\nWarnings:`);
      result.errors.forEach(e => channel.appendLine(`  - ${e}`));
    }

    // Show success message
    const message = result.entitiesUpdated > 0
      ? `✅ Updated word counts for ${result.entitiesUpdated} nodes (${result.totalWords.toLocaleString()} total words)`
      : `No changes needed (${result.totalWords.toLocaleString()} total words)`;

    const action = await vscode.window.showInformationMessage(
      message,
      'Show Details'
    );

    if (action === 'Show Details') {
      channel.show();
    }

    // Reload the document to show changes
    if (result.filesModified.includes(documentUri.fsPath)) {
      // Revert and reload the document to show updated content
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }

  } else {
    channel.appendLine(`❌ Failed!`);
    result.errors.forEach(e => channel.appendLine(`  Error: ${e}`));

    vscode.window.showErrorMessage(
      `Word count update failed: ${result.errors[0]}`,
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
export function disposeWordCount(): void {
  outputChannel?.dispose();
}


































































