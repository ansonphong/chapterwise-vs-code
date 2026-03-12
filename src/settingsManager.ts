/**
 * Settings Manager - Configuration resolution system
 *
 * Implements cascading configuration hierarchy:
 * 1. Per-Codex Settings (in individual .codex.yaml files) - HIGHEST PRIORITY
 * 2. Project Settings (in .index.codex.json)
 * 3. VS Code Settings (global defaults)
 * 4. Built-in Defaults - LOWEST PRIORITY
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { CodexDocument } from './codexModel';

// Valid enum values for settings
const VALID_CHILD_MODES = ['inline', 'separate-file', 'ask'] as const;
const VALID_STRATEGIES = ['organized', 'data-folder', 'flat'] as const;
const VALID_FORMATS = ['string', 'object'] as const;
const VALID_SEPARATORS = ['-', '_', ' ', '.'] as const;

/**
 * Validate dataFolderPath - prevent path traversal
 * Rejects: "..", absolute paths, backslashes
 */
function validateDataFolderPath(pathValue: string | undefined): string {
  const defaultPath = 'Files/Data';
  if (!pathValue || typeof pathValue !== 'string') {
    return defaultPath;
  }

  // Reject path traversal attempts
  if (pathValue.includes('..')) {
    console.warn(`[Settings] Invalid dataFolderPath contains "..": ${pathValue}, using default`);
    return defaultPath;
  }

  // Reject absolute paths (Unix or Windows)
  if (pathValue.startsWith('/') || /^[A-Za-z]:/.test(pathValue)) {
    console.warn(`[Settings] Invalid dataFolderPath is absolute: ${pathValue}, using default`);
    return defaultPath;
  }

  // Reject backslashes (normalize to forward slashes)
  if (pathValue.includes('\\')) {
    console.warn(`[Settings] dataFolderPath contains backslashes, normalizing: ${pathValue}`);
    pathValue = pathValue.replace(/\\/g, '/');
  }

  return pathValue;
}

/**
 * Validate separator - only allow safe single characters
 */
function validateSeparator(sep: string | undefined): string {
  const defaultSep = '-';
  if (!sep || typeof sep !== 'string') {
    return defaultSep;
  }

  // Only allow single safe characters
  if (!VALID_SEPARATORS.includes(sep as any)) {
    console.warn(`[Settings] Invalid separator "${sep}", using default "-"`);
    return defaultSep;
  }

  return sep;
}

/**
 * Validate defaultChildMode enum
 */
function validateChildMode(mode: string | undefined): 'inline' | 'separate-file' | 'ask' {
  if (mode && VALID_CHILD_MODES.includes(mode as any)) {
    return mode as 'inline' | 'separate-file' | 'ask';
  }
  return 'ask';
}

/**
 * Validate strategy enum
 */
function validateStrategy(strategy: string | undefined): 'organized' | 'data-folder' | 'flat' {
  if (strategy && VALID_STRATEGIES.includes(strategy as any)) {
    return strategy as 'organized' | 'data-folder' | 'flat';
  }
  return 'organized';
}

/**
 * Validate format enum
 */
function validateFormat(format: string | undefined): 'string' | 'object' {
  if (format && VALID_FORMATS.includes(format as any)) {
    return format as 'string' | 'object';
  }
  return 'string';
}

/**
 * Navigator settings interface
 */
export interface NavigatorSettings {
  // Core behavior
  defaultChildMode: 'inline' | 'separate-file' | 'ask';
  
  // File organization
  fileOrganization: {
    strategy: 'organized' | 'data-folder' | 'flat';
    dataFolderPath: string;
    useUuidFilenames: boolean;
  };
  
  // Naming conventions
  naming: {
    slugify: boolean;
    preserveCase: boolean;
    separator: string;
    includeType: boolean;
    includeParent: boolean;
  };
  
  // Include directives
  includes: {
    preferRelative: boolean;
    format: 'string' | 'object';
  };
  
