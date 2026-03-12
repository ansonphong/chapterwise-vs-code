/**
 * Convert Format - Codex ↔ Markdown (Codex Lite) Conversion
 * 
 * Two-way conversion between full Codex format and Codex Lite (Markdown with YAML frontmatter).
 * 
 * Commands:
 * - Convert Codex to Markdown: .codex.yaml → .md
 * - Convert Markdown to Codex: .md → .codex.yaml
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { isCodexFile, generateUuid } from './codexModel';

/**
 * Threshold for using YAML block scalar style (consistent with codexModel.ts)
 */
const BLOCK_SCALAR_THRESHOLD = 60;

/**
 * Codex Lite field mappings
 * These fields map directly between codex root and markdown frontmatter
 */
const CODEX_LITE_ROOT_FIELDS = new Set([
  'type', 'name', 'title', 'summary', 'id',
  'status', 'featured', 'image', 'images', 'tags', 'body'
]);

const CODEX_LITE_METADATA_FIELDS: Record<string, string> = {
  'author': 'author',
  'updated': 'last_updated',
  'description': 'description',
  'license': 'license'
};

/**
 * Options for conversion
 */
export interface ConvertOptions {
  keepOriginal: boolean;
  outputFormat?: 'yaml' | 'json';  // Only for MD → Codex
}

/**
 * Result of conversion
 */
export interface ConvertResult {
  success: boolean;
  outputPath?: string;
  warnings: string[];
  error?: string;
}

/**
 * Codex ↔ Markdown Converter
 */
export class CodexMarkdownConverter {

  /**
   * Convert Codex to Markdown (Codex Lite)
   * 
   * Extracts frontmatter fields and body from codex format,
   * creates a standard markdown file with YAML frontmatter.
   */
  convertCodexToMarkdown(codexData: Record<string, unknown>): { markdown: string; warnings: string[] } {
    const warnings: string[] = [];
    const frontmatter: Record<string, unknown> = {};

    // Check for children - they won't be converted
    if (codexData.children && Array.isArray(codexData.children) && codexData.children.length > 0) {
      warnings.push(`This codex has ${codexData.children.length} children that will not be included in the markdown file.`);
    }

    // Map root fields to frontmatter
    for (const field of CODEX_LITE_ROOT_FIELDS) {
      if (field === 'body') continue; // Body goes after frontmatter
      if (codexData[field] !== undefined && codexData[field] !== null) {
        // Handle tags - convert array to comma-delimited if simple strings
        if (field === 'tags' && Array.isArray(codexData[field])) {
          const tags = codexData[field] as unknown[];
          if (tags.every(t => typeof t === 'string')) {
            frontmatter[field] = tags.join(', ');
          } else {
            frontmatter[field] = tags;
          }
        } else {
          frontmatter[field] = codexData[field];
        }
      }
    }

    // Map metadata fields to frontmatter
    const metadata = codexData.metadata as Record<string, unknown> | undefined;
    if (metadata) {
      for (const [codexKey, fmKey] of Object.entries(CODEX_LITE_METADATA_FIELDS)) {
        if (metadata[codexKey] !== undefined && metadata[codexKey] !== null) {
          frontmatter[fmKey] = metadata[codexKey];
        }
      }
    }

    // Map attributes to frontmatter (if any)
    const attributes = codexData.attributes as Array<{ key: string; value: unknown }> | undefined;
    if (attributes && Array.isArray(attributes)) {
      for (const attr of attributes) {
        if (attr.key && attr.value !== undefined) {
          frontmatter[attr.key] = attr.value;
        }
      }
    }

    // Build markdown content
    let markdown = '';

    // Add frontmatter if we have any fields
    if (Object.keys(frontmatter).length > 0) {
      const fmYaml = YAML.stringify(frontmatter, { lineWidth: 0 }).trim();
      markdown = `---\n${fmYaml}\n---\n\n`;
    }

    // Add title as H1 if we have name/title
    const title = (codexData.name || codexData.title) as string | undefined;
    if (title) {
      markdown += `# ${title}\n\n`;
    }

    // Add body content
    const body = codexData.body as string | undefined;
    if (body) {
      markdown += body.trim() + '\n';
    }

    return { markdown, warnings };
  }

