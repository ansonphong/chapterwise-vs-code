/**
 * HTML template builder for Writer View webview
 */

import * as vscode from 'vscode';
import { CodexNode } from '../../codexModel';
import { escapeHtml, getNonce } from '../utils/helpers';
import { getWriterViewStyles } from '../styles';
import { getWriterViewScript } from '../script';
import { renderAttributesTable } from './attributesRenderer';
import { renderContentSections } from './contentRenderer';
import { renderImagesGallery, renderImagesFullGallery, renderImageModal } from './imagesRenderer';
import { renderImageBrowserModal } from './imageBrowserRenderer';
import { buildToolbarHtml, getToolbarContextFromField } from '../toolbar';

export interface WebviewHtmlOptions {
  webview: vscode.Webview;
  node: CodexNode;
  prose: string;
  initialField: string;
  themeSetting: 'light' | 'dark' | 'system' | 'theme';
  vscodeThemeKind: 'light' | 'dark';
  author?: string;
  indexTypes?: TypeDefinition[];
  filePath: string;
  workspaceRoot: string;
  /** All prose field values for overview mode */
  proseFields?: Record<string, string>;
  /** Resolved image URLs for webview */
  imageUrls?: Record<string, string>;
}

export interface TypeDefinition {
  type: string;
  emoji?: string;
  color?: string;
  description?: string;
}

/**
 * Build the complete HTML for the Writer View webview
 */