  // Automation
  automation: {
    autoGenerateIds: boolean;
    autoGenerateIndex: boolean;
    autoSort: boolean;
    autoSave: boolean;
  };
  
  // Safety & validation
  safety: {
    confirmDelete: boolean;
    confirmMove: boolean;
    validateOnSave: boolean;
    backupBeforeDestruct: boolean;
  };
  
  // Color coding
  colors: {
    inheritFromParent: boolean;
    showInheritedDimmed: boolean;
    defaultColors: {
      [type: string]: string;
    };
  };
}

/**
 * Settings Manager - Resolves navigator configuration
 */
export class NavigatorSettingsManager {
  private static instance: NavigatorSettingsManager | null = null;
  
  private constructor() {}
  
  /**
   * Get the singleton instance
   */
  static getInstance(): NavigatorSettingsManager {
    if (!this.instance) {
      this.instance = new NavigatorSettingsManager();
    }
    return this.instance;
  }
  
  /**
   * Get resolved settings for a specific codex file
   * Implements cascading: per-codex → project → VS Code → defaults
   * 
   * @param documentUri - URI of the current document
   * @param codexDoc - Parsed codex document (optional, for per-codex settings)
   * @returns Resolved settings
   */
  async getSettings(
    documentUri: vscode.Uri,
    codexDoc?: CodexDocument
  ): Promise<NavigatorSettings> {
    // 1. Start with defaults
    const defaults = this.getDefaultSettings();
    
    // 2. Merge with VS Code settings
    const vscodeSettings = this.getVSCodeSettings();
    const merged1 = this.mergeSettings(defaults, vscodeSettings);
    
    // 3. Merge with project settings (from .index.codex.json)
    const projectSettings = await this.getProjectSettings(documentUri);
    const merged2 = this.mergeSettings(merged1, projectSettings);
    
    // 4. Merge with per-codex settings (highest priority)
    if (codexDoc) {
      const perCodexSettings = this.extractPerCodexSettings(codexDoc);
      return this.mergeSettings(merged2, perCodexSettings);
    }
    
    return merged2;
  }
  
  /**
   * Get settings for workspace (no specific file)
   * Uses: VS Code → defaults
   */
  getWorkspaceSettings(): NavigatorSettings {
    const defaults = this.getDefaultSettings();
    const vscodeSettings = this.getVSCodeSettings();
    return this.mergeSettings(defaults, vscodeSettings);
  }
  
  /**
   * Get project-wide settings from .index.codex.json
   */
  private async getProjectSettings(
    fileUri: vscode.Uri
  ): Promise<Partial<NavigatorSettings>> {
    try {
      // Find .index.codex.json in workspace
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
      if (!workspaceFolder) {
        return {};
      }
      
      const indexPath = path.join(workspaceFolder.uri.fsPath, '.index.codex.json');
      
      if (!fs.existsSync(indexPath)) {
        return {};
      }
      
      // Parse index file
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      const indexDoc = JSON.parse(indexContent);
      
      // Extract navigatorSettings
      return this.extractNavigatorSettingsFromYaml(indexDoc);
    } catch (error) {
      console.error('Error reading project settings:', error);
      return {};
    }
  }
  
