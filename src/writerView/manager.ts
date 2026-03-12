/**
 * Writer View Manager - Core panel management logic
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
const fsPromises = fs.promises;
import * as path from 'path';
import * as YAML from 'yaml';
import {
  CodexNode,
  CodexDocument,
  CodexAttribute,
  CodexContentSection,
  CodexImage,
  parseCodex,
  parseMarkdownAsCodex,
  setNodeProse,
  setMarkdownNodeProse,
  setMarkdownFrontmatterField,
  setNodeName,
  setNodeType,
  getNodeProse,
  setNodeAttributes,
  setNodeContentSections,
  isMarkdownFile
} from '../codexModel';
import { CodexTreeItem, CodexTreeProvider } from '../treeProvider';
import { WriterPanelStats, calculateStats } from './utils/stats';
import { buildWebviewHtml } from './html/builder';
import { safePostMessage, isPathWithinWorkspace } from './utils/helpers';

/**
 * Manages Writer View webview panels
 */
export class WriterViewManager {
  private panels: Map<string, vscode.WebviewPanel> = new Map();
  private wordCountStatusBarItem: vscode.StatusBarItem;
  private panelStats: Map<string, WriterPanelStats> = new Map();
  private treeProvider: CodexTreeProvider | null = null;
  private pendingDuplicateResolvers: Map<string, {
    resolve: (action: { type: string; existingPath?: string }) => void;
    panel: vscode.WebviewPanel;
  }> = new Map();
  private panelResolverKeys: WeakMap<vscode.WebviewPanel, string> = new WeakMap();
  private fileLocks: Map<string, Promise<void>> = new Map();

