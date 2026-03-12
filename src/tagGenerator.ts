/**
 * Tag Generator - Extract tags from body fields in Codex files
 *
 * Ported from Python: chapterwise-app/agent_worker/tags/tag_generator.py
 *
 * Features:
 * - Unicode normalization and HTML/markdown cleanup
 * - Extended Latin tokenization with hyphen/apostrophe support
 * - Comprehensive stopword filtering + manuscript boilerplate
 * - Unigram and bigram extraction with heading boost
 * - Smart capitalization and redundancy avoidance
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { isCodexFile, isMarkdownFile } from './codexModel';

/**
 * Options for tag generation
 */
export interface TagGeneratorOptions {
  format: 'simple' | 'detailed';  // Output format (strings vs objects)
  maxTags: number;                 // Maximum tags to generate (default: 10, max: 100)
  minCount: number;                // Minimum occurrences required (default: 3)
  followIncludes: boolean;         // Process included files too
}

/**
 * Result of tag generation
 */
export interface TagGeneratorResult {
  success: boolean;
  entitiesUpdated: number;
  totalTagsGenerated: number;
  filesModified: string[];
  errors: string[];
}

/**
 * Tag with count
 */
interface TagWithCount {
  name: string;
  count: number;
}

/**
 * Comprehensive stopwords set (from Python implementation)
 */
const STOPWORDS = new Set([
  // Common English stopwords
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'not', 'are', 'was', 'were', 'but', 'you', 'your', 'his', 'her', 'their', 'its', 'our',
  'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'into', 'about', 'over', 'under', 'between', 'across', 'through', 'after', 'before',
  'then', 'than', 'because', 'while', 'where', 'when', 'what', 'which', 'who', 'whom', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'only', 'own', 'same', 'so', 'too', 'very', 'just', 'also', 'if', 'in', 'on', 'at', 'by', 'of', 'to', 'as', 'it', 'is', 'be', 'do', 'did',
  'does', 'done', 'an', 'a', 'or', 'he', 'she', 'they', 'them', 'we', 'i', 'me', 'my', 'mine', 'yours', 'theirs', 'ours', 'these', 'those', 'there', 'here',
  // Manuscript boilerplate
  'chapter', 'preface', 'acknowledgements', 'acknowledgments', 'introduction', 'editor', 'notes', 'bibliography', 'appendix', 'contents',
  // Additional common words
  'been', 'being', 'above', 'below', 'during', 'until', 'against', 'among', 'throughout', 'despite', 'towards', 'upon', 'whether',
  'however', 'therefore', 'thus', 'hence', 'although', 'though', 'even', 'still', 'yet', 'already', 'always', 'never', 'often', 'sometimes',
  'now', 'well', 'back', 'away', 'again', 'once', 'every', 'much', 'many', 'another', 'first', 'last', 'next', 'new', 'old', 'great', 'good',
  'high', 'long', 'little', 'own', 'right', 'left', 'part', 'place', 'case', 'week', 'work', 'world', 'area', 'home', 'hand', 'room', 'fact',
  'going', 'came', 'come', 'made', 'make', 'take', 'took', 'know', 'knew', 'think', 'thought', 'see', 'saw', 'want', 'give', 'gave', 'use', 'used',
  'find', 'found', 'tell', 'told', 'ask', 'asked', 'seem', 'seemed', 'feel', 'felt', 'try', 'tried', 'leave', 'left', 'call', 'called', 'need',
  'keep', 'kept', 'let', 'begin', 'began', 'seem', 'help', 'show', 'showed', 'hear', 'heard', 'play', 'run', 'ran', 'move', 'moved', 'live', 'lived',
  'believe', 'hold', 'held', 'bring', 'brought', 'happen', 'happened', 'write', 'wrote', 'provide', 'sit', 'sat', 'stand', 'stood', 'lose', 'lost',
  'pay', 'paid', 'meet', 'met', 'include', 'included', 'continue', 'continued', 'set', 'learn', 'learned', 'change', 'changed', 'lead', 'led',
  'understand', 'understood', 'watch', 'watched', 'follow', 'followed', 'stop', 'stopped', 'create', 'created', 'speak', 'spoke', 'read',
  'allow', 'allowed', 'add', 'added', 'spend', 'spent', 'grow', 'grew', 'open', 'opened', 'walk', 'walked', 'win', 'won', 'offer', 'offered',
  'remember', 'remembered', 'love', 'loved', 'consider', 'considered', 'appear', 'appeared', 'buy', 'bought', 'wait', 'waited', 'serve', 'served',
  'die', 'died', 'send', 'sent', 'expect', 'expected', 'build', 'built', 'stay', 'stayed', 'fall', 'fell', 'cut', 'reach', 'reached', 'kill', 'killed',
  'remain', 'remained', 'suggest', 'suggested', 'raise', 'raised', 'pass', 'passed', 'sell', 'sold', 'require', 'required', 'report', 'reported',
  'decide', 'decided', 'pull', 'pulled'
]);