export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const { webview, node, prose, initialField, themeSetting, vscodeThemeKind, author, indexTypes, filePath, workspaceRoot, proseFields } = options;

  const nonce = getNonce();
  const escapedProse = escapeHtml(prose);
  const authorDisplay = author ? escapeHtml(author) : 'Unknown Author';

  // Get prose field values for overview mode
  const summaryValue = proseFields?.summary ?? '';
  const bodyValue = proseFields?.body ?? '';
  const hasSummary = node.availableFields.includes('summary');
  const hasBody = node.availableFields.includes('body');

  // Calculate relative path for display
  const path = require('path');
  const relativePath = workspaceRoot
    ? path.relative(workspaceRoot, filePath)
    : path.basename(filePath);
  const fullPath = filePath;

  // Build field selector options
  const fieldOptions = buildFieldSelectorOptions(node, initialField);

  // Build context toolbar
  const toolbarContext = getToolbarContextFromField(initialField);
  const toolbarHtml = buildToolbarHtml(toolbarContext, node);

  // Build type selector options
  const typeOptions = buildTypeSelectorOptions(node, indexTypes || []);

  return /* html */ `<!DOCTYPE html>
<html lang="en" data-theme-setting="${themeSetting}" data-vscode-theme="${vscodeThemeKind}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Writer: ${escapeHtml(node.name)}</title>
  <style>
${getWriterViewStyles()}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <select class="field-selector" id="fieldSelector">
        ${fieldOptions}
      </select>
      <div class="node-name-container">
        <span class="node-name editable" id="nodeName" tabindex="0" title="Click to edit title">${escapeHtml(node.name)}</span>
        <div class="node-name-edit" id="nodeNameEdit" contenteditable="false" aria-label="Edit title"></div>
      </div>
    </div>
    <div class="context-toolbar" id="contextToolbar">
      ${toolbarHtml}
    </div>
    <div class="header-right">
      <select class="type-selector" id="typeSelector" title="Change node type">
        ${typeOptions}
      </select>
      <div class="save-menu-container">
        <button class="save-menu-btn" id="saveMenuBtn" title="Save options">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.5"/>
            <circle cx="8" cy="8" r="1.5"/>
            <circle cx="8" cy="13" r="1.5"/>
          </svg>
        </button>
        <div class="save-menu-dropdown" id="saveMenuDropdown">
          <button class="save-menu-item" data-action="save">
            <svg width="14" height="14" viewBox="0 0 32 32" fill="currentColor">
              <path d="M27.71,9.29l-5-5A1,1,0,0,0,22,4H6A2,2,0,0,0,4,6V26a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2V10A1,1,0,0,0,27.71,9.29ZM12,6h8v4H12Zm8,20H12V18h8Zm2,0V18a2,2,0,0,0-2-2H12a2,2,0,0,0-2,2v8H6V6h4v4a2,2,0,0,0,2,2h8a2,2,0,0,0,2-2V6.41l4,4V26Z"/>
            </svg>
            <span>Save</span>
            <span class="save-menu-shortcut">⌘S</span>
          </button>
          <button class="save-menu-item" data-action="saveAs">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13 2H7l-1 1H2v2h12V3h-1zM3 6v7c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V6H3zm2 7V8h6v5H5z"/>
              <rect x="5" y="8" width="6" height="1" opacity="0.6"/>
              <rect x="5" y="10" width="6" height="1" opacity="0.6"/>
              <rect x="5" y="12" width="4" height="1" opacity="0.6"/>
            </svg>
            <span>Save As...</span>
          </button>
          <div class="save-menu-divider"></div>
          <button class="save-menu-footer" data-action="openFile" title="${escapeHtml(fullPath)}">
            📄 ${escapeHtml(relativePath)}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Summary Editor (shown at top in overview) -->
  <div class="editor-container prose-section" id="summaryEditor" data-field="summary" ${!hasSummary ? 'style="display: none;"' : ''}>
    <div class="editor-wrapper">
      <div class="overview-section-header">
        <span class="structured-title">Summary</span>
      </div>
      <div
        id="summaryEditorContent"
        class="prose-editor-content"
        contenteditable="true"
        spellcheck="true"
        data-placeholder="Write a summary..."
        data-field="summary"
      >${escapeHtml(summaryValue)}</div>
    </div>
  </div>

  <!-- Images Gallery (hidden when empty, shown via +Add or when images exist) -->
  <div class="structured-editor${!node.hasImages ? ' images-empty-hidden' : ''}" id="imagesEditor">
    <div class="structured-header">
      <span class="structured-title overview-section-header-inline" data-field="__images__">Images</span>
      <span class="images-count">${node.images?.length || 0} images</span>
      <button class="add-btn" id="addImageBtn">+ Add Image</button>
    </div>
    <div id="imagesContainer">
      ${node.hasImages ? renderImagesGallery(node.images || [], workspaceRoot) : ''}
    </div>
  </div>

  <!-- Main Prose Editor (for single field mode) -->
  <div class="editor-container" id="proseEditor">
    <div class="editor-wrapper">
      <div
        id="editor"
        contenteditable="true"
        spellcheck="true"
        data-placeholder="Start writing..."
      >${escapedProse}</div>
    </div>
  </div>

  <!-- Attributes Editor -->
  <div class="structured-editor" id="attributesEditor">
    <div class="structured-header">
      <span class="structured-title overview-section-header-inline" data-field="__attributes__">Attributes</span>
      <button class="add-btn" id="addAttrBtn">+ Add Attribute</button>
    </div>
    <div id="attributesContainer">
      ${renderAttributesTable(node.attributes || [])}
    </div>
  </div>

  <!-- Content Sections Editor -->
  <div class="structured-editor" id="contentEditor">
    <div class="structured-header">
      <span class="structured-title overview-section-header-inline" data-field="__content__">Content</span>
      <div class="header-buttons">
        <button class="toggle-all-btn" id="toggleAllContentBtn">Expand All ▼</button>
        <button class="add-btn" id="addContentBtn">+ Add Section</button>
      </div>
    </div>
    <div id="contentContainer">
      ${renderContentSections(node.contentSections || [])}
    </div>
  </div>

  <!-- Body Editor (shown at bottom in overview, after content) -->
  <div class="editor-container prose-section" id="bodyEditor" data-field="body" ${!hasBody ? 'style="display: none;"' : ''}>
    <div class="editor-wrapper">
      <div class="overview-section-header">
        <span class="structured-title">Body</span>
      </div>
      <div
        id="bodyEditorContent"
        class="prose-editor-content"
        contenteditable="true"
        spellcheck="true"
        data-placeholder="Write the main content..."
        data-field="body"
      >${escapeHtml(bodyValue)}</div>
    </div>
  </div>

  <div class="footer">
    <span id="authorDisplay" title="Author(s)">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom; margin-right: 0.25rem;">
        <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/>
      </svg>
      ${authorDisplay}
    </span>
  </div>

  ${renderImageModal()}
  ${renderImageBrowserModal()}

  <script nonce="${nonce}">
${getWriterViewScript(node, initialField)}
  </script>
</body>
</html>`;
}