  /**
   * Convert Markdown (Codex Lite) to Codex
   * 
   * Parses YAML frontmatter and body from markdown,
   * maps fields to proper codex structure.
   */
  convertMarkdownToCodex(mdContent: string, sourceFileName: string): { codex: Record<string, unknown>; warnings: string[] } {
    const warnings: string[] = [];
    
    // Extract frontmatter
    const { frontmatter, body } = this.extractFrontmatter(mdContent);

    // Extract title from first H1 if not in frontmatter
    let title = frontmatter.name || frontmatter.title;
    let bodyContent = body;
    
    if (!title) {
      const h1Match = body.match(/^#\s+(.+)$/m);
      if (h1Match) {
        title = h1Match[1].trim();
        // Remove H1 from body since it becomes the title
        bodyContent = body.replace(/^#\s+.+\n*/, '').trim();
      }
    }

    // Build codex structure
    const basename = path.basename(sourceFileName, path.extname(sourceFileName));
    
    const codex: Record<string, unknown> = {
      metadata: {
        formatVersion: '1.1',
        documentVersion: '1.0.0',
        created: new Date().toISOString(),
        source: 'markdown-lite',
        sourceFile: path.basename(sourceFileName)
      },
      type: frontmatter.type || 'document',
      name: frontmatter.name || title || basename,
      title: title || basename
    };

    // Map metadata fields from frontmatter
    const metadata = codex.metadata as Record<string, unknown>;
    if (frontmatter.author) {
      metadata.author = frontmatter.author;
    }
    if (frontmatter.last_updated) {
      metadata.updated = frontmatter.last_updated;
    }
    if (frontmatter.description) {
      metadata.description = frontmatter.description;
    }
    if (frontmatter.license) {
      metadata.license = frontmatter.license;
    }

    // Map root fields
    if (frontmatter.summary) {
      codex.summary = frontmatter.summary;
    }
    if (frontmatter.id) {
      codex.id = frontmatter.id;
    } else {
      codex.id = generateUuid();
    }
    if (frontmatter.status) {
      codex.status = frontmatter.status;
    }
    if (frontmatter.featured !== undefined) {
      codex.featured = Boolean(frontmatter.featured);
    }
    if (frontmatter.image) {
      codex.image = frontmatter.image;
    }
    if (frontmatter.images) {
      codex.images = frontmatter.images;
    }

    // Handle tags - support comma-delimited string or array
    if (frontmatter.tags) {
      codex.tags = this.parseTags(frontmatter.tags);
    }

    // Add body
    if (bodyContent && bodyContent.trim()) {
      codex.body = bodyContent.trim();
    }

    // Collect remaining frontmatter fields as attributes
    const attributes: Array<{ key: string; name: string; value: unknown }> = [];
    const knownFields = new Set([
      ...CODEX_LITE_ROOT_FIELDS,
      ...Object.values(CODEX_LITE_METADATA_FIELDS),
      'author', 'last_updated', 'description', 'license'
    ]);

    for (const [key, value] of Object.entries(frontmatter)) {
      if (!knownFields.has(key)) {
        attributes.push({
          key,
          name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          value
        });
      }
    }

    if (attributes.length > 0) {
      codex.attributes = attributes;
    }

    return { codex, warnings };
  }

  /**
   * Extract YAML frontmatter from markdown content
   * Uses indexOf to properly handle '---' that may appear in body content
   */
  private extractFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
    let frontmatter: Record<string, unknown> = {};
    let body = content;

    // Check for frontmatter delimiter at start of file
    if (!content.startsWith('---')) {
      return { frontmatter, body };
    }

    // Find the end of frontmatter (next --- after the opening one)
    const afterFirst = content.slice(3);
    const endIndex = afterFirst.indexOf('\n---');

    if (endIndex === -1) {
      // No closing delimiter found
      return { frontmatter, body };
    }

    const fmText = afterFirst.slice(0, endIndex).trim();
    body = afterFirst.slice(endIndex + 4).trim(); // +4 to skip '\n---'

    try {
      frontmatter = YAML.parse(fmText) || {};
    } catch (e) {
      console.warn('Failed to parse frontmatter:', e);
      // Return original content if parsing fails
      return { frontmatter: {}, body: content };
    }

    return { frontmatter, body };
  }

  /**
   * Parse tags from various formats
   */
  private parseTags(tags: unknown): string[] {
    if (typeof tags === 'string') {
      return tags.split(',').map(t => t.trim()).filter(t => t);
    } else if (Array.isArray(tags)) {
      return tags.map(t => typeof t === 'string' ? t : String(t));
    }
    return [];
  }
}

/**
 * Output channel for conversion logs
 */
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('ChapterWise Format Converter');
  }
  return outputChannel;
}