  /**
   * Extract settings from VS Code configuration
   */
  private getVSCodeSettings(): Partial<NavigatorSettings> {
    const config = vscode.workspace.getConfiguration('chapterwise.navigator');
    
    const settings: Partial<NavigatorSettings> = {};
    
    // Core behavior
    const defaultChildMode = config.get<string>('defaultChildMode');
    if (defaultChildMode) {
      settings.defaultChildMode = validateChildMode(defaultChildMode);
    }
    
    // File organization
    const strategy = config.get<string>('fileOrganization.strategy');
    const dataFolderPath = config.get<string>('fileOrganization.dataFolderPath');
    const useUuidFilenames = config.get<boolean>('fileOrganization.useUuidFilenames');
    
    if (strategy || dataFolderPath !== undefined || useUuidFilenames !== undefined) {
      settings.fileOrganization = {
        strategy: validateStrategy(strategy),
        dataFolderPath: validateDataFolderPath(dataFolderPath),
        useUuidFilenames: useUuidFilenames !== undefined ? useUuidFilenames : false
      };
    }
    
    // Naming
    const slugify = config.get<boolean>('naming.slugify');
    const preserveCase = config.get<boolean>('naming.preserveCase');
    const separator = config.get<string>('naming.separator');
    const includeType = config.get<boolean>('naming.includeType');
    const includeParent = config.get<boolean>('naming.includeParent');
    
    if (slugify !== undefined || preserveCase !== undefined || separator || 
        includeType !== undefined || includeParent !== undefined) {
      settings.naming = {
        slugify: slugify !== undefined ? slugify : true,
        preserveCase: preserveCase !== undefined ? preserveCase : false,
        separator: validateSeparator(separator),
        includeType: includeType !== undefined ? includeType : false,
        includeParent: includeParent !== undefined ? includeParent : false
      };
    }
    
    // Includes
    const preferRelative = config.get<boolean>('includes.preferRelative');
    const format = config.get<string>('includes.format');
    
    if (preferRelative !== undefined || format) {
      settings.includes = {
        preferRelative: preferRelative !== undefined ? preferRelative : true,
        format: validateFormat(format)
      };
    }
    
    // Automation
    const autoGenerateIds = config.get<boolean>('automation.autoGenerateIds');
    const autoGenerateIndex = config.get<boolean>('automation.autoGenerateIndex');
    const autoSort = config.get<boolean>('automation.autoSort');
    const autoSave = config.get<boolean>('automation.autoSave');
    
    if (autoGenerateIds !== undefined || autoGenerateIndex !== undefined || 
        autoSort !== undefined || autoSave !== undefined) {
      settings.automation = {
        autoGenerateIds: autoGenerateIds !== undefined ? autoGenerateIds : true,
        autoGenerateIndex: autoGenerateIndex !== undefined ? autoGenerateIndex : true,
        autoSort: autoSort !== undefined ? autoSort : false,
        autoSave: autoSave !== undefined ? autoSave : true
      };
    }
    
    // Safety
    const confirmDelete = config.get<boolean>('safety.confirmDelete');
    const confirmMove = config.get<boolean>('safety.confirmMove');
    const validateOnSave = config.get<boolean>('safety.validateOnSave');
    const backupBeforeDestruct = config.get<boolean>('safety.backupBeforeDestruct');
    
    if (confirmDelete !== undefined || confirmMove !== undefined || 
        validateOnSave !== undefined || backupBeforeDestruct !== undefined) {
      settings.safety = {
        confirmDelete: confirmDelete !== undefined ? confirmDelete : true,
        confirmMove: confirmMove !== undefined ? confirmMove : false,
        validateOnSave: validateOnSave !== undefined ? validateOnSave : true,
        backupBeforeDestruct: backupBeforeDestruct !== undefined ? backupBeforeDestruct : true
      };
    }
    
    // Colors
    const inheritFromParent = config.get<boolean>('colors.inheritFromParent');
    const showInheritedDimmed = config.get<boolean>('colors.showInheritedDimmed');
    const defaultColors = config.get<any>('colors.defaultColors');
    
    if (inheritFromParent !== undefined || showInheritedDimmed !== undefined || defaultColors) {
      settings.colors = {
        inheritFromParent: inheritFromParent !== undefined ? inheritFromParent : false,
        showInheritedDimmed: showInheritedDimmed !== undefined ? showInheritedDimmed : true,
        defaultColors: defaultColors || {}
      };
    }
    
    return settings;
  }
  