  constructor(private readonly context: vscode.ExtensionContext) {
    // Create word count status bar item
    this.wordCountStatusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      200  // Priority (position in status bar)
    );
    context.subscriptions.push(this.wordCountStatusBarItem);
  }

  /**
   * Set the tree provider reference (needed for accessing index document)
   */
  setTreeProvider(treeProvider: CodexTreeProvider): void {
    this.treeProvider = treeProvider;
  }

  /**
   * Get workspace root path — prefer the tree provider's context root
   * (which tracks the user's active Codex project) over workspaceFolders[0]
   */
  private getWorkspaceRoot(): string {
    // Use tree provider's context root first (matches the active Codex project)
    if (this.treeProvider) {
      const contextRoot = this.treeProvider.getWorkspaceRoot();
      if (contextRoot) {
        return contextRoot;
      }
    }
    // Fallback to VS Code workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri.fsPath;
    }
    return '';
  }

  /**
   * Format author field (string or array) into display string
   */
  private formatAuthor(author: string | string[] | undefined): string {
    if (!author) {
      return '';
    }
    if (Array.isArray(author)) {
      return author.join(', ');
    }
    return String(author);
  }

  /**
   * Get author from current document or fallback to index document
   */
  private getAuthorDisplay(currentDoc: CodexDocument | null): string {
    // Try current document first
    if (currentDoc?.metadata?.author) {
      const authorStr = this.formatAuthor(currentDoc.metadata.author);
      if (authorStr) {
        return authorStr;
      }
    }

    // Fallback to index document
    const indexDoc = this.treeProvider?.getIndexDocument();
    if (indexDoc?.metadata?.author) {
      const authorStr = this.formatAuthor(indexDoc.metadata.author);
      if (authorStr) {
        return authorStr;
      }
    }

    return 'Unknown Author';
  }

  /**
   * Update status bar with word count
   */
  private updateStatusBar(stats: WriterPanelStats): void {
    // Primary display: word count
    this.wordCountStatusBarItem.text = `$(pencil) ${stats.wordCount} words`;

    // Rich tooltip with all stats
    const tooltipLines = [
      `${stats.wordCount} words in "${stats.nodeName}"`,
      `${stats.charCount} characters`
    ];

    if (stats.field) {
      tooltipLines.push(`Field: ${stats.field}`);
    }

    this.wordCountStatusBarItem.tooltip = tooltipLines.join('\n');
    this.wordCountStatusBarItem.show();
  }

  /**
   * Hide status bar item
   */
  private hideStatusBar(): void {
    this.wordCountStatusBarItem.hide();
  }

  /**
   * Update status bar to show the currently active Writer View panel
   */
  private updateStatusBarForActivePanel(): void {
    // Find the panel that is both visible AND active
    for (const [key, panel] of this.panels.entries()) {
      if (panel.active && panel.visible) {
        const stats = this.panelStats.get(key);
        if (stats) {
          this.updateStatusBar(stats);
          return;
        }
      }
    }

    // No active Writer View found - hide status bar
    this.hideStatusBar();
  }

  /**
   * Store stats for a panel and update status bar if it's active
   */
  private updateStatsForPanel(
    panelKey: string,
    panel: vscode.WebviewPanel,
    stats: WriterPanelStats
  ): void {
    // Store stats for this panel
    this.panelStats.set(panelKey, stats);

    // Only update status bar if THIS panel is the active one
    if (panel.active && panel.visible) {
      this.updateStatusBar(stats);
    }
  }

  /**
   * Resolve image URL for webview display
   */
  private resolveImageUrlForWebview(webview: vscode.Webview, url: string, workspaceRoot: string): string {
    // Block external URLs - CSP restricts img-src to webview resources and data: URIs
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return '';
    }

    // For relative paths, convert to webview URI
    let fullPath: string;

    if (url.startsWith('/')) {
      // Relative to workspace root
      fullPath = path.join(workspaceRoot, url.substring(1));
    } else {
      // Relative to current file
      fullPath = path.join(workspaceRoot, url);
    }

    // Path traversal protection: ensure resolved path stays within workspace
    const resolved = path.resolve(fullPath);
    const resolvedRoot = path.resolve(workspaceRoot);
    if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
      console.log(`[ChapterWise] resolveImageUrl: path traversal blocked. url=${url}, resolved=${resolved}, root=${resolvedRoot}`);
      return '';
    }

    const fileUri = vscode.Uri.file(fullPath);
    const webviewUri = webview.asWebviewUri(fileUri).toString();
    console.log(`[ChapterWise] resolveImageUrl: url=${url} -> ${webviewUri}`);
    return webviewUri;
  }

  /**
   * Get the theme setting from configuration
   */
  private getThemeSetting(): 'light' | 'dark' | 'system' | 'theme' {
    const config = vscode.workspace.getConfiguration('chapterwiseCodex.writerView');
    return config.get<'light' | 'dark' | 'system' | 'theme'>('theme', 'theme');
  }

  /**
   * Get the current VS Code theme kind (light or dark)
   */
  private getVSCodeThemeKind(): 'light' | 'dark' {
    const colorTheme = vscode.window.activeColorTheme;
    return colorTheme.kind === vscode.ColorThemeKind.Light ? 'light' : 'dark';
  }

  /**
   * Open or focus a Writer View for a node
   */
  async openWriterView(treeItem: CodexTreeItem): Promise<void> {
    const node = treeItem.codexNode;
    const documentUri = treeItem.documentUri;

    // Create a unique key for this panel
    const panelKey = `${documentUri.toString()}#${node.id || node.path.join('/')}`;

    // Check if panel already exists - just focus it
    let existingPanel = this.panels.get(panelKey);
    if (existingPanel) {
      existingPanel.reveal(vscode.ViewColumn.Active);
      return;
    }

    // Read file directly - DON'T open in VS Code text editor
    const fileName = documentUri.fsPath;
    const text = await fsPromises.readFile(fileName, 'utf-8');

    // Use appropriate parser based on file type
    const codexDoc = isMarkdownFile(fileName)
      ? parseMarkdownAsCodex(text, fileName)
      : parseCodex(text);

    if (!codexDoc) {
      const fileType = isMarkdownFile(fileName) ? 'Markdown' : 'Codex';
      vscode.window.showErrorMessage(`Unable to parse ${fileType} document`);
      return;
    }

    // Determine initial field based on node structure using smart defaults
    let initialField: string;

    // Smart default: overview for multi-field nodes, single field otherwise
    const proseFieldCount = node.availableFields.filter(f => !f.startsWith('__')).length;
    const hasChildren = node.children && node.children.length > 0;
    const hasContentSections = node.hasContentSections;
    const hasAttributes = node.hasAttributes;

    // Count total fields
    const fieldCount = proseFieldCount + (hasContentSections ? 1 : 0) + (hasAttributes ? 1 : 0) + (hasChildren ? 1 : 0);

    // Default to overview if multiple fields, otherwise show the single field
    if (fieldCount > 1) {
      initialField = '__overview__';
    } else if (node.availableFields.includes('summary')) {
      initialField = 'summary';
    } else if (node.availableFields.includes('body')) {
      initialField = 'body';
    } else if (node.availableFields.length > 0) {
      initialField = node.availableFields[0];
    } else {
      // Single structured field - stay in overview to show it
      initialField = '__overview__';
    }

    // Remap special fields to actual prose field for initial content load
    let proseFieldToLoad = initialField;
    if (initialField === '__overview__' || initialField === '__content__' || initialField === '__attributes__') {
      // For overview and structured fields, load the primary prose field (summary or body)
      // This ensures the prose editor has content even if we're showing structured view
      proseFieldToLoad = node.availableFields.includes('summary') ? 'summary' : (node.proseField || 'body');
    }

    let prose: string;
    // Handle special fields (attributes, content sections) - they don't have prose content
    if (proseFieldToLoad.startsWith('__')) {
      prose = '';
    } else if (isMarkdownFile(fileName)) {
      // For markdown files, extract field from frontmatter or body
      if (proseFieldToLoad === 'body') {
        prose = codexDoc.rootNode?.proseValue ?? '';
      } else if (proseFieldToLoad === 'summary') {
        // For summary field, get from frontmatter
        const frontmatter = codexDoc.frontmatter as Record<string, unknown> | undefined;
        prose = (frontmatter?.summary as string) ?? '';
      } else {
        // For any other fields, try frontmatter
        const frontmatter = codexDoc.frontmatter as Record<string, unknown> | undefined;
        prose = (frontmatter?.[proseFieldToLoad] as string) ?? '';
      }
    } else {
      prose = getNodeProse(codexDoc, node, proseFieldToLoad);
    }

    // Load all prose fields for overview mode
    const proseFields: Record<string, string> = {};
    if (isMarkdownFile(fileName)) {
      const frontmatter = codexDoc.frontmatter as Record<string, unknown> | undefined;
      proseFields.summary = (frontmatter?.summary as string) ?? '';
      proseFields.body = codexDoc.rootNode?.proseValue ?? '';
    } else {
      if (node.availableFields.includes('summary')) {
        proseFields.summary = getNodeProse(codexDoc, node, 'summary');
      }
      if (node.availableFields.includes('body')) {
        proseFields.body = getNodeProse(codexDoc, node, 'body');
      }
    }

    // Get workspace root for relative path display
    const workspaceRoot = this.getWorkspaceRoot();

    // Create new panel in the ACTIVE editor group (same frame, new tab)
    let panel = vscode.window.createWebviewPanel(
      'chapterwiseCodexWriter',
      `🖋️ ${node.name || 'Writer'}`,
      vscode.ViewColumn.Active,  // Opens in current editor group as new tab
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          ...(workspaceRoot ? [vscode.Uri.file(workspaceRoot)] : []),
        ],
      }
    );

    this.panels.set(panelKey, panel);

    // Get author display
    const authorDisplay = this.getAuthorDisplay(codexDoc);

    // Resolve image URLs for webview
    const resolvedImages = node.images?.map(img => ({
      ...img,
      url: this.resolveImageUrlForWebview(panel.webview, img.url, workspaceRoot)
    }));

    // Create a modified node with resolved image URLs
    const nodeWithResolvedImages = {
      ...node,
      images: resolvedImages
    };

    // Set initial HTML with remembered field using the new builder
    panel.webview.html = buildWebviewHtml({
      webview: panel.webview,
      node: nodeWithResolvedImages,
      prose,
      initialField,
      themeSetting: this.getThemeSetting(),
      vscodeThemeKind: this.getVSCodeThemeKind(),
      author: authorDisplay,
      filePath: documentUri.fsPath,
      workspaceRoot: workspaceRoot,
      proseFields,
    });

    // Store initial stats and update status bar
    const initialStats = calculateStats(prose, node.name, initialField);
    this.updateStatsForPanel(panelKey, panel, initialStats);

    // Track current field for this panel
    let currentField = initialField;
    let currentType = node.type;
    let currentAttributes: CodexAttribute[] = node.attributes || [];
    let currentContentSections: CodexContentSection[] = node.contentSections || [];

    // Listen for panel visibility/focus changes
    const viewStateDisposable = panel.onDidChangeViewState(() => {
      // Update status bar whenever any panel's state changes
      this.updateStatusBarForActivePanel();
    });

    // Handle messages from webview (closure captures node and documentUri)
    panel.webview.onDidReceiveMessage(
      async (message) => {
        // Validate message structure
        if (!message || typeof message.type !== 'string') {
          return;
        }

        switch (message.type) {
          case 'save': {
            if (typeof message.text !== 'string') { return; }
            const fieldToSave = (typeof message.field === 'string') ? message.field : currentField;
            const typeToSave = (typeof message.newType === 'string') ? message.newType : currentType;
            await this.handleSave(documentUri, node, message.text, fieldToSave, typeToSave);

            // Update stored stats
            const saveStats = calculateStats(message.text, node.name, fieldToSave);
            this.updateStatsForPanel(panelKey, panel, saveStats);

            safePostMessage(panel, { type: 'saved' });
            break;
          }

          case 'saveAs':
            await this.handleSaveAs(documentUri);
            break;

          case 'openFile': {
            // Open the file in normal code editor
            const doc = await vscode.workspace.openTextDocument(documentUri);
            await vscode.window.showTextDocument(doc, { preview: false });
            break;
          }

          case 'typeChanged':
            if (typeof message.newType !== 'string') { return; }
            // Store the new type value (will be saved with next save)
            currentType = message.newType;
            break;

          case 'contentChanged': {
            if (typeof message.text !== 'string') { return; }
            // New message type for real-time updates
            const contentStats = calculateStats(message.text, node.name, currentField);
            this.updateStatsForPanel(panelKey, panel, contentStats);
            break;
          }

          case 'renameName':
            if (typeof message.name !== 'string') { return; }
            await this.handleRenameName(documentUri, node, message.name, panel);
            break;

          case 'addField':
            if (typeof message.fieldType !== 'string') { return; }
            await this.handleAddField(documentUri, node, message.fieldType, panel);
            break;

          case 'switchField': {
            if (typeof message.field !== 'string') { return; }
            currentField = message.field;

            // Only fetch prose content for regular fields (not attributes/content)
            if (message.field !== '__attributes__' && message.field !== '__content__') {
              // Read file directly - DON'T open in VS Code text editor
              const filePath = documentUri.fsPath;
              const text = await fsPromises.readFile(filePath, 'utf-8');

              const parsed = isMarkdownFile(fileName)
                ? parseMarkdownAsCodex(text, fileName)
                : parseCodex(text);

              if (parsed) {
                let fieldContent: string;

                if (isMarkdownFile(fileName)) {
                  // For markdown files, extract field from frontmatter or body
                  if (message.field === 'body') {
                    fieldContent = parsed.rootNode?.proseValue ?? '';
                  } else {
                    // For summary and other fields, get from frontmatter
                    const frontmatter = parsed.frontmatter as Record<string, unknown> | undefined;
                    fieldContent = (frontmatter?.[message.field] as string) ?? '';
                  }
                } else {
                  // For codex files, use getNodeProse
                  fieldContent = getNodeProse(parsed, node, message.field);
                }

                safePostMessage(panel, { type: 'fieldContent', text: fieldContent, field: message.field });
              }
            }
            break;
          }

          case 'requestContent': {
            // Read file directly - DON'T open in VS Code text editor
            const filePathReq = documentUri.fsPath;
            const textReq = await fsPromises.readFile(filePathReq, 'utf-8');
            const parsedReq = isMarkdownFile(fileName)
              ? parseMarkdownAsCodex(textReq, fileName)
              : parseCodex(textReq);
            if (parsedReq) {
              let currentProse: string;
              if (isMarkdownFile(fileName)) {
                // For markdown files, extract field from frontmatter or body
                if (currentField === 'body') {
                  currentProse = parsedReq.rootNode?.proseValue ?? '';
                } else {
                  // For summary and other fields, get from frontmatter
                  const frontmatter = parsedReq.frontmatter as Record<string, unknown> | undefined;
                  currentProse = (frontmatter?.[currentField] as string) ?? '';
                }
              } else {
                // For codex files, use getNodeProse
                currentProse = getNodeProse(parsedReq, node, currentField);
              }
              safePostMessage(panel, { type: 'content', text: currentProse });
            }
            break;
          }

          // Attributes - batch save (local state is managed in webview for instant UI)
          case 'saveAttributes':
            if (!Array.isArray(message.attributes)) { return; }
            // Receive full array from webview and save once
            currentAttributes = message.attributes;
            await this.handleSaveAttributes(documentUri, node, currentAttributes);
            safePostMessage(panel, { type: 'saveComplete' });
            break;

          // Content Sections - batch save (local state is managed in webview for instant UI)
          case 'saveContentSections':
            if (!Array.isArray(message.sections)) { return; }
            // Receive full array from webview and save once
            currentContentSections = message.sections;
            await this.handleSaveContentSections(documentUri, node, currentContentSections);
            safePostMessage(panel, { type: 'saveComplete' });
            break;

          default:
            // Delegate image-related messages to shared handler
            await this.handleImageMessage(message, panel, documentUri, node, workspaceRoot);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    // Listen for VS Code theme changes (affects "theme" mode)
    const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
      const vscodeThemeKind = this.getVSCodeThemeKind();
      const themeSetting = this.getThemeSetting();

      // Update this specific panel
      safePostMessage(panel, {
        type: 'themeChanged',
        themeSetting: themeSetting,
        vscodeTheme: vscodeThemeKind
      });
    });

    // Listen for settings changes
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('chapterwiseCodex.writerView.theme')) {
        const themeSetting = this.getThemeSetting();
        const vscodeThemeKind = this.getVSCodeThemeKind();

        // Update this specific panel
        safePostMessage(panel, {
          type: 'themeChanged',
          themeSetting: themeSetting,
          vscodeTheme: vscodeThemeKind
        });
      }
    });

    // Handle panel disposal
    panel.onDidDispose(() => {
      this.panels.delete(panelKey);
      this.panelStats.delete(panelKey);

      // Update status bar (will show another Writer View if one exists, or hide)
      this.updateStatusBarForActivePanel();

      themeChangeDisposable.dispose();
      configChangeDisposable.dispose();
      viewStateDisposable.dispose();

      // Clean up any pending duplicate resolver
      const resolverKey = this.panelResolverKeys.get(panel);
      if (resolverKey) {
        const resolver = this.pendingDuplicateResolvers.get(resolverKey);
        if (resolver) {
          resolver.resolve({ type: 'cancel' });
        }
        this.pendingDuplicateResolvers.delete(resolverKey);
        this.panelResolverKeys.delete(panel);
      }
    });
  }

  /**
   * Open Writer View for a specific field of a node
   */
  async openWriterViewForField(node: CodexNode, documentUri: vscode.Uri, targetField: string): Promise<void> {
    // Create a unique key for this panel (same as openWriterView)
    const panelKey = `${documentUri.toString()}#${node.id || node.path.join('/')}`;

    // Check if panel already exists
    let existingPanel = this.panels.get(panelKey);
    if (existingPanel) {
      existingPanel.reveal(vscode.ViewColumn.Active);
      // If panel exists, send message to switch to the target field
      safePostMessage(existingPanel, {
        type: 'switchToField',
        field: targetField
      });
      return;
    }

    // Read file directly - DON'T open in VS Code text editor
    const fileName = documentUri.fsPath;
    const text = await fsPromises.readFile(fileName, 'utf-8');

    // Use appropriate parser based on file type
    const codexDoc = isMarkdownFile(fileName)
      ? parseMarkdownAsCodex(text, fileName)
      : parseCodex(text);

    if (!codexDoc) {
      const fileType = isMarkdownFile(fileName) ? 'Markdown' : 'Codex';
      vscode.window.showErrorMessage(`Unable to parse ${fileType} document`);
      return;
    }

    // Remap special fields to actual prose field for initial content load
    let proseFieldToLoad = targetField;
    if (targetField === '__overview__' || targetField === '__content__' || targetField === '__attributes__') {
      // For overview and structured fields, load the primary prose field (summary or body)
      // This ensures the prose editor has content even if we're showing structured view
      proseFieldToLoad = node.availableFields.includes('summary') ? 'summary' : (node.proseField || 'body');
    }

    // Get prose value for the target field
    let prose: string;
    if (proseFieldToLoad.startsWith('__')) {
      prose = '';
    } else if (isMarkdownFile(fileName)) {
      // For markdown files, extract field from frontmatter or body
      if (proseFieldToLoad === 'body') {
        prose = codexDoc.rootNode?.proseValue ?? '';
      } else {
        // For summary and other fields, get from frontmatter
        const frontmatter = codexDoc.frontmatter as Record<string, unknown> | undefined;
        prose = (frontmatter?.[proseFieldToLoad] as string) ?? '';
      }
    } else {
      prose = getNodeProse(codexDoc, node, proseFieldToLoad);
    }

    // Load all prose fields for overview mode
    const proseFields: Record<string, string> = {};
    if (isMarkdownFile(fileName)) {
      const frontmatter = codexDoc.frontmatter as Record<string, unknown> | undefined;
      proseFields.summary = (frontmatter?.summary as string) ?? '';
      proseFields.body = codexDoc.rootNode?.proseValue ?? '';
    } else {
      if (node.availableFields.includes('summary')) {
        proseFields.summary = getNodeProse(codexDoc, node, 'summary');
      }
      if (node.availableFields.includes('body')) {
        proseFields.body = getNodeProse(codexDoc, node, 'body');
      }
    }

    // Get workspace root for relative path display
    const workspaceRoot = this.getWorkspaceRoot();

    // Create new panel
    let panel = vscode.window.createWebviewPanel(
      'chapterwiseCodexWriter',
      `🖋️ ${node.name || 'Writer'}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          ...(workspaceRoot ? [vscode.Uri.file(workspaceRoot)] : []),
        ],
      }
    );

    this.panels.set(panelKey, panel);

    // Get author display
    const authorDisplay = this.getAuthorDisplay(codexDoc);

    // Resolve image URLs for webview
    const resolvedImages = node.images?.map(img => ({
      ...img,
      url: this.resolveImageUrlForWebview(panel.webview, img.url, workspaceRoot)
    }));

    // Create a modified node with resolved image URLs
    const nodeWithResolvedImages = {
      ...node,
      images: resolvedImages
    };

    // Set initial HTML with the target field selected using the new builder
    panel.webview.html = buildWebviewHtml({
      webview: panel.webview,
      node: nodeWithResolvedImages,
      prose,
      initialField: targetField,
      themeSetting: this.getThemeSetting(),
      vscodeThemeKind: this.getVSCodeThemeKind(),
      author: authorDisplay,
      filePath: documentUri.fsPath,
      workspaceRoot: workspaceRoot,
      proseFields,
    });

    // Store initial stats and update status bar
    const initialStats = calculateStats(prose, node.name, targetField);
    this.updateStatsForPanel(panelKey, panel, initialStats);

    // Track current field for this panel
    let currentField = targetField;
    let currentType = node.type;
    let currentAttributes: CodexAttribute[] = node.attributes || [];
    let currentContentSections: CodexContentSection[] = node.contentSections || [];

    // Listen for panel visibility/focus changes
    const viewStateDisposable2 = panel.onDidChangeViewState(() => {
      // Update status bar whenever any panel's state changes
      this.updateStatusBarForActivePanel();
    });

    // Handle messages from webview (same handlers as openWriterView)
    panel.webview.onDidReceiveMessage(
      async (message) => {
        // Validate message structure
        if (!message || typeof message.type !== 'string') {
          return;
        }

        switch (message.type) {
          case 'save': {
            if (typeof message.text !== 'string') { return; }
            const fieldToSave = (typeof message.field === 'string') ? message.field : currentField;
            const typeToSave = (typeof message.newType === 'string') ? message.newType : currentType;
            await this.handleSave(documentUri, node, message.text, fieldToSave, typeToSave);

            // Update stored stats
            const saveStats = calculateStats(message.text, node.name, fieldToSave);
            this.updateStatsForPanel(panelKey, panel, saveStats);

            safePostMessage(panel, { type: 'saved' });
            break;
          }

          case 'saveAs':
            await this.handleSaveAs(documentUri);
            break;

          case 'openFile': {
            // Open the file in normal code editor
            const doc = await vscode.workspace.openTextDocument(documentUri);
            await vscode.window.showTextDocument(doc, { preview: false });
            break;
          }

          case 'typeChanged':
            if (typeof message.newType !== 'string') { return; }
            // Store the new type value (will be saved with next save)
            currentType = message.newType;
            break;

          case 'contentChanged': {
            if (typeof message.text !== 'string') { return; }
            // New message type for real-time updates
            const contentStats = calculateStats(message.text, node.name, currentField);
            this.updateStatsForPanel(panelKey, panel, contentStats);
            break;
          }

          case 'switchField': {
            if (typeof message.field !== 'string') { return; }
            currentField = message.field;

            if (message.field !== '__attributes__' && message.field !== '__content__') {
              // Read file directly - DON'T open in VS Code text editor
              const filePath = documentUri.fsPath;
              const text = await fsPromises.readFile(filePath, 'utf-8');

              const parsed = isMarkdownFile(fileName)
                ? parseMarkdownAsCodex(text, fileName)
                : parseCodex(text);

              if (parsed) {
                let fieldContent: string;

                if (isMarkdownFile(fileName)) {
                  // For markdown files, extract field from frontmatter or body
                  if (message.field === 'body') {
                    fieldContent = parsed.rootNode?.proseValue ?? '';
                  } else {
                    // For summary and other fields, get from frontmatter
                    const frontmatter = parsed.frontmatter as Record<string, unknown> | undefined;
                    fieldContent = (frontmatter?.[message.field] as string) ?? '';
                  }
                } else {
                  // For codex files, use getNodeProse
                  fieldContent = getNodeProse(parsed, node, message.field);
                }

                safePostMessage(panel, { type: 'fieldContent', text: fieldContent, field: message.field });
              }
            }
            break;
          }

          case 'requestContent': {
            // Read file directly - DON'T open in VS Code text editor
            const filePathReq = documentUri.fsPath;
            const textReq = await fsPromises.readFile(filePathReq, 'utf-8');
            const parsedReq = isMarkdownFile(fileName)
              ? parseMarkdownAsCodex(textReq, fileName)
              : parseCodex(textReq);
            if (parsedReq) {
              let currentProse: string;
              if (isMarkdownFile(fileName)) {
                // For markdown files, extract field from frontmatter or body
                if (currentField === 'body') {
                  currentProse = parsedReq.rootNode?.proseValue ?? '';
                } else {
                  // For summary and other fields, get from frontmatter
                  const frontmatter = parsedReq.frontmatter as Record<string, unknown> | undefined;
                  currentProse = (frontmatter?.[currentField] as string) ?? '';
                }
              } else {
                // For codex files, use getNodeProse
                currentProse = getNodeProse(parsedReq, node, currentField);
              }
              safePostMessage(panel, { type: 'content', text: currentProse });
            }
            break;
          }

          case 'saveAttributes':
            if (!Array.isArray(message.attributes)) { return; }
            currentAttributes = message.attributes;
            await this.handleSaveAttributes(documentUri, node, currentAttributes);
            safePostMessage(panel, { type: 'saveComplete' });
            break;

          case 'saveContentSections':
            if (!Array.isArray(message.sections)) { return; }
            currentContentSections = message.sections;
            await this.handleSaveContentSections(documentUri, node, currentContentSections);
            safePostMessage(panel, { type: 'saveComplete' });
            break;

          default:
            // Delegate image-related messages to shared handler
            await this.handleImageMessage(message, panel, documentUri, node, workspaceRoot);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    // Listen for VS Code theme changes (affects "theme" mode)
    const themeChangeDisposable2 = vscode.window.onDidChangeActiveColorTheme(() => {
      const vscodeThemeKind = this.getVSCodeThemeKind();
      const themeSetting = this.getThemeSetting();

      // Update this specific panel
      safePostMessage(panel, {
        type: 'themeChanged',
        themeSetting: themeSetting,
        vscodeTheme: vscodeThemeKind
      });
    });

    // Listen for settings changes
    const configChangeDisposable2 = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('chapterwiseCodex.writerView.theme')) {
        const themeSetting = this.getThemeSetting();
        const vscodeThemeKind = this.getVSCodeThemeKind();

        // Update this specific panel
        safePostMessage(panel, {
          type: 'themeChanged',
          themeSetting: themeSetting,
          vscodeTheme: vscodeThemeKind
        });
      }
    });

    // Handle panel disposal
    panel.onDidDispose(() => {
      this.panels.delete(panelKey);
      this.panelStats.delete(panelKey);

      // Update status bar (will show another Writer View if one exists, or hide)
      this.updateStatusBarForActivePanel();

      themeChangeDisposable2.dispose();
      configChangeDisposable2.dispose();
      viewStateDisposable2.dispose();

      // Clean up any pending duplicate resolver
      const resolverKey = this.panelResolverKeys.get(panel);
      if (resolverKey) {
        const resolver = this.pendingDuplicateResolvers.get(resolverKey);
        if (resolver) {
          resolver.resolve({ type: 'cancel' });
        }
        this.pendingDuplicateResolvers.delete(resolverKey);
        this.panelResolverKeys.delete(panel);
      }
    });
  }
  private async handleSave(
    documentUri: vscode.Uri,
    node: CodexNode,
    newText: string,
    field?: string,
    newType?: string
  ): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(documentUri);
      const fileName = documentUri.fsPath;
      const originalText = document.getText();

      let newDocText: string;

      // Handle markdown files (Codex Lite) differently
      if (isMarkdownFile(fileName)) {
        const codexDoc = parseMarkdownAsCodex(originalText, fileName);
        if (!codexDoc) {
          vscode.window.showErrorMessage('Unable to parse Markdown document for saving');
          return;
        }

        // For markdown, handle body and summary differently
        const fieldToSave = field || 'body';
        if (fieldToSave === 'summary') {
          // Save to frontmatter for summary field
          newDocText = setMarkdownFrontmatterField(originalText, 'summary', newText);
        } else {
          // Update the body (preserving frontmatter)
        newDocText = setMarkdownNodeProse(originalText, newText, codexDoc.frontmatter);
        }
      } else {
        // Standard Codex file handling
        const codexDoc = parseCodex(originalText);
        if (!codexDoc) {
          vscode.window.showErrorMessage('Unable to parse Codex document for saving');
          return;
        }

        // Generate new document text
        newDocText = setNodeProse(codexDoc, node, newText, field);
      }

      // Update type if changed
      if (newType && newType !== node.type) {
        const codexDocWithType = parseCodex(newDocText);
        if (codexDocWithType) {
          newDocText = setNodeType(codexDocWithType, node, newType);
          node.type = newType; // Update in-memory
        }
      }

      // Apply the edit
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(originalText.length)
      );
      edit.replace(documentUri, fullRange, newDocText);

      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        await document.save();
        const fileType = isMarkdownFile(fileName) ? 'Markdown' : 'Codex';
        vscode.window.setStatusBarMessage(`✓ ${fileType} saved`, 2000);
      } else {
        vscode.window.showErrorMessage('Failed to save changes');
      }
    } catch (error) {
      console.error('Save failed:', error);
      vscode.window.showErrorMessage('Failed to save changes.');
    }
  }

  /**
   * Handle Save As - create a copy of the current file with a new name
   */
  private async handleSaveAs(documentUri: vscode.Uri): Promise<void> {
    try {
      const currentPath = documentUri.fsPath;
      const currentDir = path.dirname(currentPath);
      const currentExt = path.extname(currentPath);
      const currentBase = path.basename(currentPath, currentExt);

      // Suggest new filename
      const defaultName = `${currentBase}-copy${currentExt}`;

      // Ask user for new filename
      const newPath = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(currentDir, defaultName)),
        filters: {
          'Codex Files': ['yaml', 'yml', 'json', 'codex'],
          'Markdown Files': ['md']
        },
        title: 'Save Node As...'
      });

      if (!newPath) {
        return; // User cancelled
      }

      // Read current file content
      const content = await fsPromises.readFile(currentPath, 'utf-8');

      // Parse and update metadata
      const isJson = newPath.fsPath.toLowerCase().endsWith('.json');
      const isYaml = newPath.fsPath.toLowerCase().match(/\.(yaml|yml|codex)$/);

      if (isYaml || isJson) {
        let data: any;

        // Parse based on current file type
        if (currentPath.toLowerCase().endsWith('.json')) {
          data = JSON.parse(content);
        } else {
          data = YAML.parse(content);
        }

        // Update metadata
        if (!data.metadata) {
          data.metadata = {};
        }
        data.metadata.created = new Date().toISOString();
        data.metadata.updated = new Date().toISOString();
        if (data.metadata.extractedFrom) {
          delete data.metadata.extractedFrom;
        }

        // Write new file
        let newContent: string;
        if (isJson) {
          newContent = JSON.stringify(data, null, 2);
        } else {
          const doc = new YAML.Document(data);
          newContent = doc.toString({ lineWidth: 120 });
        }

        await fsPromises.writeFile(newPath.fsPath, newContent, 'utf-8');
      } else {
        // For markdown or other files, just copy as-is
        await fsPromises.writeFile(newPath.fsPath, content, 'utf-8');
      }

      // Show success and ask if user wants to open new file
      const action = await vscode.window.showInformationMessage(
        `✓ Saved copy as: ${path.basename(newPath.fsPath)}`,
        'Open Copy',
        'Stay Here'
      );

      if (action === 'Open Copy') {
        const doc = await vscode.workspace.openTextDocument(newPath);
        await vscode.window.showTextDocument(doc);
      }

    } catch (error) {
      console.error('Save As failed:', error);
      vscode.window.showErrorMessage('Failed to save file copy.');
    }
  }

  /**
   * Handle inline rename of the node name/title
   */
  private async handleRenameName(
    documentUri: vscode.Uri,
    node: CodexNode,
    newName: string,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    const trimmed = (newName || '').trim();
    if (!trimmed) {
      safePostMessage(panel, { type: 'nameUpdateError', error: 'Name cannot be empty.' });
      return;
    }

    try {
      const filePath = documentUri.fsPath;
      const fileName = filePath.toLowerCase();
      const originalText = await fsPromises.readFile(filePath, 'utf-8');
      let newDocText: string | null = null;

      if (isMarkdownFile(fileName)) {
        // Codex Lite: store name in frontmatter
        newDocText = setMarkdownFrontmatterField(originalText, 'name', trimmed);
      } else {
        const codexDoc = parseCodex(originalText);
        if (!codexDoc) {
          safePostMessage(panel, { type: 'nameUpdateError', error: 'Unable to parse document for renaming.' });
          return;
        }
        newDocText = setNodeName(codexDoc, node, trimmed);
      }

      if (!newDocText) {
        safePostMessage(panel, { type: 'nameUpdateError', error: 'Rename failed: could not update text.' });
        return;
      }

      await fsPromises.writeFile(filePath, newDocText, 'utf-8');

      // Update in-memory node and panel title for consistency
      node.name = trimmed;
      panel.title = `✍️ ${trimmed || 'Writer'}`;

      safePostMessage(panel, { type: 'nameUpdated', name: trimmed });
    } catch (error) {
      console.error('Rename failed:', error);
      safePostMessage(panel, { type: 'nameUpdateError', error: 'Failed to rename. See console for details.' });
    }
  }

  /**
   * Handle saving attributes
   */
  private async handleSaveAttributes(
    documentUri: vscode.Uri,
    node: CodexNode,
    attributes: CodexAttribute[]
  ): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(documentUri);
      const codexDoc = parseCodex(document.getText());

      if (!codexDoc) {
        vscode.window.showErrorMessage('Unable to parse Codex document for saving');
        return;
      }

      const newDocText = setNodeAttributes(codexDoc, node, attributes);

      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      edit.replace(documentUri, fullRange, newDocText);

      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        await document.save();
        vscode.window.setStatusBarMessage('✓ Attributes saved', 2000);
      }
    } catch (error) {
      console.error('Failed to save attributes:', error);
      vscode.window.showErrorMessage('Failed to save attributes.');
    }
  }

  /**
   * Handle saving content sections
   */
  private async handleSaveContentSections(
    documentUri: vscode.Uri,
    node: CodexNode,
    contentSections: CodexContentSection[]
  ): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(documentUri);
      const codexDoc = parseCodex(document.getText());

      if (!codexDoc) {
        vscode.window.showErrorMessage('Unable to parse Codex document for saving');
        return;
      }

      const newDocText = setNodeContentSections(codexDoc, node, contentSections);

      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      edit.replace(documentUri, fullRange, newDocText);

      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        await document.save();
        vscode.window.setStatusBarMessage('✓ Content saved', 2000);
      }
    } catch (error) {
      console.error('Failed to save content sections:', error);
      vscode.window.showErrorMessage('Failed to save content sections.');
    }
  }

  /**
   * Handle adding a new field to the node
   */
  private async handleAddField(
    documentUri: vscode.Uri,
    node: CodexNode,
    fieldType: string,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(documentUri);
      const fileName = documentUri.fsPath;
      const originalText = document.getText();
      let newDocText: string;
      let addedField: string | null = null;

      // Parse the document
      const codexDoc = isMarkdownFile(fileName)
        ? parseMarkdownAsCodex(originalText, fileName)
        : parseCodex(originalText);

      if (!codexDoc) {
        vscode.window.showErrorMessage('Unable to parse document for adding field');
        return;
      }

      // Handle different field types
      switch (fieldType) {
        case 'summary':
        case 'body':
          // Add prose field
          if (isMarkdownFile(fileName)) {
            // For markdown files, add to frontmatter (summary) or create body
            if (fieldType === 'summary') {
              newDocText = setMarkdownFrontmatterField(originalText, 'summary', '');
              addedField = 'summary';
            } else {
              // Body already exists in markdown, just switch to it
              addedField = 'body';
              newDocText = originalText;
            }
          } else {
            // For codex files, add empty prose field
            newDocText = setNodeProse(codexDoc, node, '', fieldType);
            addedField = fieldType;
          }
          break;

        case 'attributes':
          // Initialize empty attributes array if it doesn't exist
          if (!node.hasAttributes || !node.attributes || node.attributes.length === 0) {
            newDocText = setNodeAttributes(codexDoc, node, []);
            node.hasAttributes = true;
            node.attributes = [];
            addedField = '__attributes__';
          } else {
            newDocText = originalText;
          }
          break;

        case 'content':
          // Initialize empty content sections array if it doesn't exist
          if (!node.hasContentSections || !node.contentSections || node.contentSections.length === 0) {
            newDocText = setNodeContentSections(codexDoc, node, []);
            node.hasContentSections = true;
            node.contentSections = [];
            addedField = '__content__';
          } else {
            newDocText = originalText;
          }
          break;

        default:
          vscode.window.showWarningMessage(`Unknown field type: ${fieldType}`);
          return;
      }

      // Apply the edit if content changed
      if (newDocText && newDocText !== originalText) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(originalText.length)
        );
        edit.replace(documentUri, fullRange, newDocText);

        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
          await document.save();
          vscode.window.setStatusBarMessage(`✓ ${fieldType} field added`, 2000);

          // Update node's available fields
          if (fieldType === 'summary' || fieldType === 'body') {
            if (!node.availableFields.includes(fieldType)) {
              node.availableFields.push(fieldType);
            }
          }

          // Send message to webview to refresh and show the new field
          safePostMessage(panel, {
            type: 'fieldAdded',
            fieldType: fieldType,
            addedField: addedField,
            node: {
              availableFields: node.availableFields,
              hasAttributes: node.hasAttributes,
              hasContentSections: node.hasContentSections
            }
          });
        } else {
          vscode.window.showErrorMessage('Failed to add field');
        }
      } else {
        // Field already exists, just switch to it
        if (addedField) {
          safePostMessage(panel, {
            type: 'switchToField',
            field: addedField
          });
        }
      }
    } catch (error) {
      console.error('Failed to add field:', error);
      vscode.window.showErrorMessage('Failed to add field.');
    }
  }

  /**
   * Handle openImageBrowser message from webview
   */
  private async handleOpenImageBrowser(
    panel: vscode.WebviewPanel,
    workspaceRoot: string
  ): Promise<void> {
    const allImages = await this.scanWorkspaceImages(workspaceRoot);

    const imagesForBrowser = allImages.map(img => ({
      path: img.relativePath,
      thumbnail: this.resolveImageUrlForWebview(panel.webview, img.relativePath, workspaceRoot),
      filename: path.basename(img.relativePath),
      folder: path.dirname(img.relativePath).substring(1) || '/'
    }));

    safePostMessage(panel, {
      type: 'workspaceImages',
      images: imagesForBrowser
    });
  }

  /**
   * Serialize async operations on a per-file basis to prevent race conditions
   */
  private async withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const normalized = path.resolve(filePath);
    const existing = this.fileLocks.get(normalized) ?? Promise.resolve();
    let release: () => void;
    const newLock = new Promise<void>(resolve => { release = resolve; });
    this.fileLocks.set(normalized, existing.then(() => newLock));
    await existing;
    try {
      return await fn();
    } finally {
      release!();
      if (this.fileLocks.get(normalized) === newLock) {
        this.fileLocks.delete(normalized);
      }
    }
  }

  /**
   * Handle image-related messages from webview (shared between openWriterView and openWriterViewForField)
   * Returns true if the message was handled, false otherwise.
   */
  private async handleImageMessage(
    message: any,
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    workspaceRoot: string
  ): Promise<boolean> {
    switch (message.type) {
      case 'updateImageCaption': {
        if (typeof message.url !== 'string') { return true; }
        const { url, caption } = message;
        await this.withFileLock(documentUri.fsPath, async () => {
          try {
            const text = await fsPromises.readFile(documentUri.fsPath, 'utf-8');
            const doc = YAML.parseDocument(text);
            const targetNode = this.findNodeInYamlDoc(doc, node);
            if (!targetNode) {
              vscode.window.showErrorMessage('Could not find node in document');
              return;
            }
            const images = targetNode.get('images');
            if (!images || !YAML.isSeq(images)) { return; }
            for (const item of images.items) {
              if (YAML.isMap(item)) {
                const itemUrl = item.get('url');
                if (itemUrl === url) {
                  if (caption) {
                    item.set('caption', caption);
                  } else {
                    item.delete('caption');
                  }
                  break;
                }
              }
            }
            await fsPromises.writeFile(documentUri.fsPath, doc.toString());
            safePostMessage(panel, { type: 'imageCaptionSaved', url });
          } catch (error) {
            console.error('Failed to save caption:', error);
            vscode.window.showErrorMessage('Failed to save image caption.');
          }
        });
        return true;
      }

      case 'openImageBrowser':
        await this.handleOpenImageBrowser(panel, workspaceRoot);
        return true;

      case 'addExistingImage': {
        if (typeof message.imagePath !== 'string') { return true; }
        if (!isPathWithinWorkspace(message.imagePath, workspaceRoot)) {
          vscode.window.showErrorMessage('Image path must be within the workspace');
          return true;
        }
        await this.withFileLock(documentUri.fsPath, () =>
          this.handleAddExistingImage(panel, documentUri, node, workspaceRoot, message.imagePath)
        );
        return true;
      }

      case 'importImage':
        await this.handleImportImage(panel, documentUri, node, workspaceRoot);
        return true;

      case 'deleteImage':
        if (typeof message.url !== 'string') { return true; }
        await this.withFileLock(documentUri.fsPath, () =>
          this.handleDeleteImage(panel, documentUri, node, message.url, message.index)
        );
        return true;

      case 'reorderImages':
        if (!Array.isArray(message.order)) { return true; }
        await this.withFileLock(documentUri.fsPath, () =>
          this.handleReorderImages(panel, documentUri, node, message.order)
        );
        return true;

      case 'duplicateResolved': {
        if (typeof message.action !== 'string') { return true; }
        const resolverKey = this.panelResolverKeys.get(panel);
        if (resolverKey) {
          const resolver = this.pendingDuplicateResolvers.get(resolverKey);
          if (resolver) {
            resolver.resolve({ type: message.action, existingPath: message.existingPath });
            this.pendingDuplicateResolvers.delete(resolverKey);
          }
          this.panelResolverKeys.delete(panel);
        }
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Handle addExistingImage message from webview
   */
  private async handleAddExistingImage(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    workspaceRoot: string,
    imagePath: string
  ): Promise<void> {
    try {
      await this.addImagesToNode(documentUri, node, [{
        url: imagePath,
        caption: '',
        featured: !node.images || node.images.length === 0
      }]);

      // Re-read node to get updated images
      const text = await fsPromises.readFile(documentUri.fsPath, 'utf-8');
      const parsedDoc = isMarkdownFile(documentUri.fsPath)
        ? parseMarkdownAsCodex(text, documentUri.fsPath)
        : parseCodex(text);

      if (parsedDoc) {
        const updatedNode = parsedDoc.allNodes.find(n => n.id === node.id);
        if (updatedNode && updatedNode.images) {
          const newImage = updatedNode.images[updatedNode.images.length - 1];
          safePostMessage(panel, {
            type: 'imageAdded',
            image: {
              ...newImage,
              url: this.resolveImageUrlForWebview(panel.webview, newImage.url, workspaceRoot)
            }
          });
        }
      }
    } catch (error) {
      console.error('Failed to add image:', error);
      vscode.window.showErrorMessage('Failed to add image.');
      safePostMessage(panel, { type: 'imageAddError', message: 'Failed to add image' });
    }
  }

  /**
   * Handle importImage message from webview
   */
  private async handleImportImage(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    workspaceRoot: string
  ): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: {
        'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp']
      },
      title: 'Select Images to Add'
    });

    if (result && result.length > 0) {
      try {
        const addedImages = await this.importImages(result, documentUri, node, workspaceRoot, panel);

        const resolvedImages = addedImages.map(img => ({
          ...img,
          url: this.resolveImageUrlForWebview(panel.webview, img.url, workspaceRoot)
        }));

        safePostMessage(panel, {
          type: 'imagesAdded',
          images: resolvedImages
        });
      } catch (error) {
        console.error('Failed to import images:', error);
        vscode.window.showErrorMessage('Failed to import images.');
        safePostMessage(panel, { type: 'imageImportError', message: 'Failed to import images' });
      }
    }
  }

  /**
   * Handle deleteImage message from webview
   */
  private async handleDeleteImage(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    url: string,
    index: number
  ): Promise<void> {
    try {
      const text = await fsPromises.readFile(documentUri.fsPath, 'utf-8');
      const doc = YAML.parseDocument(text);

      const targetNode = this.findNodeInYamlDoc(doc, node);
      if (!targetNode) {
        vscode.window.showErrorMessage('Could not find node in document');
        return;
      }

      const images = targetNode.get('images');
      if (!images || !YAML.isSeq(images)) {
        return;
      }

      // Find and remove image by URL
      const items = (images as YAML.YAMLSeq).items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (YAML.isMap(item)) {
          const itemUrl = item.get('url');
          if (itemUrl === url) {
            (images as YAML.YAMLSeq).delete(i);
            break;
          }
        }
      }

      // If no images left, remove the images key
      if ((images as YAML.YAMLSeq).items.length === 0) {
        targetNode.delete('images');
      }

      await fsPromises.writeFile(documentUri.fsPath, doc.toString());

      safePostMessage(panel, { type: 'imageDeleted', url, index });
    } catch (error) {
      console.error('Failed to delete image:', error);
      vscode.window.showErrorMessage('Failed to delete image.');
      safePostMessage(panel, { type: 'imageDeleteError', message: 'Failed to delete image' });
    }
  }

  /**
   * Handle reorderImages message from webview
   */
  private async handleReorderImages(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    node: CodexNode,
    order: string[]
  ): Promise<void> {
    try {
      const text = await fsPromises.readFile(documentUri.fsPath, 'utf-8');
      const doc = YAML.parseDocument(text);

      const targetNode = this.findNodeInYamlDoc(doc, node);
      if (!targetNode) {
        vscode.window.showErrorMessage('Could not find node in document');
        return;
      }

      const images = targetNode.get('images');
      if (!images || !YAML.isSeq(images)) {
        return;
      }

      // Create a map of URL to image node
      const imageMap = new Map<string, YAML.Node>();
      for (const item of (images as YAML.YAMLSeq).items) {
        if (YAML.isMap(item)) {
          const url = item.get('url') as string;
          if (url) {
            imageMap.set(url, item);
          }
        }
      }

      // Clear and rebuild in new order
      (images as YAML.YAMLSeq).items = [];
      for (const url of order) {
        const imgNode = imageMap.get(url);
        if (imgNode) {
          (images as YAML.YAMLSeq).add(imgNode);
        }
      }

      await fsPromises.writeFile(documentUri.fsPath, doc.toString());

      safePostMessage(panel, { type: 'imagesReordered' });
    } catch (error) {
      console.error('Failed to reorder images:', error);
      vscode.window.showErrorMessage('Failed to reorder images.');
      safePostMessage(panel, { type: 'imageReorderError', message: 'Failed to reorder images' });
    }
  }

  /**
   * Find a node in a YAML document by ID
   */
  private findNodeInYamlDoc(doc: YAML.Document, node: CodexNode): YAML.YAMLMap | null {
    // If node is root, return document contents
    if (!node.parent || node.path.length === 0) {
      const contents = doc.contents;
      if (YAML.isMap(contents)) {
        return contents;
      }
      return null;
    }

    // Otherwise, traverse by path
    let current: any = doc.contents;

    for (const segment of node.path) {
      if (YAML.isMap(current)) {
        current = current.get(segment);
      } else if (YAML.isSeq(current) && typeof segment === 'number') {
        current = current.get(segment);
      } else {
        return null;
      }
    }

    return YAML.isMap(current) ? current : null;
  }

  /**
   * Calculate SHA256 hash of a file
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fsPromises.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  }

  /**
   * Find duplicate image in workspace by content hash
   * Uses file size as pre-filter for performance
   */
  private async findDuplicateImage(
    sourceFilePath: string,
    workspaceRoot: string
  ): Promise<{ found: boolean; existingPath?: string }> {
    try {
      // Get source file stats
      const sourceStats = await fsPromises.stat(sourceFilePath);
      const sourceSize = sourceStats.size;

      // Scan workspace for images
      const workspaceImages = await this.scanWorkspaceImages(workspaceRoot);

      // Filter to images with similar size (within 1KB tolerance for metadata differences)
      const sizeTolerance = 1024;
      const candidates: string[] = [];

      for (const img of workspaceImages) {
        try {
          const stats = await fsPromises.stat(img.fullPath);
          if (Math.abs(stats.size - sourceSize) <= sizeTolerance) {
            candidates.push(img.fullPath);
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }

      // If no size matches, no duplicate
      if (candidates.length === 0) {
        return { found: false };
      }

      // Calculate source hash
      const sourceHash = await this.calculateFileHash(sourceFilePath);

      // Check candidates for hash match
      for (const candidatePath of candidates) {
        try {
          const candidateHash = await this.calculateFileHash(candidatePath);
          if (candidateHash === sourceHash) {
            const relativePath = '/' + path.relative(workspaceRoot, candidatePath).replace(/\\/g, '/');
            return { found: true, existingPath: relativePath };
          }
        } catch {
          // Skip files that can't be read
        }
      }

      return { found: false };
    } catch {
      // On any error, assume no duplicate
      return { found: false };
    }
  }

  /**
   * Show duplicate modal and wait for user decision
   */
  private async promptDuplicateResolution(
    panel: vscode.WebviewPanel,
    filePath: string,
    existingPath: string,
    workspaceRoot: string
  ): Promise<{ type: string; existingPath?: string }> {
    return new Promise((resolve) => {
      // Store resolver with unique key
      const resolverKey = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.panelResolverKeys.set(panel, resolverKey);
      this.pendingDuplicateResolvers.set(resolverKey, { resolve, panel });

      // Resolve preview URL for webview
      const previewUrl = this.resolveImageUrlForWebview(panel.webview, existingPath, workspaceRoot);
      console.log(`[ChapterWise] Duplicate preview: existingPath=${existingPath}, workspaceRoot=${workspaceRoot}, previewUrl=${previewUrl}`);

      // Send message to show modal
      safePostMessage(panel, {
        type: 'duplicateFound',
        filePath,
        existingPath,
        previewUrl
      });
    });
  }

  /**
   * Scan workspace for image files (async)
   */
  private async scanWorkspaceImages(workspaceRoot: string): Promise<{ relativePath: string; fullPath: string }[]> {
    const images: { relativePath: string; fullPath: string }[] = [];
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const skipDirs = ['node_modules', '.git', '.vscode', 'out', 'dist', 'build'];

    const scanDir = async (dir: string, depth: number = 0): Promise<void> => {
      if (depth > 5) return; // Limit recursion depth

      try {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Skip hidden and build directories
            if (!entry.name.startsWith('.') && !skipDirs.includes(entry.name)) {
              await scanDir(fullPath, depth + 1);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (imageExtensions.includes(ext)) {
              images.push({
                relativePath: '/' + path.relative(workspaceRoot, fullPath).replace(/\\/g, '/'),
                fullPath
              });
            }
          }
        }
      } catch (error) {
        // Skip inaccessible directories
      }
    };

    await scanDir(workspaceRoot);
    return images;
  }

  /**
   * Get the target images directory based on user settings
   */
  private getImagesDirectory(documentUri: vscode.Uri, node: CodexNode, workspaceRoot: string): string {
    const config = vscode.workspace.getConfiguration('chapterwiseCodex');
    const organization = config.get<string>('images.organization', 'sharedWithNodeFolders');

    const codexDir = path.dirname(documentUri.fsPath);
    const nodeName = node.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || node.id;

    if (organization === 'perNode') {
      // /characters/aya/images/portrait.png
      return path.join(codexDir, 'images');
    } else {
      // /characters/images/aya/portrait.png (sharedWithNodeFolders - default)
      const parentDir = path.dirname(codexDir);
      return path.join(parentDir, 'images', nodeName);
    }
  }

  /**
   * Import images from file picker and copy to node's images folder
   */
  private async importImages(
    files: vscode.Uri[],
    documentUri: vscode.Uri,
    node: CodexNode,
    workspaceRoot: string,
    panel: vscode.WebviewPanel
  ): Promise<CodexImage[]> {
    const addedImages: CodexImage[] = [];

    // Get target folder based on setting
    const imagesDir = this.getImagesDirectory(documentUri, node, workspaceRoot);

    // Create images folder if needed
    await fsPromises.mkdir(imagesDir, { recursive: true });

    const fileExists = async (p: string): Promise<boolean> => { try { await fsPromises.access(p); return true; } catch { return false; } };

    for (const file of files) {
      let targetPath: string;
      let filename = path.basename(file.fsPath);

      // Check for duplicate by content hash
      const duplicate = await this.findDuplicateImage(file.fsPath, workspaceRoot);

      if (duplicate.found && duplicate.existingPath) {
        // Ask user what to do
        const resolution = await this.promptDuplicateResolution(
          panel,
          file.fsPath,
          duplicate.existingPath,
          workspaceRoot
        );

        if (resolution.type === 'useExisting') {
          // Use the existing image path
          addedImages.push({
            url: duplicate.existingPath,
            caption: '',
            featured: addedImages.length === 0 && (!node.images || node.images.length === 0)
          });
          continue;
        } else if (resolution.type === 'cancel') {
          // Skip this file
          continue;
        }
        // Otherwise fall through to import as copy
      }

      // Check file size (limit to 10MB)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      try {
        const stats = await fsPromises.stat(file.fsPath);
        if (stats.size > MAX_FILE_SIZE) {
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
          vscode.window.showWarningMessage(
            `Skipped "${filename}" (${sizeMB}MB) - exceeds 10MB limit`
          );
          continue;
        }
      } catch {
        // If we can't stat, let it fail later during copy
      }

      // Check if file is already in workspace
      if (file.fsPath.startsWith(workspaceRoot)) {
        // Already in workspace - ask if user wants to copy or reference
        const action = await vscode.window.showQuickPick(
          ['Reference original location', 'Copy to node folder'],
          { placeHolder: `${filename} is already in workspace` }
        );

        if (action === 'Reference original location') {
          // Use original path
          const relativePath = '/' + path.relative(workspaceRoot, file.fsPath).replace(/\\/g, '/');
          addedImages.push({
            url: relativePath,
            caption: '',
            featured: addedImages.length === 0 && (!node.images || node.images.length === 0)
          });
          continue;
        } else if (!action) {
          // User cancelled
          continue;
        }
      }

      // Handle duplicate filenames
      targetPath = path.join(imagesDir, filename);
      let counter = 1;
      while (await fileExists(targetPath)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        targetPath = path.join(imagesDir, `${base}-${counter}${ext}`);
        counter++;
      }

      // Copy file to images folder
      await fsPromises.copyFile(file.fsPath, targetPath);

      // Calculate relative path from workspace root
      const relativePath = '/' + path.relative(workspaceRoot, targetPath).replace(/\\/g, '/');

      addedImages.push({
        url: relativePath,
        caption: '',
        featured: addedImages.length === 0 && (!node.images || node.images.length === 0)
      });
    }

    // Add images to the node's YAML
    if (addedImages.length > 0) {
      await this.addImagesToNode(documentUri, node, addedImages);
    }

    return addedImages;
  }

  /**
   * Add images to node's YAML array
   */
  private async addImagesToNode(
    documentUri: vscode.Uri,
    node: CodexNode,
    newImages: CodexImage[]
  ): Promise<void> {
    const text = await fsPromises.readFile(documentUri.fsPath, 'utf-8');
    const doc = YAML.parseDocument(text);

    // Find the node in the document
    const targetNode = this.findNodeInYamlDoc(doc, node);
    if (!targetNode) {
      throw new Error('Could not find node in document');
    }

    // Get or create images array
    let images = targetNode.get('images');
    if (!images || !YAML.isSeq(images)) {
      images = doc.createNode([]);
      targetNode.set('images', images);
    }

    // Add new images
    for (const img of newImages) {
      const imgObj: Record<string, unknown> = { url: img.url };
      if (img.caption) imgObj.caption = img.caption;
      if (img.alt) imgObj.alt = img.alt;
      if (img.featured) imgObj.featured = img.featured;

      const imgNode = doc.createNode(imgObj);
      (images as YAML.YAMLSeq).add(imgNode);
    }

    // Write back
    await fsPromises.writeFile(documentUri.fsPath, doc.toString());
  }

  /**
   * Dispose all panels
   */
  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
    this.panelStats.clear();
    this.hideStatusBar();
  }
}