/**
 * Run Convert Codex to Markdown command
 */
export async function runConvertToMarkdown(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage('No active editor. Open a Codex file first.');
    return;
  }

  const filePath = editor.document.fileName;
  if (!isCodexFile(filePath)) {
    vscode.window.showErrorMessage('Current file is not a Codex file (.codex.yaml, .codex.json, or .codex)');
    return;
  }

  // Parse codex file
  const documentText = editor.document.getText();
  let codexData: Record<string, unknown>;
  
  try {
    const isJson = filePath.toLowerCase().endsWith('.json');
    codexData = isJson ? JSON.parse(documentText) : YAML.parse(documentText);
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to parse codex file: ${e}`);
    return;
  }

  // Check for children and warn
  const children = codexData.children as unknown[] | undefined;
  if (children && children.length > 0) {
    const proceed = await vscode.window.showWarningMessage(
      `This codex has ${children.length} children. Only root fields will be converted to markdown. Children will be ignored.`,
      { modal: true },
      'Continue Anyway'
    );
    if (!proceed) {
      return;
    }
  }

  // Ask to keep original
  const keepChoice = await vscode.window.showQuickPick(
    [
      { label: '$(check) Keep Original File', description: 'Create markdown alongside the codex file', value: true },
      { label: '$(trash) Delete Original File', description: 'Replace codex with markdown', value: false }
    ],
    {
      title: 'Convert to Markdown - Keep Original?',
      placeHolder: 'Should the original codex file be kept?'
    }
  );

  if (!keepChoice) {
    return; // Cancelled
  }

  // Convert
  const converter = new CodexMarkdownConverter();
  const { markdown, warnings } = converter.convertCodexToMarkdown(codexData);

  // Determine output path
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath)
    .replace(/\.codex\.yaml$/i, '')
    .replace(/\.codex\.json$/i, '')
    .replace(/\.codex$/i, '');
  const outputPath = path.join(dir, `${baseName}.md`);

  // Check if output exists
  if (fs.existsSync(outputPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `File already exists: ${path.basename(outputPath)}`,
      { modal: true },
      'Overwrite'
    );
    if (!overwrite) {
      return;
    }
  }

  // Write markdown file
  try {
    fs.writeFileSync(outputPath, markdown, 'utf-8');
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to write markdown file: ${e}`);
    return;
  }

  // Delete original if requested
  if (!keepChoice.value) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      vscode.window.showWarningMessage(`Created markdown but failed to delete original: ${e}`);
    }
  }

  // Log results
  const channel = getOutputChannel();
  channel.appendLine(`\n${'='.repeat(50)}`);
  channel.appendLine(`Convert to Markdown - ${new Date().toLocaleString()}`);
  channel.appendLine(`Input: ${filePath}`);
  channel.appendLine(`Output: ${outputPath}`);
  channel.appendLine(`Kept original: ${keepChoice.value}`);
  if (warnings.length > 0) {
    channel.appendLine(`Warnings:`);
    warnings.forEach(w => channel.appendLine(`  - ${w}`));
  }
  channel.appendLine(`${'='.repeat(50)}`);

  // Show success and open file
  const action = await vscode.window.showInformationMessage(
    `✅ Converted to markdown: ${path.basename(outputPath)}`,
    'Open File',
    'Show Log'
  );

  if (action === 'Open File') {
    const doc = await vscode.workspace.openTextDocument(outputPath);
    await vscode.window.showTextDocument(doc);
  } else if (action === 'Show Log') {
    channel.show();
  }
}