  /**
   * Extract navigatorSettings from a codex document
   */
  private extractPerCodexSettings(
    doc: CodexDocument
  ): Partial<NavigatorSettings> {
    if (!doc.rawDoc) {
      return {};
    }
    
    const rawSettings = doc.rawDoc.get('navigatorSettings');
    if (!rawSettings) {
      return {};
    }
    
    return this.extractNavigatorSettingsFromYaml(rawSettings);
  }
  
  /**
   * Extract navigatorSettings from YAML object
   */
  private extractNavigatorSettingsFromYaml(yamlObj: any): Partial<NavigatorSettings> {
    if (!yamlObj || !yamlObj.navigatorSettings) {
      return {};
    }
    
    const raw = yamlObj.navigatorSettings;
    const settings: Partial<NavigatorSettings> = {};
    
    // Extract each setting, preserving structure
    if (raw.defaultChildMode) {
      settings.defaultChildMode = validateChildMode(raw.defaultChildMode);
    }
    
    if (raw.fileOrganization) {
      settings.fileOrganization = {
        strategy: validateStrategy(raw.fileOrganization.strategy),
        dataFolderPath: validateDataFolderPath(raw.fileOrganization.dataFolderPath),
        useUuidFilenames: raw.fileOrganization.useUuidFilenames !== undefined
          ? raw.fileOrganization.useUuidFilenames
          : false
      };
    }
    
    if (raw.naming) {
      settings.naming = {
        slugify: raw.naming.slugify !== undefined ? raw.naming.slugify : true,
        preserveCase: raw.naming.preserveCase !== undefined ? raw.naming.preserveCase : false,
        separator: validateSeparator(raw.naming.separator),
        includeType: raw.naming.includeType !== undefined ? raw.naming.includeType : false,
        includeParent: raw.naming.includeParent !== undefined ? raw.naming.includeParent : false
      };
    }
    
    if (raw.includes) {
      settings.includes = {
        preferRelative: raw.includes.preferRelative !== undefined ? raw.includes.preferRelative : true,
        format: validateFormat(raw.includes.format)
      };
    }
    
    if (raw.automation) {
      settings.automation = {
        autoGenerateIds: raw.automation.autoGenerateIds !== undefined ? raw.automation.autoGenerateIds : true,
        autoGenerateIndex: raw.automation.autoGenerateIndex !== undefined ? raw.automation.autoGenerateIndex : true,
        autoSort: raw.automation.autoSort !== undefined ? raw.automation.autoSort : false,
        autoSave: raw.automation.autoSave !== undefined ? raw.automation.autoSave : true
      };
    }
    
    if (raw.safety) {
      settings.safety = {
        confirmDelete: raw.safety.confirmDelete !== undefined ? raw.safety.confirmDelete : true,
        confirmMove: raw.safety.confirmMove !== undefined ? raw.safety.confirmMove : false,
        validateOnSave: raw.safety.validateOnSave !== undefined ? raw.safety.validateOnSave : true,
        backupBeforeDestruct: raw.safety.backupBeforeDestruct !== undefined ? raw.safety.backupBeforeDestruct : true
      };
    }
    
    if (raw.colors) {
      settings.colors = {
        inheritFromParent: raw.colors.inheritFromParent !== undefined ? raw.colors.inheritFromParent : false,
        showInheritedDimmed: raw.colors.showInheritedDimmed !== undefined ? raw.colors.showInheritedDimmed : true,
        defaultColors: raw.colors.defaultColors || {}
      };
    }
    
    return settings;
  }
  
