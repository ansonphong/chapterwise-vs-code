/**
 * Color Manager - Node color assignment and visualization
 * Provides macOS-style folder color functionality for visual organization
 */

import * as vscode from 'vscode';
import * as YAML from 'yaml';
import { CodexNode, PathSegment } from './codexModel';
import { NavigatorSettings } from './settingsManager';

/**
 * Color preset definition
 */
export interface ColorPreset {
  name: string;
  hex: string;
  description: string;
  emoji: string;  // Visual indicator
}

/**
 * Color Manager - Handles node coloring
 */
export class ColorManager {
  /**
   * Predefined color presets
   */
  private readonly COLOR_PRESETS: ColorPreset[] = [
    { name: 'Red', hex: '#EF4444', description: 'Urgent, Important, Needs Work', emoji: '🔴' },
    { name: 'Orange', hex: '#F97316', description: 'In Progress, Active', emoji: '🟠' },
    { name: 'Yellow', hex: '#EAB308', description: 'Review, Caution', emoji: '🟡' },
    { name: 'Green', hex: '#10B981', description: 'Complete, Approved', emoji: '🟢' },
    { name: 'Blue', hex: '#3B82F6', description: 'Chapter, Main Content', emoji: '🔵' },
    { name: 'Purple', hex: '#8B5CF6', description: 'Character, NPC', emoji: '🟣' },
    { name: 'Pink', hex: '#EC4899', description: 'Romance, Relationship', emoji: '🩷' },
    { name: 'Gray', hex: '#6B7280', description: 'Note, Reference', emoji: '⚫' },
    { name: 'No Color', hex: '', description: 'Remove color', emoji: '⚪' }
  ];
  
  private static readonly HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

  isValidHexColor(value: unknown): value is string {
    return typeof value === 'string' && ColorManager.HEX_COLOR_RE.test(value);
  }

  /**
   * Extract color from node attributes
   *
   * @param node - The codex node
   * @returns Hex color string or null
   */
  getNodeColor(node: CodexNode): string | null {
    if (!node.attributes) {
      return null;
    }

    const colorAttr = node.attributes.find(attr => attr.key === 'color');
    if (!colorAttr || !this.isValidHexColor(colorAttr.value)) {
      return null;
    }

    return colorAttr.value;
  }
  
  /**
   * Get effective color for a node (considering inheritance)
   * 
   * @param node - The codex node
   * @param settings - Navigator settings
   * @returns Object with color and whether it's inherited
   */
  getEffectiveColor(
    node: CodexNode,
    settings: NavigatorSettings
  ): { color: string | null; inherited: boolean } {
    // Check node's own color
    const ownColor = this.getNodeColor(node);
    if (ownColor) {
      return { color: ownColor, inherited: false };
    }
    
    // Check inheritance setting
    if (!settings.colors?.inheritFromParent) {
      return { color: null, inherited: false };
    }
    
    // Walk up parent chain to find inherited color
    let current = node.parent;
    while (current) {
      const parentColor = this.getNodeColor(current);
      if (parentColor) {
        return { color: parentColor, inherited: true };
      }
      current = current.parent;
    }
    
    // Check default color for type
    if (node.type && settings.colors?.defaultColors?.[node.type]) {
      return { 
        color: settings.colors.defaultColors[node.type], 
        inherited: false 
      };
    }
    
    return { color: null, inherited: false };
  }
  