/**
 * Tag Generator class
 */
export class TagGenerator {
  private entitiesUpdated: number = 0;
  private totalTagsGenerated: number = 0;
  private filesModified: string[] = [];
  private errors: string[] = [];
  private processedFiles: Set<string> = new Set();

  /**
   * Normalize a token (lowercase, trim, basic plural removal)
   */
  private normalizeToken(word: string): string {
    let w = word.replace(/^[-'_]+|[-'_]+$/g, '');
    let lw = w.toLowerCase();

    // Basic plural trim
    if (lw.length > 4 && lw.endsWith('s') && !lw.endsWith('ss')) {
      lw = lw.slice(0, -1);
    }
    if (lw.endsWith("'s")) {
      lw = lw.slice(0, -2);
    }

    return lw;
  }

  /**
   * Smart display name with proper capitalization
   */
  private displayName(name: string): string {
    if (name.includes(' ')) {
      // Title-case phrases
      return name.split(' ').map(part =>
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join(' ');
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Extract tags from markdown text
   * Handles markdown-specific cleanup and heading detection
   */
  computeTagsFromMarkdown(text: string, maxTags: number, minCount: number): TagWithCount[] {
    if (!text) {
      return [];
    }

    // Remove fenced code blocks and inline code
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text.replace(/`[^`]*`/g, ' ');

    // Remove markdown images and links
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    text = text.replace(/\[[^\]]*\]\([^)]*\)/g, ' ');

    // Split into lines to detect headings
    const lines = text.split('\n');
    const headingParts: string[] = [];
    const bodyParts: string[] = [];

    for (const line of lines) {
      const stripped = line.trim();
      if (stripped.startsWith('#')) {
        // Remove heading markers and collect for boosting
        const clean = stripped.replace(/^#+\s*/, '');
        headingParts.push(clean);
      } else {
        bodyParts.push(stripped);
      }
    }

    const bodyText = bodyParts.join('\n');
    const headingBoostText = headingParts.join('\n');

    return this.computeTags(bodyText, maxTags, minCount, headingBoostText);
  }

  /**
   * Main tag extraction function
   */
  computeTags(text: string, maxTags: number, minCount: number, headingBoostText: string = ''): TagWithCount[] {
    if (!text) {
      return [];
    }

    try {
      // Normalize Unicode punctuation (smart quotes, etc.)
      text = text.replace(/\u2019/g, "'").replace(/\u2018/g, "'")
                 .replace(/\u201c/g, '"').replace(/\u201d/g, '"');

      // Strip HTML tags and normalize whitespace
      text = text.replace(/<[^>]+>/g, ' ');
      text = text.replace(/\s+/g, ' ').trim();

      // Tokenization pattern (Unicode letters with hyphen/apostrophe inside)
      // Uses Unicode property escapes to support all scripts (Latin, CJK, Cyrillic, Arabic, etc.)
      const tokenPattern = /\p{L}[\p{L}'\-]*/gu;

      // Validation pattern for token content (must contain at least one Unicode letter)
      const hasLetterPattern = /\p{L}/u;

      // Extract main body tokens
      const bodyTokensRaw = text.match(tokenPattern) || [];
      let bodyTokens = bodyTokensRaw
        .filter(t => t.length >= 2) // Lowered to 2 for CJK (single CJK char can be meaningful)
        .map(t => this.normalizeToken(t))
        .filter(t => hasLetterPattern.test(t) && !STOPWORDS.has(t));

      // Extract heading tokens for boosting
      let headingTokens: string[] = [];
      if (headingBoostText) {
        const headingTokensRaw = headingBoostText.match(tokenPattern) || [];
        headingTokens = headingTokensRaw
          .filter(t => t.length >= 2)
          .map(t => this.normalizeToken(t))
          .filter(t => hasLetterPattern.test(t) && !STOPWORDS.has(t));
      }

      // Unigram counts with heading boost
      const counts = new Map<string, number>();
      for (const token of bodyTokens) {
        counts.set(token, (counts.get(token) || 0) + 1);
      }
      for (const ht of headingTokens) {
        counts.set(ht, (counts.get(ht) || 0) + 2); // Boost headings
      }

      // Bigrams (phrases) with heading boost
      const phrases = new Map<string, number>();

      const buildBigrams = (tokens: string[], boost: number = 1): void => {
        for (let i = 0; i < tokens.length - 1; i++) {
          const a = tokens[i];
          const b = tokens[i + 1];
          if (STOPWORDS.has(a) || STOPWORDS.has(b)) {
            continue;
          }
          if (a.length < 3 || b.length < 3) {
            continue;
          }
          const phrase = `${a} ${b}`;
          phrases.set(phrase, (phrases.get(phrase) || 0) + boost);
        }
      };

      buildBigrams(bodyTokens, 1);
      if (headingTokens.length > 0) {
        buildBigrams(headingTokens, 2); // Boost heading phrases
      }

      // Sort by count
      const phraseItems = [...phrases.entries()]
        .filter(([, c]) => c >= minCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxTags * 2);

      const wordItems = [...counts.entries()]
        .filter(([, c]) => c >= minCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxTags * 2);

      // Merge, avoiding redundancy
      const selected: [string, number][] = [];
      const usedWords = new Set<string>();

      // Prioritize phrases
      for (const [phrase, count] of phraseItems) {
        if (count <= 0) continue;
        selected.push([phrase, count]);
        const [a, b] = phrase.split(' ');
        usedWords.add(a);
        usedWords.add(b);
        if (selected.length >= maxTags) break;
      }

      // Add unigrams if space remains
      if (selected.length < maxTags) {
        for (const [word, count] of wordItems) {
          if (count <= 0) continue;
          if (usedWords.has(word)) continue; // Skip if part of selected phrase
          selected.push([word, count]);
          if (selected.length >= maxTags) break;
        }
      }

      // Convert to output format with smart capitalization
      return selected.map(([name, count]) => ({
        name: this.displayName(name),
        count
      }));

    } catch (e) {
      console.error('[TagGenerator] Tag extraction failed:', e);
      return [];
    }
  }

  /**
   * Update tags in an object and its children recursively
   */
  private updateTagsInObject(
    obj: Record<string, unknown>,
    parentDir: string,
    options: TagGeneratorOptions
  ): boolean {
    let wasModified = false;

    // Check if this object has a body field
    if ('body' in obj && obj.body && typeof obj.body === 'string') {
      // Generate tags from body (using markdown-aware extraction)
      const generatedTags = this.computeTagsFromMarkdown(
        obj.body as string,
        options.maxTags,
        options.minCount
      );

      if (generatedTags.length > 0) {
        // Convert to appropriate format
        if (options.format === 'simple') {
          obj.tags = generatedTags.map(t => t.name);
        } else {
          obj.tags = generatedTags;
        }

        wasModified = true;
        this.entitiesUpdated++;
        this.totalTagsGenerated += generatedTags.length;
      }
    }

    // Process children recursively
    if ('children' in obj && Array.isArray(obj.children)) {
      for (const child of obj.children) {
        if (child && typeof child === 'object') {
          // Check if this is an include directive
          if ('include' in child && typeof child.include === 'string' && options.followIncludes) {
            const includePath = child.include as string;
            let fullPath: string;
            if (includePath.startsWith('/')) {
              fullPath = path.join(parentDir, includePath);
            } else {
              fullPath = path.resolve(parentDir, includePath);
            }

            if (!this.processedFiles.has(fullPath)) {
              this.processIncludedFile(fullPath, options);
            }
          } else {
            const childModified = this.updateTagsInObject(
              child as Record<string, unknown>,
              parentDir,
              options
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
  private processIncludedFile(filePath: string, options: TagGeneratorOptions): void {
    this.processedFiles.add(filePath);

    if (!fs.existsSync(filePath)) {
      this.errors.push(`Include file not found: ${filePath}`);
      return;
    }

    if (!isCodexFile(filePath)) {
      this.errors.push(`Include is not a valid codex file: ${filePath}`);
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const isJson = filePath.toLowerCase().endsWith('.json');

      let data: Record<string, unknown>;
      if (isJson) {
        data = JSON.parse(content);
      } else {
        data = YAML.parse(content) as Record<string, unknown>;
      }

      const parentDir = path.dirname(filePath);
      const wasModified = this.updateTagsInObject(data, parentDir, options);

      if (wasModified) {
        this.writeCodexFile(filePath, data, isJson ? 'json' : 'yaml');
        this.filesModified.push(filePath);
        console.log(`[TagGenerator] Updated included file: ${filePath}`);
      }
    } catch (e) {
      this.errors.push(`Failed to process include "${filePath}": ${e}`);
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
   * Extract YAML frontmatter from markdown content
   */
  private extractFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
    const trimmed = content.trimStart();

    if (!trimmed.startsWith('---')) {
      return { frontmatter: {}, body: content };
    }

    const afterFirst = trimmed.slice(3);
    const endIndex = afterFirst.indexOf('\n---');

    if (endIndex === -1) {
      return { frontmatter: {}, body: content };
    }

    const fmText = afterFirst.slice(0, endIndex);
    const body = afterFirst.slice(endIndex + 4).trim();

    try {
      const frontmatter = YAML.parse(fmText) as Record<string, unknown> || {};
      return { frontmatter, body };
    } catch {
      return { frontmatter: {}, body: content };
    }
  }

  /**
   * Serialize frontmatter and body back to markdown format
   */
  private serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
    if (Object.keys(frontmatter).length === 0) {
      return body;
    }

    const fmYaml = YAML.stringify(frontmatter).trim();
    return `---\n${fmYaml}\n---\n\n${body}`;
  }

  /**
   * Generate tags for a Markdown (Codex Lite) file
   */
  private generateTagsForMarkdown(
    inputPath: string,
    options: TagGeneratorOptions
  ): boolean {
    try {
      const content = fs.readFileSync(inputPath, 'utf-8');
      const { frontmatter, body } = this.extractFrontmatter(content);

      // If no frontmatter, we can't add tags properly
      if (Object.keys(frontmatter).length === 0) {
        this.errors.push(`No frontmatter found in: ${inputPath}`);
        return false;
      }

      // Generate tags from body content
      const generatedTags = this.computeTagsFromMarkdown(body, options.maxTags, options.minCount);

      if (generatedTags.length === 0) {
        return false;
      }

      // Convert to appropriate format
      if (options.format === 'simple') {
        frontmatter.tags = generatedTags.map(t => t.name);
      } else {
        frontmatter.tags = generatedTags;
      }

      this.entitiesUpdated++;
      this.totalTagsGenerated += generatedTags.length;

      // Write back to file
      const newContent = this.serializeMarkdown(frontmatter, body);
      fs.writeFileSync(inputPath, newContent, 'utf-8');

      return true;
    } catch (e) {
      this.errors.push(`Failed to process markdown file '${inputPath}': ${e}`);
      return false;
    }
  }

  /**
   * Generate tags in a codex or markdown file
   */
  async generateTags(
    documentUri: vscode.Uri,
    options: TagGeneratorOptions
  ): Promise<TagGeneratorResult> {
    // Reset state
    this.entitiesUpdated = 0;
    this.totalTagsGenerated = 0;
    this.filesModified = [];
    this.errors = [];
    this.processedFiles = new Set();

    try {
      const inputPath = documentUri.fsPath;
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
      }

      this.processedFiles.add(inputPath);

      // Handle Markdown (Codex Lite) files
      if (isMarkdownFile(inputPath)) {
        const wasModified = this.generateTagsForMarkdown(inputPath, options);

        if (wasModified) {
          this.filesModified.push(inputPath);
        }

        return {
          success: true,
          entitiesUpdated: this.entitiesUpdated,
          totalTagsGenerated: this.totalTagsGenerated,
          filesModified: this.filesModified,
          errors: this.errors
        };
      }

      // Handle full Codex files
      const fileContent = fs.readFileSync(inputPath, 'utf-8');
      const isJson = inputPath.toLowerCase().endsWith('.json');

      let codexData: Record<string, unknown>;
      if (isJson) {
        codexData = JSON.parse(fileContent);
      } else {
        codexData = YAML.parse(fileContent) as Record<string, unknown>;
      }

      if (!codexData || typeof codexData !== 'object') {
        throw new Error('Invalid codex file structure');
      }

      const parentDir = path.dirname(inputPath);
      const wasModified = this.updateTagsInObject(codexData, parentDir, options);

      if (wasModified) {
        this.writeCodexFile(inputPath, codexData, isJson ? 'json' : 'yaml');
        this.filesModified.push(inputPath);
      }

      return {
        success: true,
        entitiesUpdated: this.entitiesUpdated,
        totalTagsGenerated: this.totalTagsGenerated,
        filesModified: this.filesModified,
        errors: this.errors
      };

    } catch (e) {
      return {
        success: false,
        entitiesUpdated: 0,
        totalTagsGenerated: 0,
        filesModified: [],
        errors: [String(e), ...this.errors]
      };
    }
  }

  /**
   * Check if document has any body fields
   */
  static hasBodyFields(documentText: string): boolean {
    try {
      const isJson = documentText.trim().startsWith('{');
      const data = isJson ? JSON.parse(documentText) : YAML.parse(documentText);

      const checkBody = (obj: Record<string, unknown>): boolean => {
        if (obj && typeof obj === 'object') {
          if ('body' in obj && obj.body) {
            return true;
          }
          if ('children' in obj && Array.isArray(obj.children)) {
            for (const child of obj.children) {
              if (child && typeof child === 'object') {
                if (checkBody(child as Record<string, unknown>)) {
                  return true;
                }
              }
            }
          }
        }
        return false;
      };

      return checkBody(data);
    } catch {
      return false;
    }
  }

  /**
   * Check if document has includes
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
 * Output channel for tag generator logs
 */
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('ChapterWise Codex Tag Generator');
  }
  return outputChannel;
}

/**
 * Run the Generate Tags command
 */
export async function runGenerateTags(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage('No active editor. Open a Codex or Markdown file first.');
    return;
  }

  const fileName = editor.document.fileName;
  const isMarkdown = isMarkdownFile(fileName);

  if (!isCodexFile(fileName) && !isMarkdown) {
    vscode.window.showErrorMessage('Current file is not a Codex file (.codex.yaml, .codex.json) or Markdown file (.md)');
    return;
  }

  // Save the document first
  if (editor.document.isDirty) {
    await editor.document.save();
  }

  const documentText = editor.document.getText();
  const documentUri = editor.document.uri;

  // For markdown files, check if it has content after frontmatter
  // For codex files, check if it has body fields
  if (!isMarkdown && !TagGenerator.hasBodyFields(documentText)) {
    vscode.window.showWarningMessage('No body fields found in this codex file. Nothing to generate tags from.');
    return;
  }

  // Step 1: Select format
  const formatChoice = await vscode.window.showQuickPick([
    {
      label: '$(list-flat) Simple (strings only)',
      description: 'tags: ["Roman", "Awakening", "Senate"]',
      value: 'simple' as const
    },
    {
      label: '$(json) Detailed (with counts)',
      description: 'tags: [{name: "Roman", count: 15}, ...]',
      value: 'detailed' as const
    }
  ], {
    title: 'Generate Tags - Step 1/3: Output Format',
    placeHolder: 'Choose tag format'
  });

  if (!formatChoice) {
    return;
  }

  // Step 2: Max tags
  const maxTagsInput = await vscode.window.showInputBox({
    title: 'Generate Tags - Step 2/3: Maximum Tags',
    prompt: 'Maximum number of tags to generate per node (1-100)',
    value: '10',
    validateInput: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 100) {
        return 'Please enter a number between 1 and 100';
      }
      return null;
    }
  });

  if (maxTagsInput === undefined) {
    return;
  }

  // Step 3: Minimum count
  const minCountInput = await vscode.window.showInputBox({
    title: 'Generate Tags - Step 3/3: Minimum Occurrences',
    prompt: 'Minimum times a word must appear to become a tag (1-50)',
    value: '3',
    validateInput: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 50) {
        return 'Please enter a number between 1 and 50';
      }
      return null;
    }
  });

  if (minCountInput === undefined) {
    return;
  }

  // Check for includes (only for Codex files, not markdown)
  let followIncludes = false;

  if (!isMarkdown) {
    const hasIncludes = TagGenerator.hasIncludes(documentText);

    if (hasIncludes) {
      const includeChoice = await vscode.window.showInformationMessage(
        'This document has include directives. Also generate tags in included files?',
        'Yes, Include All Files',
        'No, Just This File'
      );

      if (!includeChoice) {
        return;
      }

      followIncludes = includeChoice.includes('Yes');
    }
  }

  // Build options
  const options: TagGeneratorOptions = {
    format: formatChoice.value,
    maxTags: parseInt(maxTagsInput, 10),
    minCount: parseInt(minCountInput, 10),
    followIncludes
  };

  // Run with progress
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating Tags...',
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: 'Analyzing body fields...' });

      const generator = new TagGenerator();
      return await generator.generateTags(documentUri, options);
    }
  );

  // Log results
  const channel = getOutputChannel();
  channel.appendLine(`\n${'='.repeat(60)}`);
  channel.appendLine(`Generate Tags - ${new Date().toLocaleString()}`);
  channel.appendLine(`File: ${documentUri.fsPath}`);
  channel.appendLine(`Format: ${options.format}`);
  channel.appendLine(`Max Tags: ${options.maxTags}`);
  channel.appendLine(`Min Count: ${options.minCount}`);
  channel.appendLine(`Follow Includes: ${options.followIncludes}`);
  channel.appendLine(`${'='.repeat(60)}`);

  if (result.success) {
    channel.appendLine(`✅ Success!`);
    channel.appendLine(`  Nodes updated: ${result.entitiesUpdated}`);
    channel.appendLine(`  Total tags generated: ${result.totalTagsGenerated}`);

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

    const message = result.entitiesUpdated > 0
      ? `✅ Generated ${result.totalTagsGenerated} tags across ${result.entitiesUpdated} nodes`
      : 'No tags generated (body fields may be too short or words don\'t meet minimum count)';

    const action = await vscode.window.showInformationMessage(
      message,
      'Show Details'
    );

    if (action === 'Show Details') {
      channel.show();
    }

    // Reload the document
    if (result.filesModified.includes(documentUri.fsPath)) {
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }

  } else {
    channel.appendLine(`❌ Failed!`);
    result.errors.forEach(e => channel.appendLine(`  Error: ${e}`));

    vscode.window.showErrorMessage(
      `Tag generation failed: ${result.errors[0]}`,
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
export function disposeTagGenerator(): void {
  outputChannel?.dispose();
}





























