  /**
   * Merge settings (second overrides first where defined)
   */
  private mergeSettings(
    base: NavigatorSettings,
    override: Partial<NavigatorSettings>
  ): NavigatorSettings {
    return {
      defaultChildMode: override.defaultChildMode || base.defaultChildMode,
      
      fileOrganization: {
        strategy: override.fileOrganization?.strategy || base.fileOrganization.strategy,
        dataFolderPath: override.fileOrganization?.dataFolderPath || base.fileOrganization.dataFolderPath,
        useUuidFilenames: override.fileOrganization?.useUuidFilenames !== undefined 
          ? override.fileOrganization.useUuidFilenames 
          : base.fileOrganization.useUuidFilenames
      },
      
      naming: {
        slugify: override.naming?.slugify !== undefined ? override.naming.slugify : base.naming.slugify,
        preserveCase: override.naming?.preserveCase !== undefined ? override.naming.preserveCase : base.naming.preserveCase,
        separator: override.naming?.separator || base.naming.separator,
        includeType: override.naming?.includeType !== undefined ? override.naming.includeType : base.naming.includeType,
        includeParent: override.naming?.includeParent !== undefined ? override.naming.includeParent : base.naming.includeParent
      },
      
      includes: {
        preferRelative: override.includes?.preferRelative !== undefined 
          ? override.includes.preferRelative 
          : base.includes.preferRelative,
        format: override.includes?.format || base.includes.format
      },
      
      automation: {
        autoGenerateIds: override.automation?.autoGenerateIds !== undefined 
          ? override.automation.autoGenerateIds 
          : base.automation.autoGenerateIds,
        autoGenerateIndex: override.automation?.autoGenerateIndex !== undefined 
          ? override.automation.autoGenerateIndex 
          : base.automation.autoGenerateIndex,
        autoSort: override.automation?.autoSort !== undefined 
          ? override.automation.autoSort 
          : base.automation.autoSort,
        autoSave: override.automation?.autoSave !== undefined 
          ? override.automation.autoSave 
          : base.automation.autoSave
      },
      
      safety: {
        confirmDelete: override.safety?.confirmDelete !== undefined 
          ? override.safety.confirmDelete 
          : base.safety.confirmDelete,
        confirmMove: override.safety?.confirmMove !== undefined 
          ? override.safety.confirmMove 
          : base.safety.confirmMove,
        validateOnSave: override.safety?.validateOnSave !== undefined 
          ? override.safety.validateOnSave 
          : base.safety.validateOnSave,
        backupBeforeDestruct: override.safety?.backupBeforeDestruct !== undefined 
          ? override.safety.backupBeforeDestruct 
          : base.safety.backupBeforeDestruct
      },
      
      colors: {
        inheritFromParent: override.colors?.inheritFromParent !== undefined 
          ? override.colors.inheritFromParent 
          : base.colors.inheritFromParent,
        showInheritedDimmed: override.colors?.showInheritedDimmed !== undefined 
          ? override.colors.showInheritedDimmed 
          : base.colors.showInheritedDimmed,
        defaultColors: {
          ...base.colors.defaultColors,
          ...override.colors?.defaultColors
        }
      }
    };
  }
  
  /**
   * Get default settings (fallback)
   */
  private getDefaultSettings(): NavigatorSettings {
    return {
      defaultChildMode: 'ask',
      
      fileOrganization: {
        strategy: 'organized',
        dataFolderPath: 'Files/Data',
        useUuidFilenames: false
      },
      
      naming: {
        slugify: true,
        preserveCase: false,
        separator: '-',
        includeType: false,
        includeParent: false
      },
      
      includes: {
        preferRelative: true,
        format: 'string'
      },
      
      automation: {
        autoGenerateIds: true,
        autoGenerateIndex: true,
        autoSort: false,
        autoSave: true
      },
      
      safety: {
        confirmDelete: true,
        confirmMove: false,
        validateOnSave: true,
        backupBeforeDestruct: true
      },
      
      colors: {
        inheritFromParent: false,
        showInheritedDimmed: true,
        defaultColors: {
          chapter: '#3B82F6',    // Blue
          character: '#8B5CF6',  // Purple
          location: '#10B981',   // Green
          scene: '#EAB308',      // Yellow
          part: '#6366F1',       // Indigo
          act: '#EC4899'         // Pink
        }
      }
    };
  }
}

/**
 * Get settings manager instance
 */
export function getSettingsManager(): NavigatorSettingsManager {
  return NavigatorSettingsManager.getInstance();
}