  /**
   * Show color picker and update node color
   * 
   * @param node - The codex node
   * @param document - The document containing the node
   * @returns Success/failure
   */
  async changeColor(
    node: CodexNode,
    document: vscode.TextDocument
  ): Promise<boolean> {
    // Show quick pick with color presets
    const items: Array<{
      label: string; description: string; detail: string; preset: ColorPreset | null;
    }> = this.COLOR_PRESETS.map(preset => ({
      label: `${preset.emoji} ${preset.name}`,
      description: preset.description,
      detail: preset.hex || 'Remove color',
      preset: preset
    }));

    items.push({
      label: '$(symbol-color) Custom Color...',
      description: 'Enter custom hex color',
      detail: '#RRGGBB',
      preset: null
    });
    
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a color for this node',
      matchOnDescription: true,
      matchOnDetail: true
    });
    
    if (!selected) {
      return false;  // User cancelled
    }
    
    let colorHex: string | null;
    
    if (selected.preset) {
      // Use preset color
      colorHex = selected.preset.hex || null;
    } else {
      // Custom color input
      const input = await vscode.window.showInputBox({
        prompt: 'Enter hex color code',
        placeHolder: '#3B82F6',
        validateInput: (value) => {
          if (!value) {
            return null;  // Allow empty to remove color
          }
          if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
            return 'Invalid hex color. Format: #RRGGBB';
          }
          return null;
        }
      });
      
      if (input === undefined) {
        return false;  // User cancelled
      }
      
      colorHex = input || null;
    }
    
    // Update node color
    return await this.updateNodeColor(node, document, colorHex);
  }
  
  /**
   * Update node color in YAML
   * 
   * @param node - The codex node
   * @param document - The document containing the node
   * @param color - Hex color string or null to remove
   * @returns Success/failure
   */
  async updateNodeColor(
    node: CodexNode,
    document: vscode.TextDocument,
    color: string | null
  ): Promise<boolean> {
    try {
      if (color !== null && !this.isValidHexColor(color)) {
        vscode.window.showErrorMessage(`Invalid color format: "${color}". Expected #RRGGBB.`);
        return false;
      }

      // Parse YAML document
      const text = document.getText();
      const yamlDoc = YAML.parseDocument(text);
      
      // Build path to node
      const nodePath = this.buildYamlPath(node.path);
      const nodeValue = yamlDoc.getIn(nodePath);
      
      if (!nodeValue) {
        vscode.window.showErrorMessage('Node not found in document');
        return false;
      }
      
      // Get or create attributes array
      const attributesPath = [...nodePath, 'attributes'];
      let attributes = yamlDoc.getIn(attributesPath);
      
      if (!attributes) {
        // Create attributes array
        yamlDoc.setIn(attributesPath, []);
        attributes = yamlDoc.getIn(attributesPath);
      }
      
      if (!Array.isArray(attributes)) {
        vscode.window.showErrorMessage('Attributes is not an array');
        return false;
      }
      
      // Find existing color attribute
      const colorIndex = attributes.findIndex((attr: any) => attr.key === 'color');
      
      if (color === null) {
        // Remove color
        if (colorIndex >= 0) {
          attributes.splice(colorIndex, 1);
        }
      } else {
        // Add or update color
        const colorAttr = {
          key: 'color',
          value: color
        };
        
        if (colorIndex >= 0) {
          attributes[colorIndex] = colorAttr;
        } else {
          attributes.push(colorAttr);
        }
      }
      
      // Apply edit to document
      const newText = yamlDoc.toString();
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        newText
      );
      
      const editApplied = await vscode.workspace.applyEdit(edit);
      if (!editApplied) {
        vscode.window.showErrorMessage('Failed to apply color edit to document');
        return false;
      }
      await document.save();
      
      vscode.window.setStatusBarMessage(
        color 
          ? `✓ Color updated to ${color}` 
          : '✓ Color removed',
        2000
      );
      
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update color: ${error}`);
      return false;
    }
  }
  
  /**
   * Get color decoration for tree item
   * Returns a ThemeIcon with appropriate color
   * 
   * @param node - The codex node
   * @param settings - Navigator settings
   * @returns ThemeIcon with color or null
   */
  getColorDecoration(
    node: CodexNode,
    settings: NavigatorSettings
  ): vscode.ThemeIcon | null {
    const { color, inherited } = this.getEffectiveColor(node, settings);
    
    if (!color) {
      return null;
    }
    
    // Use circle icon as color indicator
    // If inherited and showInheritedDimmed is true, use different opacity
    const iconId = inherited && settings.colors.showInheritedDimmed
      ? 'circle-outline'  // Dimmed/outline for inherited
      : 'circle-filled';  // Solid for own color
    
    return new vscode.ThemeIcon(iconId, new vscode.ThemeColor(this.hexToThemeColor(color)));
  }
  
  /**
   * Get color as CSS style string for webviews
   * 
   * @param node - The codex node
   * @param settings - Navigator settings
   * @returns CSS color string or null
   */
  getColorStyle(
    node: CodexNode,
    settings: NavigatorSettings
  ): string | null {
    const { color, inherited } = this.getEffectiveColor(node, settings);
    
    if (!color) {
      return null;
    }
    
    // Apply opacity if inherited and setting is enabled
    if (inherited && settings.colors.showInheritedDimmed) {
      return `${color}80`;  // Add 80 for 50% opacity
    }
    
    return color;
  }
  
  /**
   * Batch update colors for multiple nodes
   * 
   * @param nodes - Array of nodes
   * @param document - The document containing the nodes
   * @param color - Color to apply or null to remove
   * @returns Number of successfully updated nodes
   */
  async batchUpdateColors(
    nodes: CodexNode[],
    document: vscode.TextDocument,
    color: string | null
  ): Promise<number> {
    let successCount = 0;
    
    for (const node of nodes) {
      const success = await this.updateNodeColor(node, document, color);
      if (success) {
        successCount++;
      }
    }
    
    if (successCount > 0) {
      vscode.window.setStatusBarMessage(
        `✓ Updated color for ${successCount} node(s)`,
        3000
      );
    }
    
    return successCount;
  }
  
  /**
   * Get all color presets
   */
  getColorPresets(): ColorPreset[] {
    return [...this.COLOR_PRESETS];
  }
  
  // ============ PRIVATE HELPER METHODS ============
  
  /**
   * Build YAML path from PathSegment array.
   * node.path already contains 'children' segments from codexModel parsing,
   * so this is a simple pass-through (matching codexModel.setNodeProse pattern).
   */
  private buildYamlPath(pathSegments: PathSegment[]): (string | number)[] {
    return pathSegments.map(p => typeof p === 'number' ? p : String(p));
  }
  
  /**
   * Convert hex color to VS Code theme color name.
   *
   * VS Code ThemeIcon only supports named theme colors, not arbitrary hex.
   * Known preset hex values map to semantically similar theme colors.
   * Custom/unknown hex colors fall back to 'foreground' (default text color).
   */
  private hexToThemeColor(hex: string): string {
    // Map common hex colors to VS Code theme color names
    const colorMap: Record<string, string> = {
      '#EF4444': 'errorForeground',
      '#F97316': 'editorWarning.foreground',
      '#EAB308': 'editorWarning.foreground',
      '#10B981': 'testing.iconPassed',
      '#3B82F6': 'symbolIcon.classForeground',
      '#8B5CF6': 'symbolIcon.variableForeground',
      '#EC4899': 'symbolIcon.propertyForeground',
      '#6B7280': 'descriptionForeground'
    };
    
    return colorMap[hex] || 'foreground';
  }
}

/**
 * Singleton instance
 */
let colorManagerInstance: ColorManager | null = null;

/**
 * Get the color manager instance
 */
export function getColorManager(): ColorManager {
  if (!colorManagerInstance) {
    colorManagerInstance = new ColorManager();
  }
  return colorManagerInstance;
}

/**
 * Dispose the color manager
 */
export function disposeColorManager(): void {
  colorManagerInstance = null;
}