/**
 * Build the field selector dropdown options
 */
function buildFieldSelectorOptions(node: CodexNode, initialField: string): string {
  const options: string[] = [];

  // Check if node has multiple fields to show overview option
  const hasMultipleFields = node.availableFields.length > 1 ||
    (node.attributes && node.attributes.length > 0) ||
    (node.contentSections && node.contentSections.length > 0);

  // Add overview option for nodes with multiple fields
  if (hasMultipleFields) {
    options.push(`<option value="__overview__" ${initialField === '__overview__' ? 'selected' : ''}>📖 Overview</option>`);
    options.push('<option disabled>───────────</option>');
  }

  // Add prose fields
  for (const f of node.availableFields) {
    if (!f.startsWith('__')) {
      // Add emojis for common field types
      let emoji = '';
      if (f === 'summary') emoji = '📋 ';
      else if (f === 'body') emoji = '📄 ';

      options.push(`<option value="${f}" ${f === initialField ? 'selected' : ''}>${emoji}${f}</option>`);
    }
  }

  // Add "new" prose fields if not present
  if (!node.availableFields.includes('body')) {
    options.push(`<option value="body" ${initialField === 'body' ? 'selected' : ''}>📄 body (new)</option>`);
  }
  if (!node.availableFields.includes('summary')) {
    options.push(`<option value="summary" ${initialField === 'summary' ? 'selected' : ''}>📋 summary (new)</option>`);
  }

  // Add separator and special fields if present (check actual node properties, not availableFields)
  const hasSpecialFields = node.hasAttributes || node.hasContentSections || node.hasImages;
  if (hasSpecialFields) {
    options.push('<option disabled>───────────</option>');

    // Add attributes option if node has attributes
    if (node.hasAttributes && node.attributes && node.attributes.length > 0) {
      options.push(`<option value="__attributes__" ${initialField === '__attributes__' ? 'selected' : ''}>📊 attributes (${node.attributes.length})</option>`);
    }

    // Add content sections option if node has them
    if (node.hasContentSections && node.contentSections && node.contentSections.length > 0) {
      options.push(`<option value="__content__" ${initialField === '__content__' ? 'selected' : ''}>📝 content (${node.contentSections.length})</option>`);
    }

    // Add images option if node has images
    if (node.hasImages && node.images && node.images.length > 0) {
      options.push(`<option value="__images__" ${initialField === '__images__' ? 'selected' : ''}>🖼 images (${node.images.length})</option>`);
    }
  }

  return options.join('');
}

/**
 * Build the type selector dropdown options
 */
function buildTypeSelectorOptions(node: CodexNode, indexTypes: TypeDefinition[]): string {
  const options: string[] = [];

  // Standard types
  const standardTypes = [
    { type: 'book', emoji: '📚' },
    { type: 'chapter', emoji: '📖' },
    { type: 'act', emoji: '🎭' },
    { type: 'scene', emoji: '🎬' },
    { type: 'beat', emoji: '🎵' },
    { type: 'character', emoji: '👤' },
    { type: 'concept', emoji: '💡' }
  ];

  // Add standard types (without emoji in label - keeps UI clean when closed)
  standardTypes.forEach(({ type }) => {
    const selected = node.type === type ? 'selected' : '';
    options.push(`<option value="${escapeHtml(type)}" ${selected}>${escapeHtml(type)}</option>`);
  });

  // Add separator if custom types exist
  if (indexTypes.length > 0) {
    options.push('<option disabled>───────────</option>');

    // Add custom types from index (without emoji in label)
    indexTypes.forEach(({ type, description }) => {
      const selected = node.type === type ? 'selected' : '';
      const title = description ? `title="${escapeHtml(description)}"` : '';
      options.push(`<option value="${escapeHtml(type)}" ${selected} ${title}>${escapeHtml(type)}</option>`);
    });
  }

  return options.join('');
}