/**
 * Run Convert Markdown to Codex command
 */
export async function runConvertToCodex(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage('No active editor. Open a Markdown file first.');
    return;
  }

  const filePath = editor.document.fileName;
  if (!filePath.toLowerCase().endsWith('.md')) {
    vscode.window.showErrorMessage('Current file is not a Markdown file (.md)');
    return;
  }

  const documentText = editor.document.getText();

  // Ask for output format
  const formatChoice = await vscode.window.showQuickPick(
    [
      { label: '$(file-code) YAML (.codex.yaml)', description: 'Human-readable YAML format', value: 'yaml' as const },
      { label: '$(json) JSON (.codex.json)', description: 'JSON format', value: 'json' as const }
    ],
    {
      title: 'Convert to Codex - Output Format',
      placeHolder: 'Select output format'
    }
  );

  if (!formatChoice) {
    return; // Cancelled
  }

  // Ask to keep original
  const keepChoice = await vscode.window.showQuickPick(
    [
      { label: '$(check) Keep Original File', description: 'Create codex alongside the markdown file', value: true },
      { label: '$(trash) Delete Original File', description: 'Replace markdown with codex', value: false }
    ],
    {
      title: 'Convert to Codex - Keep Original?',
      placeHolder: 'Should the original markdown file be kept?'
    }
  );

  if (!keepChoice) {
    return; // Cancelled
  }

  // Convert
  const converter = new CodexMarkdownConverter();
  const { codex, warnings } = converter.convertMarkdownToCodex(documentText, filePath);

  // Determine output path
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, '.md');
  const ext = formatChoice.value === 'yaml' ? '.codex.yaml' : '.codex.json';
  const outputPath = path.join(dir, `${baseName}${ext}`);

  // Check if output exists
  if (fs.existsSync(outputPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `File already exists: ${path.basename(outputPath)}`,
      { modal: true },
      'Overwrite'
    );
    if (!overwrite) {
      return;
    }
  }

  // Write codex file
  try {
    let content: string;
    if (formatChoice.value === 'yaml') {
      const doc = new YAML.Document(codex);
      // Set block style for multiline strings
      const setBlockStyle = (node: unknown): void => {
        if (YAML.isMap(node)) {
          for (const pair of node.items) {
            if (YAML.isScalar(pair.value) && typeof pair.value.value === 'string') {
              const str = pair.value.value;
              if (str.includes('\n') || str.length > BLOCK_SCALAR_THRESHOLD) {
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
      content = doc.toString({ lineWidth: 120 });
    } else {
      content = JSON.stringify(codex, null, 2);
    }
    
    fs.writeFileSync(outputPath, content, 'utf-8');
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to write codex file: ${e}`);
    return;
  }

  // Delete original if requested
  if (!keepChoice.value) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      vscode.window.showWarningMessage(`Created codex but failed to delete original: ${e}`);
    }
  }

  // Log results
  const channel = getOutputChannel();
  channel.appendLine(`\n${'='.repeat(50)}`);
  channel.appendLine(`Convert to Codex - ${new Date().toLocaleString()}`);
  channel.appendLine(`Input: ${filePath}`);
  channel.appendLine(`Output: ${outputPath}`);
  channel.appendLine(`Format: ${formatChoice.value.toUpperCase()}`);
  channel.appendLine(`Kept original: ${keepChoice.value}`);
  if (warnings.length > 0) {
    channel.appendLine(`Warnings:`);
    warnings.forEach(w => channel.appendLine(`  - ${w}`));
  }
  channel.appendLine(`${'='.repeat(50)}`);

  // Show success and open file
  const action = await vscode.window.showInformationMessage(
    `✅ Converted to codex: ${path.basename(outputPath)}`,
    'Open File',
    'Show Log'
  );

  if (action === 'Open File') {
    const doc = await vscode.workspace.openTextDocument(outputPath);
    await vscode.window.showTextDocument(doc);
  } else if (action === 'Show Log') {
    channel.show();
  }
}

/**
 * Dispose of resources
 */
export function disposeConvertFormat(): void {
  outputChannel?.dispose();
}































































