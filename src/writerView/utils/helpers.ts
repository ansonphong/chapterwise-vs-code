/**
 * Utility helper functions for Writer View
 */

import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Generate a cryptographically secure nonce for Content Security Policy
 */
export function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Safely post a message to a webview panel, ignoring errors if the panel is disposed
 */
export function safePostMessage(panel: import('vscode').WebviewPanel, message: unknown): void {
  try {
    panel.webview.postMessage(message);
  } catch {
    // Panel was disposed between check and postMessage - ignore
  }
}

/**
 * Validate that a path resolves within the workspace root (prevents path traversal)
 */
export function isPathWithinWorkspace(targetPath: string, workspaceRoot: string): boolean {
  if (!workspaceRoot) {
    return false;
  }
  const resolved = path.resolve(workspaceRoot, targetPath);
  const relative = path.relative(workspaceRoot, resolved);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

