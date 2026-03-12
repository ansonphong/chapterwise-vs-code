/**
 * CSS styles for Writer View webview
 */

import { getToolbarStyles } from './toolbar';

export function getWriterViewStyles(): string {
  return /* css */ `
    :root {
      /* Default to dark theme as fallback */
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-editor: #0d1117;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --text-muted: #6e7681;
      --border-color: #30363d;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --success: #3fb950;
    }
    
    /* Light theme colors */
    [data-theme-setting="light"] {
      --bg-primary: #ffffff;
      --bg-secondary: #f6f8fa;
      --bg-editor: #ffffff;
      --text-primary: #24292f;
      --text-secondary: #57606a;
      --text-muted: #6e7781;
      --border-color: #d0d7de;
      --accent: #0969da;
      --accent-hover: #0860ca;
      --success: #1a7f37;
    }
    
    /* Dark theme colors (explicit) */
    [data-theme-setting="dark"] {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-editor: #0d1117;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --text-muted: #6e7681;
      --border-color: #30363d;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --success: #3fb950;
    }
    
    /* Theme mode - use VS Code CSS variables */
    [data-theme-setting="theme"] {
      --bg-primary: var(--vscode-editor-background);
      --bg-secondary: var(--vscode-sideBar-background);
      --bg-editor: var(--vscode-editor-background);
      --text-primary: var(--vscode-editor-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --text-muted: var(--vscode-disabledForeground);
      --border-color: var(--vscode-panel-border);
      --accent: var(--vscode-focusBorder);
      --accent-hover: var(--vscode-button-hoverBackground);
      --success: var(--vscode-testing-iconPassed);
    }
    
    /* System theme detection via CSS media query */
    @media (prefers-color-scheme: light) {
      [data-theme-setting="system"] {
        --bg-primary: #ffffff;
        --bg-secondary: #f6f8fa;
        --bg-editor: #ffffff;
        --text-primary: #24292f;
        --text-secondary: #57606a;
        --text-muted: #6e7781;
        --border-color: #d0d7de;
        --accent: #0969da;
        --accent-hover: #0860ca;
        --success: #1a7f37;
      }
    }
    
    @media (prefers-color-scheme: dark) {
      [data-theme-setting="system"] {
        --bg-primary: #0d1117;
        --bg-secondary: #161b22;
        --bg-editor: #0d1117;
        --text-primary: #e6edf3;
        --text-secondary: #8b949e;
        --text-muted: #6e7681;
        --border-color: #30363d;
        --accent: #58a6ff;
        --accent-hover: #79c0ff;
        --success: #3fb950;
      }
    }
    
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Charter', 'Georgia', 'Cambria', 'Times New Roman', serif;
      margin: 0;
      padding: 0;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.7;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    /* Header */
    .header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 0.75rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky; /* Stays fixed at top when scrolling, but also allows absolute positioning for toolbar */
      top: 0;
      z-index: 100;
    }
    
    .header-left {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1; /* Allow it to grow */
    }
    
    .header-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1; /* Allow it to grow */
      justify-content: flex-end;
    }
    
    .node-info {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }
    
    .node-type-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .node-type {
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }
    
    .field-selector {
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.75rem;
      color: var(--accent);
      background: rgba(88, 166, 255, 0.1);
      border: 1px solid rgba(88, 166, 255, 0.3);
      padding: 0.375rem 0.75rem;
      border-radius: 4px;
      cursor: pointer;
      outline: none;
      transition: all 0.15s ease;
      margin-right: 0.5rem;
    }
    
    .field-selector:hover {
      background: rgba(88, 166, 255, 0.2);
      border-color: var(--accent);
    }
    
    .field-selector:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
    }
    
    .field-selector option {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    
    .type-selector {
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.75rem;
      color: var(--text-secondary);
      background: transparent;
      border: 1px solid var(--border-color);
      padding: 0.375rem 0.75rem;
      border-radius: 4px;
      cursor: pointer;
      outline: none;
      transition: all 0.15s ease;
      margin-right: 0.5rem;
      min-width: 120px;
    }
    
    .type-selector:hover {
      border-color: var(--text-secondary);
      color: var(--text-primary);
    }
    
    .type-selector:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
    }
    
    .type-selector option {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    
    .node-name {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    .node-name.editable {
      cursor: text;
      user-select: none;
      transition: opacity 0.15s ease;
    }
    
    .node-name.editable:hover {
      opacity: 0.9;
    }
    
    .node-name-container {
      position: relative;
    }
    
    .node-name.editing-hidden {
      display: none;
    }
    
    .node-name-edit {
      display: none;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      background: transparent;
      border: none;
      padding: 0;
      margin: 0;
      outline: none;
      word-break: break-word;
      white-space: pre-wrap;
    }
    
    .node-name-edit:focus {
      outline: none;
    }
    
    .node-name-edit.editing-active {
      display: inline;
    }
    
    /* Attributes Editor Styles */
    .structured-editor {
      display: none;
      flex: 1;
      padding: 1.5rem;
      overflow-y: auto;
      overflow-x: visible;
    }
    
    .structured-editor.active {
      display: block;
    }
    
    .structured-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border-color);
    }
    
    .header-buttons {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    
    .structured-title {
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }
    
    .add-btn {
      background: rgba(88, 166, 255, 0.1);
      color: var(--accent);
      border: 1px solid rgba(88, 166, 255, 0.3);
      padding: 0.375rem 0.75rem;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    
    .add-btn:hover {
      background: rgba(88, 166, 255, 0.2);
      border-color: var(--accent);
    }
    
    .toggle-all-btn {
      background: rgba(88, 166, 255, 0.05);
      color: var(--text-secondary);
      border: 1px solid var(--border-color);
      padding: 0.375rem 0.75rem;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
    }
    
    .toggle-all-btn:hover {
      background: rgba(88, 166, 255, 0.1);
      border-color: var(--text-secondary);
      color: var(--text-primary);
    }
    
    /* Attributes Table */
    .attr-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    
    .attr-table th {
      text-align: left;
      padding: 0.5rem;
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.7rem;
      text-transform: uppercase;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      font-weight: 500;
    }
    
    .attr-table td {
      padding: 0.375rem 0.5rem;
      border-bottom: 1px solid var(--border-color);
      vertical-align: middle;
    }
    
    .attr-table tr:hover {
      background: rgba(255, 255, 255, 0.02);
    }
    
    .attr-input {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary);
      padding: 0.25rem 0.375rem;
      border-radius: 3px;
      font-size: 0.875rem;
      width: 100%;
      transition: all 0.15s ease;
    }
    
    .attr-input:hover {
      border-color: var(--border-color);
    }
    
    .attr-input:focus {
      outline: none;
      border-color: var(--accent);
      background: rgba(88, 166, 255, 0.05);
    }
    
    .attr-input.key-input {
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.8rem;
    }
    
    .type-select {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 0.375rem 0.5rem;
      border-radius: 3px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
      min-width: 80px;
    }
    
    .type-select:hover {
      border-color: var(--text-secondary);
    }
    
    .type-select:focus {
      outline: none;
      border-color: var(--accent);
      background: rgba(88, 166, 255, 0.05);
    }
    
    .type-select option {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    
    .delete-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 3px;
      opacity: 0.5;
      transition: all 0.15s ease;
    }
    
    .delete-btn:hover {
      opacity: 1;
      color: #f85149;
      background: rgba(248, 81, 73, 0.1);
    }
    
    /* === SHARED UTILITIES === */
    
    /* Shared: Sans-serif name font */
    .name-field {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-weight: 500;
      color: var(--text-primary);
    }
    
    /* Shared: Inline editable name/field */
    .inline-editable {
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      transition: background 0.15s ease;
    }
    
    .inline-editable:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    
    .inline-editable.editing-hidden {
      display: none;
    }
    
    /* Shared: Inline edit input */
    .inline-edit-field {
      display: none;
      padding: 2px 4px;
      border: 1px solid var(--accent);
      border-radius: 3px;
      background: var(--bg-primary);
      min-width: 100px;
    }
    
    .inline-edit-field.editing-active {
      display: inline-block;
    }
    
    .inline-edit-field:focus {
      outline: none;
    }
    
    /* Shared: Key badge */
    .key-badge {
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.7rem;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.05);
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
    }
    
    /* Shared: Dropdown menu system */
    .dropdown-menu {
      position: relative;
    }
    
    .dropdown-menu .menu-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 3px;
      opacity: 0.5;
      transition: all 0.15s ease;
      font-size: 1.2rem;
      line-height: 1;
    }
    
    .dropdown-menu .menu-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }
    
    .dropdown-menu.active .menu-btn {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }
    
    .dropdown-menu .menu-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 0.25rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      min-width: 120px;
      z-index: 1000;
    }
    
    .dropdown-menu.active .menu-dropdown {
      display: block;
    }
    
    /* === END SHARED UTILITIES === */
    
    /* Attribute Cards (new card-based layout) */
    .attr-card {
      margin-bottom: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--bg-secondary);
      padding: 0.75rem 1rem;
      transition: background 0.15s ease;
    }
    
    .attr-card:hover {
      background: rgba(255, 255, 255, 0.02);
    }
    
    .attr-card-content {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .attr-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex: 0 0 auto;
      min-width: 200px;
    }
    
    .attr-name {
      font-size: 0.875rem;
    }
    
    .attr-name-edit {
      font-size: 0.875rem;
    }
    
    .attr-value-input {
      flex: 1;
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 0.375rem 0.5rem;
      border-radius: 3px;
      font-size: 0.875rem;
      transition: all 0.15s ease;
      font-family: inherit;
      min-height: 40px;
      resize: vertical;
      overflow-y: hidden;
      box-sizing: border-box;
    }
    
    .attr-value-input:hover {
      border-color: var(--text-secondary);
    }
    
    .attr-value-input:focus {
      outline: none;
      border-color: var(--accent);
      background: rgba(88, 166, 255, 0.05);
    }
    
    /* Menu item styles (shared by both dropdowns) */
    .menu-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      background: transparent;
      border: none;
      color: var(--text-primary);
      cursor: pointer;
      padding: 0.5rem 0.75rem;
      text-align: left;
      transition: background 0.15s ease;
      font-size: 0.875rem;
    }
    
    .menu-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    
    .empty-state {
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
    }
    
    .empty-state-icon {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      opacity: 0.5;
    }
    
    /* Content Sections Editor */
    .content-section {
      margin-bottom: 1rem;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow: visible;
    }
    
    .content-section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      cursor: pointer;
      user-select: none;
      border-radius: 6px;
      position: relative;
    }
    
    .content-section.expanded .content-section-header {
      border-radius: 6px 6px 0 0;
    }
    
    .content-section-header:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    
    .content-section-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .content-section-toggle {
      color: var(--text-muted);
      transition: transform 0.2s ease;
    }
    
    .content-section.expanded .content-section-toggle {
      transform: rotate(90deg);
    }
    
    /* Content section name and key now use shared utility classes */
    
    .content-section-body {
      display: none;
      padding: 1rem;
      border-top: 1px solid var(--border-color);
      border-radius: 0 0 6px 6px;
      overflow: hidden;
    }
    
    .content-section.expanded .content-section-body {
      display: block;
    }
    
    .content-section-meta {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.75rem;
    }
    
    .content-section-meta label {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    
    .content-section-meta input {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 0.25rem 0.5rem;
      border-radius: 3px;
      font-size: 0.875rem;
      margin-top: 0.25rem;
      width: 100%;
    }
    
    .content-section-meta input:focus {
      outline: none;
      border-color: var(--accent);
    }
    
    .content-textarea {
      width: 100%;
      min-height: 100px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 1rem;
      border-radius: 4px;
      font-family: 'Charter', 'Georgia', 'Cambria', 'Times New Roman', serif;
      font-size: 1rem;
      line-height: 1.6;
      resize: vertical;
      box-sizing: border-box;
      overflow-y: hidden;
    }
    
    .content-textarea:focus {
      outline: none;
      border-color: var(--accent);
    }
    
    .header-right {
      display: flex;
      align-items: center;
      gap: 0.75rem; /* Increased gap for type selector */
      flex: 1; /* Allow it to grow */
      justify-content: flex-end;
    }
    
    .save-menu-container {
      position: relative;
    }

    .save-menu-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1.5px solid var(--text-muted);
      background: transparent;
      color: var(--text-muted);
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .save-menu-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(88, 166, 255, 0.1);
    }

    .save-menu-btn.dirty {
      border-color: var(--accent);
      color: var(--accent);
    }

    .save-menu-btn.saved-flash {
      border-color: var(--success);
      color: var(--success);
      animation: greenFlash 1s ease;
    }

    .save-menu-btn.active {
      border-color: var(--accent);
      background: rgba(88, 166, 255, 0.1);
    }

    .save-menu-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 0.5rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      min-width: 180px;
      max-width: 220px;
      z-index: 1000;
      overflow: hidden;
    }

    .save-menu-dropdown.show {
      display: block;
    }

    .save-menu-divider {
      height: 1px;
      background: var(--border-color);
      margin: 0;
    }

    .save-menu-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.625rem 0.75rem;
      background: transparent;
      border: none;
      color: var(--text-primary);
      cursor: pointer;
      transition: background 0.15s ease;
      font-size: 0.8rem;
      text-align: left;
    }

    .save-menu-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .save-menu-item svg {
      flex-shrink: 0;
      opacity: 0.8;
      width: 12px;
      height: 12px;
    }

    .save-menu-item span:first-of-type {
      flex: 1;
    }

    .save-menu-shortcut {
      font-size: 0.65rem;
      color: var(--text-muted);
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      margin-left: auto;
    }
    
    .save-menu-footer {
      display: block;
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: rgba(255, 255, 255, 0.02);
      border: none;
      border-top: 1px solid var(--border-color);
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.15s ease;
      font-size: 0.65rem;
      text-align: left;
      word-wrap: break-word;
      white-space: normal;
      line-height: 1.3;
    }
    
    .save-menu-footer:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-primary);
    }
    
    @keyframes greenFlash {
      0% { border-color: var(--success); color: var(--success); }
      100% { border-color: var(--text-muted); color: var(--text-muted); }
    }
    
    /* Editor container */
    .editor-container {
      flex: 1;
      display: flex;
      justify-content: center;
      padding: 2rem;
      overflow-y: auto;
    }
    
    .editor-wrapper {
      width: 100%;
      max-width: 700px;
    }
    
    /* The actual editor */
    #editor {
      font-family: 'Charter', 'Georgia', 'Cambria', 'Times New Roman', serif;
      font-size: 1.125rem;
      line-height: 1.8;
      color: var(--text-primary);
      background: transparent;
      border: none;
      outline: none;
      width: 100%;
      min-height: calc(100vh - 200px);
      resize: none;
      padding: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    
    #editor:focus {
      outline: none;
    }
    
    /* Placeholder */
    #editor:empty:before {
      content: attr(data-placeholder);
      color: var(--text-muted);
      font-style: italic;
      pointer-events: none;
    }
    
    /* Footer */
    .footer {
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      padding: 0.5rem 1.5rem;
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.7rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
    }
    
    .footer svg {
      opacity: 0.7;
    }
    
    #authorDisplay {
      display: flex;
      align-items: center;
    }
    
    .keyboard-hint {
      display: flex;
      gap: 1rem;
    }
    
    .keyboard-hint kbd {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 3px;
      padding: 0.125rem 0.375rem;
      font-family: inherit;
    }
    
    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
    }
    
    ::-webkit-scrollbar-track {
      background: var(--bg-primary);
    }
    
    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted);
    }
    
    /* === OVERVIEW MODE STYLES === */
    
    /* Default: Hide editors based on body class */
    body:not(.mode-prose) .editor-container {
      display: none;
    }
    
    body:not(.mode-structured) .structured-editor {
      display: none;
    }
    
    /* Prose mode: Show only prose editor */
    body.mode-prose .editor-container {
      display: flex;
    }
    
    /* Structured mode: Show attributes OR content */
    body.mode-structured .structured-editor.active {
      display: block;
    }
    
    /* === OVERVIEW MODE === */
    /* Hide separate prose sections by default */
    .prose-section {
      display: none !important;
    }

    /* Hide main prose editor in overview mode */
    body.mode-overview #proseEditor {
      display: none !important;
    }

    /* Show prose sections in overview mode */
    body.mode-overview .prose-section {
      display: block !important;
      width: 100%;
      max-width: 900px;
      margin: 2rem auto 0.75rem;
      box-sizing: border-box;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 1.5rem;
      overflow: visible;
    }

    /* Show all structured sections in overview mode */
    body.mode-overview .structured-editor {
      display: block !important;
      width: 100%;
      max-width: 900px;
      margin: 2rem auto 0.75rem;
      box-sizing: border-box;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow-y: auto;
      overflow-x: visible;
      padding: 0;
    }

    /* Style prose editor content in overview sections */
    .prose-section .prose-editor-content {
      min-height: 100px;
      outline: none;
      font-family: var(--font-prose);
      font-size: var(--prose-font-size);
      line-height: var(--prose-line-height);
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .prose-section .prose-editor-content:empty::before {
      content: attr(data-placeholder);
      color: var(--text-muted);
      font-style: italic;
    }

    .prose-section .prose-editor-content:focus:empty::before {
      content: '';
    }

    /* Overview section header (for prose/summary) */
    .overview-section-header {
      margin-top: 0;
      margin-bottom: 1rem;
      cursor: pointer;
      transition: color 0.15s ease;
      user-select: none;
    }

    .overview-section-header:hover .structured-title {
      color: var(--text-primary);
    }

    /* Show overview section header only in overview mode */
    body.mode-overview .overview-section-header {
      display: block !important;
    }
    
    /* Make structured titles (Attributes, Content Sections) clickable in overview mode */
    body.mode-overview .overview-section-header-inline {
      cursor: pointer;
      transition: color 0.15s ease;
      user-select: none;
    }
    
    body.mode-overview .overview-section-header-inline:hover {
      color: var(--text-primary);
    }
    
    /* Ensure structured editor containers don't override width */
    body.mode-overview .structured-editor #attributesContainer,
    body.mode-overview .structured-editor #contentContainer {
      width: 100%;
      box-sizing: border-box;
    }
    
    /* Style structured headers in overview mode */
    body.mode-overview .structured-header {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      font-weight: 600;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    body.mode-overview .structured-title {
      flex: 1;
    }
    
    /* Make content sections collapsible in overview */
    body.mode-overview .content-section {
      margin-bottom: 0.5rem;
    }
    
    body.mode-overview .content-section-header {
      transition: background 0.15s ease;
    }
    
    body.mode-overview .content-section-header:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    
    /* Adjust spacing in overview mode */
    body.mode-overview .editor-wrapper {
      max-width: 100%;
    }
    
    body.mode-overview #editor {
      min-height: 150px;
    }
    
    /* Hide empty attributes/content sections in overview mode */
    body.mode-overview #attributesEditor:has(.empty-state) {
      display: none !important;
    }

    body.mode-overview #contentEditor:has(.empty-state) {
      display: none !important;
    }

    /* === IMAGES GALLERY === */

    /* Hide images section when empty (class removed by JS when images are added) */
    .images-empty-hidden {
      display: none !important;
    }

    /* Thumbnail grid in overview mode — dynamic columns (1-4) based on count */
    .images-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      padding: 8px 0;
    }
    .images-grid:has(> :nth-child(1):last-child) {
      grid-template-columns: 1fr;
      max-width: 320px;
    }
    .images-grid:has(> :nth-child(2):last-child) {
      grid-template-columns: repeat(2, 1fr);
    }
    .images-grid:has(> :nth-child(3):last-child) {
      grid-template-columns: repeat(3, 1fr);
    }

    .image-thumbnail {
      position: relative;
      cursor: pointer;
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg-secondary);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .image-thumbnail:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .image-thumbnail:focus,
    .gallery-item:focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .image-thumbnail:focus-visible,
    .gallery-item:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .image-thumbnail img {
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: cover;
      display: block;
    }

    .thumbnail-caption {
      padding: 6px 8px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: var(--bg-secondary);
    }

    .featured-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--accent);
      color: white;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      z-index: 1;
    }

    .images-empty {
      padding: 2rem;
      text-align: center;
      color: var(--text-muted);
      font-style: italic;
    }

    /* Full gallery view (images mode) */
    .images-full-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
      padding: 16px 0;
    }

    .gallery-item {
      position: relative;
      cursor: pointer;
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-secondary);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .gallery-item:hover {
      transform: translateY(-3px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .gallery-item img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      display: block;
    }

    .gallery-caption {
      padding: 10px 12px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      background: var(--bg-secondary);
    }

    /* === IMAGE MODAL === */

    .image-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
    }

    .modal-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
    }

    .modal-content {
      position: relative;
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .modal-close {
      position: absolute;
      top: -40px;
      right: 0;
      background: none;
      border: none;
      color: white;
      font-size: 2rem;
      cursor: pointer;
      padding: 8px;
      line-height: 1;
      opacity: 0.8;
      transition: opacity 0.15s;
    }

    .modal-close:hover {
      opacity: 1;
    }

    .modal-counter {
      position: absolute;
      top: -40px;
      left: 0;
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.9rem;
    }

    .modal-image-container {
      display: flex;
      align-items: center;
      justify-content: center;
      max-height: 70vh;
    }

    .modal-image-container img {
      max-width: 90vw;
      max-height: 70vh;
      object-fit: contain;
      border-radius: 4px;
    }

    .modal-caption-container {
      margin-top: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      max-width: 500px;
    }

    .modal-caption-container label {
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .modal-caption-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      font-size: 0.9rem;
    }

    .modal-caption-input:focus {
      outline: none;
      border-color: var(--accent);
      background: rgba(255, 255, 255, 0.15);
    }

    .modal-caption-input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    .modal-delete-btn {
      padding: 8px 12px;
      background: rgba(255, 100, 100, 0.2);
      border: 1px solid rgba(255, 100, 100, 0.4);
      border-radius: 4px;
      color: #ff6b6b;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }

    .modal-delete-btn:hover {
      background: rgba(255, 100, 100, 0.3);
      border-color: rgba(255, 100, 100, 0.6);
    }

    /* === CONFIRM MODAL === */

    .confirm-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1002;
      display: none;
      align-items: center;
      justify-content: center;
    }

    .confirm-content {
      position: relative;
      background: var(--bg-primary);
      border-radius: 8px;
      padding: 24px;
      max-width: 400px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      text-align: center;
    }

    .confirm-content h3 {
      margin: 0 0 12px 0;
      color: var(--text-primary);
      font-size: 1.1rem;
    }

    .confirm-content p {
      margin: 0 0 20px 0;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .confirm-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
    }

    .confirm-btn {
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .confirm-cancel {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }

    .confirm-cancel:hover {
      background: var(--bg-tertiary, var(--bg-secondary));
    }

    .confirm-ok {
      background: #e53935;
      border: none;
      color: white;
    }

    .confirm-ok:hover {
      background: #c62828;
    }

    .confirm-btn:focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* === TOAST NOTIFICATIONS === */

    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 0.9rem;
      z-index: 1003;
      animation: toast-in 0.3s ease;
    }

    .toast.error {
      background: #c62828;
    }

    .toast.success {
      background: #2e7d32;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    @keyframes toast-out {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
    }

    .toast.fade-out {
      animation: toast-out 0.3s ease forwards;
    }

    /* === DUPLICATE IMAGE MODAL === */

    .duplicate-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1002;
      display: none;
      align-items: center;
      justify-content: center;
    }

    .duplicate-content {
      position: relative;
      background: var(--bg-primary);
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      text-align: center;
    }

    .duplicate-content h3 {
      margin: 0 0 8px 0;
      color: var(--text-primary);
      font-size: 1.1rem;
    }

    .duplicate-content p {
      margin: 0 0 12px 0;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .duplicate-path {
      background: var(--bg-secondary);
      border-radius: 4px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--text-primary);
      margin-bottom: 16px;
      word-break: break-all;
    }

    .duplicate-preview {
      margin-bottom: 20px;
      max-height: 200px;
      overflow: hidden;
      border-radius: 4px;
      background: var(--bg-secondary);
    }

    .duplicate-preview img {
      max-width: 100%;
      max-height: 200px;
      object-fit: contain;
    }

    .duplicate-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .duplicate-btn {
      padding: 10px 20px;
      border-radius: 4px;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .duplicate-use-existing {
      background: var(--accent);
      border: none;
      color: white;
    }

    .duplicate-use-existing:hover {
      filter: brightness(1.1);
    }

    .duplicate-import {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }

    .duplicate-import:hover {
      background: var(--bg-tertiary, var(--bg-secondary));
    }

    .duplicate-cancel {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }

    .duplicate-cancel:hover {
      background: var(--bg-secondary);
    }

    .duplicate-btn:focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .modal-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: white;
      font-size: 2.5rem;
      padding: 16px 12px;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.15s, background 0.15s;
      border-radius: 4px;
    }

    .modal-nav:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.2);
    }

    .modal-prev {
      left: -60px;
    }

    .modal-next {
      right: -60px;
    }

    .modal-nav:disabled {
      opacity: 0.2;
      cursor: not-allowed;
    }

    /* Images section in overview mode */
    body.mode-overview #imagesEditor {
      display: block !important;
    }

    /* Images view mode */
    body.mode-images #imagesEditor {
      display: block !important;
      width: 100%;
      max-width: 900px;
      margin: 2rem auto;
    }

    #imagesEditor {
      display: none;
    }

    /* === IMAGE BROWSER MODAL === */

    .image-browser-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1001;
      display: none;
      align-items: center;
      justify-content: center;
    }

    .image-browser-content {
      position: relative;
      width: 90%;
      max-width: 800px;
      max-height: 80vh;
      background: var(--bg-primary);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }

    .browser-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
    }

    .browser-header h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .browser-tabs {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      padding: 0 16px;
    }

    .tab-btn {
      padding: 12px 20px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: 0.9rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color 0.15s, border-color 0.15s;
    }

    .tab-btn:hover {
      color: var(--text-primary);
    }

    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .browser-tab-content {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .browser-search-container {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .image-search {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 0.9rem;
    }

    .image-search:focus {
      outline: none;
      border-color: var(--accent);
    }

    .image-browser-grid {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
      align-content: start;
    }

    .browser-loading {
      grid-column: 1 / -1;
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
      font-style: italic;
    }

    .browser-loading::before {
      content: '';
      display: block;
      width: 32px;
      height: 32px;
      margin: 0 auto 12px;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .browser-empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
    }

    .browser-image-item {
      cursor: pointer;
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg-secondary);
      transition: transform 0.15s, box-shadow 0.15s;
      border: 2px solid transparent;
    }

    .browser-image-item:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      border-color: var(--accent);
    }

    .browser-image-item img {
      width: 100%;
      height: 100px;
      object-fit: cover;
      display: block;
    }

    .browser-image-name {
      padding: 6px 8px 2px;
      font-size: 0.75rem;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .browser-image-folder {
      padding: 0 8px 6px;
      font-size: 0.65rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Import Tab */
    .import-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      text-align: center;
    }

    .import-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }

    .import-text {
      color: var(--text-primary);
      margin-bottom: 1.5rem;
      font-size: 1rem;
    }

    .import-btn {
      padding: 12px 24px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .import-btn:hover {
      background: var(--accent-hover);
    }

    .import-hint {
      margin-top: 1rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* === DRAG AND DROP REORDER === */

    .image-thumbnail[draggable="true"],
    .gallery-item[draggable="true"] {
      cursor: grab;
    }

    .image-thumbnail.dragging,
    .gallery-item.dragging {
      opacity: 0.5;
      cursor: grabbing;
    }

    .image-thumbnail.drag-over,
    .gallery-item.drag-over {
      border: 2px dashed var(--accent);
      transform: scale(1.02);
    }

    .image-thumbnail.drag-over-left::before,
    .gallery-item.drag-over-left::before {
      content: '';
      position: absolute;
      left: -4px;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--accent);
      border-radius: 2px;
    }

    .image-thumbnail.drag-over-right::after,
    .gallery-item.drag-over-right::after {
      content: '';
      position: absolute;
      right: -4px;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--accent);
      border-radius: 2px;
    }

    /* === CONTEXT TOOLBAR STYLES === */
    ${getToolbarStyles()}
  `;
}
