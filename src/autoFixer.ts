/**
 * Auto-Fixer - Automatically repairs common integrity issues in Codex files
 * Ported from Python auto_fixer.py for use in VS Code extension
 */

import * as vscode from 'vscode';
import * as YAML from 'yaml';
import * as path from 'path';
import { generateUuid, isCodexFile, isCodexLikeFile, isMarkdownFile } from './codexModel';

/**
 * Result of an auto-fix operation
 */
export interface AutoFixResult {
  fixedText: string;
  fixesApplied: string[];
  success: boolean;
  error?: string;
}

/**
 * Markdown frontmatter and body structure
 */
interface MarkdownParts {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Auto-fixer for Codex V1.0/V1.1/V1.2 files
 */
export class CodexAutoFixer {
  private usedIds: Set<string> = new Set();
  private fixesApplied: string[] = [];
  private regenerateAllIds: boolean = false;

  /**
   * Auto-fix a codex document
   * @param text Raw document text (YAML or JSON)
   * @param regenerateAllIds If true, regenerate ALL IDs even if valid
   * @returns AutoFixResult with fixed text and list of fixes applied
   */
  autoFixCodex(text: string, regenerateAllIds: boolean = false): AutoFixResult {
    this.usedIds = new Set();
    this.fixesApplied = [];
    this.regenerateAllIds = regenerateAllIds;

    try {
      const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
      let content: any;

      // Parse the document
      if (isJson) {
        content = JSON.parse(text);
      } else {
        // Pre-process YAML to fix common syntax issues before parsing
        const preprocessedText = this.preprocessYamlSyntax(text);
        content = YAML.parse(preprocessedText);
      }

      if (!content || typeof content !== 'object') {
        return {
          fixedText: text,
          fixesApplied: [],
          success: false,
          error: 'Unable to parse document as object',
        };
      }

      // Collect existing valid IDs first (unless regenerating all)
      if (!regenerateAllIds) {
        this.collectValidIds(content);
      }

      // Apply fixes in order
      content = this.ensureV1Metadata(content);
      content = this.removeLegacyFields(content);
      content = this.fixMissingEntityFields(content, '');

      if (regenerateAllIds) {
        content = this.regenerateAllIdsInDocument(content, '');
      } else {
        content = this.fixInvalidUuids(content, '');
        content = this.fixDuplicateIds(content);
      }

      content = this.fixInvalidAttributeStructure(content, '');
      content = this.fixInvalidRelationStructure(content, '');
      content = this.cleanEmptyNames(content, '');
      content = this.autoCalculateTimecodes(content);

      // Serialize back to text
      let fixedText: string;
      if (isJson) {
        fixedText = JSON.stringify(content, null, 2);
      } else {
        // Use custom YAML stringification with block scalars for long strings
        fixedText = this.serializeToYaml(content);
      }

      return {
        fixedText,
        fixesApplied: this.fixesApplied,
        success: true,
      };
    } catch (error) {
      return {
        fixedText: text,
        fixesApplied: this.fixesApplied,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Auto-fix a Codex Lite (Markdown) document
   * @param text Raw markdown text with YAML frontmatter
   * @param fileName Optional filename for extracting name fallback
   * @returns AutoFixResult with fixed text and list of fixes applied
   */
  autoFixCodexLite(text: string, fileName?: string): AutoFixResult {
    this.usedIds = new Set();
    this.fixesApplied = [];

    try {
      const { frontmatter, body } = this.extractFrontmatter(text);

      // Fix missing name
      if (!frontmatter.name && !frontmatter.title) {
        const h1 = this.extractH1FromMarkdown(body);
        if (h1) {
          frontmatter.name = h1;
          this.fixesApplied.push(`Added missing 'name' from H1: '${h1}'`);
        } else if (fileName) {
          const nameFromFile = path.basename(fileName, '.md');
          frontmatter.name = nameFromFile;
          this.fixesApplied.push(`Added missing 'name' from filename: '${nameFromFile}'`);
        } else {
          frontmatter.name = 'Untitled';
          this.fixesApplied.push("Added missing 'name' with default: 'Untitled'");
        }
      }

      // Fix missing or invalid ID
      if (!frontmatter.id || typeof frontmatter.id !== 'string') {
        frontmatter.id = this.generateNewUuid();
        this.fixesApplied.push(`Added missing 'id': '${frontmatter.id}'`);
      } else if (!this.isValidUuid(frontmatter.id)) {
        const oldId = frontmatter.id;
        frontmatter.id = this.generateNewUuid();
        this.fixesApplied.push(`Fixed invalid UUID format: '${oldId}' → '${frontmatter.id}'`);
      }

      // Ensure type field exists
      if (!frontmatter.type || typeof frontmatter.type !== 'string') {
        frontmatter.type = 'document';
        this.fixesApplied.push("Added missing 'type' field: 'document'");
      }

      // Update word count
      const wordCount = this.countWords(body);
      const oldWordCount = frontmatter.word_count;
      if (oldWordCount !== wordCount) {
        frontmatter.word_count = wordCount;
        if (oldWordCount === undefined) {
          this.fixesApplied.push(`Added 'word_count': ${wordCount}`);
        } else {
          this.fixesApplied.push(`Updated 'word_count': ${oldWordCount} → ${wordCount}`);
        }
      }

      // Serialize back to markdown
      const fixedText = this.serializeMarkdown(frontmatter, body);

      return {
        fixedText,
        fixesApplied: this.fixesApplied,
        success: true,
      };
    } catch (error) {
      return {
        fixedText: text,
        fixesApplied: this.fixesApplied,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Extract YAML frontmatter from markdown text
   */
  private extractFrontmatter(text: string): MarkdownParts {
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
   * Extract first H1 heading from markdown text
   */
  private extractH1FromMarkdown(text: string): string | null {
    const match = text.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /**
   * Count words in text (split on whitespace)
   */
  private countWords(text: string): number {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    return text.split(/\s+/).filter(w => w.length > 0).length;
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
   * Collect all valid UUIDs to avoid duplicates
   */
  private collectValidIds(data: unknown, path: string = ''): void {
    if (typeof data !== 'object' || data === null) return;

    if (Array.isArray(data)) {
      data.forEach((item, i) => this.collectValidIds(item, `${path}[${i}]`));
    } else {
      const obj = data as Record<string, unknown>;
      if ('id' in obj && typeof obj.id === 'string' && this.isValidUuid(obj.id)) {
        this.usedIds.add(obj.id);
      }
      for (const [key, value] of Object.entries(obj)) {
        this.collectValidIds(value, path ? `${path}.${key}` : key);
      }
    }
  }

  /**
   * Ensure V1.0/V1.1 metadata exists and is properly formatted
   */
  private ensureV1Metadata(content: Record<string, unknown>): Record<string, unknown> {
    // Ensure metadata object exists
    if (!content.metadata) {
      content.metadata = {};
      this.fixesApplied.push("Added missing 'metadata' section");
    }

    if (typeof content.metadata !== 'object' || content.metadata === null) {
      content.metadata = {};
      this.fixesApplied.push('Fixed invalid metadata structure');
    }

    const metadata = content.metadata as Record<string, unknown>;

    // Ensure formatVersion is valid (1.0, 1.1, 1.2, or lite)
    if (!metadata.formatVersion) {
      metadata.formatVersion = '1.2';
      this.fixesApplied.push("Added metadata.formatVersion = '1.2'");
    } else if (!['1.0', '1.1', '1.2', 'lite'].includes(metadata.formatVersion as string)) {
      const oldVersion = metadata.formatVersion;
      metadata.formatVersion = '1.2';  // Default to latest, not 1.1
      this.fixesApplied.push(`Updated metadata.formatVersion from '${oldVersion}' to '1.2'`);
    }
    // Note: V1.2 is now accepted without modification

    // Ensure documentVersion exists
    if (!metadata.documentVersion) {
      metadata.documentVersion = '1.0.0';
      this.fixesApplied.push("Added metadata.documentVersion = '1.0.0'");
    }

    return content;
  }

  /**
   * Remove legacy fields that don't belong in V1.0+ format
   */
  private removeLegacyFields(content: Record<string, unknown>): Record<string, unknown> {
    const legacyFieldsRemoved: string[] = [];

    // Remove packetType (V0.9 field)
    if ('packetType' in content) {
      delete content.packetType;
      legacyFieldsRemoved.push('packetType');
    }

    // Remove version (V0.9 field)
    if ('version' in content && 'metadata' in content) {
      delete content.version;
      legacyFieldsRemoved.push('version');
    }

    // Handle codexId migration
    if ('codexId' in content) {
      if (!content.id && content.codexId) {
        content.id = content.codexId;
        legacyFieldsRemoved.push('codexId (migrated to id)');
      } else {
        legacyFieldsRemoved.push('codexId');
      }
      delete content.codexId;
    }

    // Handle codexVersion migration
    if ('codexVersion' in content) {
      const metadata = content.metadata as Record<string, unknown>;
      if (metadata && !metadata.documentVersion) {
        metadata.documentVersion = content.codexVersion;
        legacyFieldsRemoved.push('codexVersion (migrated to metadata.documentVersion)');
      } else {
        legacyFieldsRemoved.push('codexVersion');
      }
      delete content.codexVersion;
    }

    // Warn about data wrapper
    if ('data' in content) {
      legacyFieldsRemoved.push('data (WARNING: should have been migrated first!)');
    }

    if (legacyFieldsRemoved.length > 0) {
      this.fixesApplied.push(`Removed legacy fields: ${legacyFieldsRemoved.join(', ')}`);
    }

    return content;
  }

  /**
   * Fix missing required node fields
   */
  private fixMissingEntityFields(data: unknown, path: string): any {
    if (typeof data !== 'object' || data === null) return data;

    if (Array.isArray(data)) {
      return data.map((item, i) => this.fixMissingEntityFields(item, `${path}[${i}]`));
    }

    const obj = data as Record<string, unknown>;

    // Check if this looks like a node
    const entityFields = ['id', 'type', 'name', 'title', 'attributes', 'children'];
    if (entityFields.some(field => field in obj)) {
      // Fix missing id
      if (!('id' in obj)) {
        obj.id = this.generateNewUuid();
        this.fixesApplied.push(`Added missing 'id' field at ${path || 'root'}`);
      }

      // Fix missing type (optional, but good practice)
      if (!('type' in obj) && path) {
        obj.type = 'node';
        this.fixesApplied.push(`Added missing 'type' field at ${path}`);
      }

      // Fix missing name/title
      if (!('name' in obj) && !('title' in obj) && path) {
        obj.name = 'Untitled';
        this.fixesApplied.push(`Added missing 'name' field at ${path}`);
      }
    }

    // Recursively process nested structures
    for (const [key, value] of Object.entries(obj)) {
      obj[key] = this.fixMissingEntityFields(value, path ? `${path}.${key}` : key);
    }

    return obj;
  }

  /**
   * Fix invalid UUID formats
   */
  private fixInvalidUuids(data: unknown, path: string): any {
    if (typeof data !== 'object' || data === null) return data;

    if (Array.isArray(data)) {
      return data.map((item, i) => this.fixInvalidUuids(item, `${path}[${i}]`));
    }

    const obj = data as Record<string, unknown>;

    // Fix node IDs
    if ('id' in obj && typeof obj.id === 'string') {
      if (!this.isValidUuid(obj.id)) {
        const oldId = obj.id;
        obj.id = this.fixUuidFormat(obj.id);
        this.fixesApplied.push(`Fixed invalid UUID at ${path}.id: '${oldId}' → '${obj.id}'`);
      }
    }

    // Fix relation targetIds
    if ('relations' in obj && Array.isArray(obj.relations)) {
      obj.relations = obj.relations.map((rel: unknown, i: number) => {
        if (typeof rel === 'object' && rel !== null) {
          const relation = rel as Record<string, unknown>;
          if ('targetId' in relation && typeof relation.targetId === 'string') {
            if (!this.isValidUuid(relation.targetId)) {
              const oldTargetId = relation.targetId;
              relation.targetId = this.fixUuidFormat(relation.targetId);
              this.fixesApplied.push(
                `Fixed invalid targetId at ${path}.relations[${i}].targetId: '${oldTargetId}' → '${relation.targetId}'`
              );
            }
          }
        }
        return rel;
      });
    }

    // Recursively process nested structures
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'relations') {
        obj[key] = this.fixInvalidUuids(value, path ? `${path}.${key}` : key);
      }
    }

    return obj;
  }

  /**
   * Fix common UUID format issues
   */
  private fixUuidFormat(invalidUuid: string): string {
    // Remove common suffixes like "-1", "-2", etc.
    const cleanedUuid = invalidUuid.replace(/-\d+$/, '');

    if (this.isValidUuid(cleanedUuid) && !this.usedIds.has(cleanedUuid)) {
      this.usedIds.add(cleanedUuid);
      return cleanedUuid;
    }

    return this.generateNewUuid();
  }

  /**
   * Fix duplicate node IDs
   */
  private fixDuplicateIds(content: Record<string, unknown>): Record<string, unknown> {
    const seenIds = new Set<string>();

    const fixDuplicates = (data: unknown, path: string): unknown => {
      if (typeof data !== 'object' || data === null) return data;

      if (Array.isArray(data)) {
        return data.map((item, i) => fixDuplicates(item, `${path}[${i}]`));
      }

      const obj = data as Record<string, unknown>;

      if ('id' in obj && typeof obj.id === 'string') {
        if (seenIds.has(obj.id)) {
          const oldId = obj.id;
          obj.id = this.generateNewUuid();
          this.fixesApplied.push(`Fixed duplicate ID at ${path}.id: '${oldId}' → '${obj.id}'`);
        } else {
          seenIds.add(obj.id);
        }
      }

      for (const [key, value] of Object.entries(obj)) {
        obj[key] = fixDuplicates(value, path ? `${path}.${key}` : key);
      }

      return obj;
    };

    return fixDuplicates(content, '') as Record<string, unknown>;
  }

  /**
   * Regenerate ALL IDs in the document
   */
  private regenerateAllIdsInDocument(data: unknown, path: string): any {
    if (typeof data !== 'object' || data === null) return data;

    if (Array.isArray(data)) {
      return data.map((item, i) => this.regenerateAllIdsInDocument(item, `${path}[${i}]`));
    }

    const obj = data as Record<string, unknown>;

    // Regenerate node ID
    if ('id' in obj) {
      const oldId = obj.id;
      obj.id = this.generateNewUuid();
      this.fixesApplied.push(`Regenerated ID at ${path || 'root'}.id: '${oldId}' → '${obj.id}'`);
    }

    // Regenerate relation targetIds
    if ('relations' in obj && Array.isArray(obj.relations)) {
      obj.relations = obj.relations.map((rel: unknown, i: number) => {
        if (typeof rel === 'object' && rel !== null) {
          const relation = rel as Record<string, unknown>;
          if ('targetId' in relation) {
            const oldTargetId = relation.targetId;
            relation.targetId = this.generateNewUuid();
            this.fixesApplied.push(
              `Regenerated targetId at ${path}.relations[${i}].targetId: '${oldTargetId}' → '${relation.targetId}'`
            );
          }
        }
        return rel;
      });
    }

    // Recursively process
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'relations') {
        obj[key] = this.regenerateAllIdsInDocument(value, path ? `${path}.${key}` : key);
      }
    }

    return obj;
  }

  /**
   * Fix invalid attribute structures
   */
  private fixInvalidAttributeStructure(data: unknown, path: string): any {
    if (typeof data !== 'object' || data === null) return data;

    if (Array.isArray(data)) {
      return data.map((item, i) => this.fixInvalidAttributeStructure(item, `${path}[${i}]`));
    }

    const obj = data as Record<string, unknown>;

    if ('attributes' in obj && Array.isArray(obj.attributes)) {
      const fixedAttributes: unknown[] = [];

      obj.attributes.forEach((attr: unknown, i: number) => {
        if (typeof attr === 'object' && attr !== null) {
          const attribute = attr as Record<string, unknown>;

          // Fix missing key
          if (!('key' in attribute)) {
            attribute.key = `attribute_${i}`;
            this.fixesApplied.push(`Added missing 'key' field to attribute at ${path}.attributes[${i}]`);
          }

          // Fix missing value
          if (!('value' in attribute)) {
            attribute.value = '';
            this.fixesApplied.push(`Added missing 'value' field to attribute at ${path}.attributes[${i}]`);
          }

          // Fix invalid key format
          if (typeof attribute.key === 'string' && !/^[a-z][a-z0-9_-]*$/i.test(attribute.key)) {
            const oldKey = attribute.key;
            attribute.key = this.sanitizeAttributeKey(attribute.key);
            this.fixesApplied.push(
              `Fixed invalid attribute key at ${path}.attributes[${i}]: '${oldKey}' → '${attribute.key}'`
            );
          }

          fixedAttributes.push(attribute);
        } else {
          this.fixesApplied.push(`Removed invalid attribute structure at ${path}.attributes[${i}]`);
        }
      });

      obj.attributes = fixedAttributes;
    }

    // Recursively process
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'attributes') {
        obj[key] = this.fixInvalidAttributeStructure(value, path ? `${path}.${key}` : key);
      }
    }

    return obj;
  }

  /**
   * Fix invalid relation structures
   */
  private fixInvalidRelationStructure(data: unknown, path: string): any {
    if (typeof data !== 'object' || data === null) return data;

    if (Array.isArray(data)) {
      return data.map((item, i) => this.fixInvalidRelationStructure(item, `${path}[${i}]`));
    }

    const obj = data as Record<string, unknown>;

    if ('relations' in obj && Array.isArray(obj.relations)) {
      const fixedRelations: unknown[] = [];

      obj.relations.forEach((rel: unknown, i: number) => {
        if (typeof rel === 'object' && rel !== null) {
          const relation = rel as Record<string, unknown>;

          // Fix missing targetId
          if (!('targetId' in relation)) {
            relation.targetId = this.generateNewUuid();
            this.fixesApplied.push(`Added missing 'targetId' field to relation at ${path}.relations[${i}]`);
          }

          // Fix missing type
          if (!('type' in relation) && !('kind' in relation)) {
            relation.type = 'related-to';
            this.fixesApplied.push(`Added missing 'type' field to relation at ${path}.relations[${i}]`);
          }

          fixedRelations.push(relation);
        } else {
          this.fixesApplied.push(`Removed invalid relation structure at ${path}.relations[${i}]`);
        }
      });

      obj.relations = fixedRelations;
    }

    // Recursively process
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'relations') {
        obj[key] = this.fixInvalidRelationStructure(value, path ? `${path}.${key}` : key);
      }
    }

    return obj;
  }

  /**
   * Fix empty or whitespace-only names
   */
  private cleanEmptyNames(data: unknown, path: string): any {
    if (typeof data !== 'object' || data === null) return data;

    if (Array.isArray(data)) {
      return data.map((item, i) => this.cleanEmptyNames(item, `${path}[${i}]`));
    }

    const obj = data as Record<string, unknown>;

    if ('name' in obj) {
      const name = obj.name;
      if (!name || (typeof name === 'string' && !name.trim())) {
        obj.name = 'Untitled';
        this.fixesApplied.push(`Fixed empty name at ${path || 'root'}.name`);
      }
    }

    // Recursively process
    for (const [key, value] of Object.entries(obj)) {
      obj[key] = this.cleanEmptyNames(value, path ? `${path}.${key}` : key);
    }

    return obj;
  }

  /**
   * Auto-calculate timecodes based on cumulative duration
   */
  private autoCalculateTimecodes(content: Record<string, unknown>): Record<string, unknown> {
    const depthCumulatives: Map<number, number> = new Map();

    const traverse = (node: unknown, depth: number): number => {
      if (typeof node !== 'object' || node === null) return 0;

      const obj = node as Record<string, unknown>;

      // Initialize cumulative for this depth
      if (!depthCumulatives.has(depth)) {
        depthCumulatives.set(depth, 0);
      }

      let currentDuration = 0;

      // Check attributes for duration and timecode
      if ('attributes' in obj && Array.isArray(obj.attributes)) {
        let hasTimecode = false;
        let timecodeIndex = -1;

        obj.attributes.forEach((attr: unknown, i: number) => {
          if (typeof attr === 'object' && attr !== null) {
            const attribute = attr as Record<string, unknown>;
            if (attribute.key === 'duration' && typeof attribute.value === 'string') {
              currentDuration = this.parseDurationToSeconds(attribute.value);
            }
            if (attribute.key === 'timecode') {
              hasTimecode = true;
              timecodeIndex = i;
            }
          }
        });

        // Set timecode based on cumulative at this depth
        if (hasTimecode && timecodeIndex >= 0) {
          const cumulative = depthCumulatives.get(depth) || 0;
          const timecodeStr = this.formatSecondsToDuration(cumulative);
          const attribute = obj.attributes[timecodeIndex] as Record<string, unknown>;
          const oldValue = attribute.value;

          if (String(oldValue) !== timecodeStr) {
            attribute.value = timecodeStr;
            this.fixesApplied.push(`Auto-calculated timecode at depth ${depth}: ${timecodeStr}`);
          }

          // Add this node's duration to cumulative
          depthCumulatives.set(depth, cumulative + currentDuration);
        }
      }

      // Process children
      if ('children' in obj && Array.isArray(obj.children)) {
        obj.children.forEach((child: unknown) => traverse(child, depth + 1));
      }

      return currentDuration;
    };

    traverse(content, 0);
    return content;
  }

  /**
   * Parse duration string to seconds
   */
  private parseDurationToSeconds(durationStr: string): number {
    try {
      const parts = durationStr.trim().split(':');

      if (parts.length === 3) {
        // HH:MM:SS
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
      } else if (parts.length === 2) {
        // MM:SS
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
      } else if (parts.length === 1) {
        // SS
        return parseInt(parts[0]);
      }
    } catch {
      // Ignore parse errors
    }
    return 0;
  }

  /**
   * Format seconds to duration string
   */
  private formatSecondsToDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Generate a new unique UUID
   */
  private generateNewUuid(): string {
    let newUuid: string;
    do {
      newUuid = generateUuid();
    } while (this.usedIds.has(newUuid));
    this.usedIds.add(newUuid);
    return newUuid;
  }

  /**
   * Check if string is a valid UUID v4
   */
  private isValidUuid(uuidStr: string): boolean {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidPattern.test(uuidStr);
  }

  /**
   * Sanitize attribute key to follow naming convention
   */
  private sanitizeAttributeKey(key: string): string {
    let sanitized = key.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    // Ensure starts with letter
    if (!sanitized || !/^[a-z]/.test(sanitized)) {
      sanitized = 'attr_' + sanitized;
    }

    // Remove consecutive underscores/hyphens
    sanitized = sanitized.replace(/[_-]+/g, '_');

    // Trim to reasonable length
    if (sanitized.length > 50) {
      sanitized = sanitized.substring(0, 50).replace(/[_-]+$/, '');
    }

    return sanitized || 'attribute';
  }

  /**
   * Pre-process YAML text to fix common syntax issues before parsing
   * This prevents parsing errors from malformed quoted strings
   */
  private preprocessYamlSyntax(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let i = 0;
    let changesCount = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Check if this line starts a quoted value (single or double quote)
      const quotedValueMatch = line.match(/^(\s+)(\w+):\s*(['"])(.*)$/);

      if (quotedValueMatch) {
        const [, indent, key, quote, firstLineContent] = quotedValueMatch;

        // Check if the quote closes on the same line
        const quoteCloses = this.findClosingQuote(firstLineContent, quote);

        if (quoteCloses === -1) {
          // Multi-line quoted string - collect all lines until closing quote
          const quotedLines = [firstLineContent];
          let j = i + 1;
          let foundClosing = false;

          while (j < lines.length && !foundClosing) {
            const nextLine = lines[j];
            quotedLines.push(nextLine);

            const closingPos = this.findClosingQuote(nextLine, quote);
            if (closingPos !== -1) {
              foundClosing = true;
            }
            j++;
          }

          // Join the content and check for problematic patterns
          const fullContent = quotedLines.join('\n');

          // Check if content has bold markdown with colons (problematic pattern)
          if (fullContent.includes('**') && /\*\*[^*]+\*\*:\s/g.test(fullContent)) {
            // Extract just the text content (remove quotes)
            let extractedContent = fullContent;

            // Remove opening quote
            if (extractedContent.startsWith(quote)) {
              extractedContent = extractedContent.slice(1);
            }

            // Find and remove closing quote
            const lastQuotePos = extractedContent.lastIndexOf(quote);
            if (lastQuotePos !== -1) {
              extractedContent = extractedContent.slice(0, lastQuotePos);
            }

            // Clean up the content
            extractedContent = extractedContent
              .replace(/\n\s+/g, '\n')  // Normalize indentation
              .replace(/''/g, "'")       // Fix escaped single quotes
              .trim();

            // Convert to block scalar
            const contentLines = extractedContent.split('\n');
            result.push(`${indent}${key}: |`);
            contentLines.forEach(contentLine => {
              result.push(`${indent}  ${contentLine}`);
            });

            changesCount++;
            i = j; // Skip past all the lines we just processed
            continue;
          }
        }
      }

      // If we didn't convert this line, just add it as-is
      result.push(line);
      i++;
    }

    if (changesCount > 0) {
      this.fixesApplied.push(`Pre-processed ${changesCount} quoted string(s) with potential syntax issues`);
    }

    return result.join('\n');
  }

  /**
   * Find the position of a closing quote, accounting for escaped quotes
   */
  private findClosingQuote(text: string, quote: string): number {
    let i = 0;
    while (i < text.length) {
      if (text[i] === quote) {
        // Check if it's escaped (preceded by another quote in YAML)
        if (i + 1 < text.length && text[i + 1] === quote) {
          i += 2; // Skip the escaped quote
          continue;
        }
        return i; // Found unescaped closing quote
      }
      i++;
    }
    return -1; // No closing quote found
  }

  /**
   * Serialize object to YAML with proper block scalar formatting
   * Matches Python auto_fixer.py behavior:
   * - Plain style for simple strings (no quotes)
   * - Block literal (|) for multiline or long strings (>80 chars)
   * - Only quotes when necessary (special characters, etc.)
   */
  private serializeToYaml(content: Record<string, unknown>): string {
    const doc = new YAML.Document(content);

    // Walk through and set block scalar style ONLY for long/multiline strings
    const setBlockStyle = (node: unknown): void => {
      if (YAML.isMap(node)) {
        for (const pair of node.items) {
          if (YAML.isScalar(pair.value) && typeof pair.value.value === 'string') {
            const str = pair.value.value;

            // Check if string looks like time format (HH:MM:SS, MM:SS, HH:MM)
            // Pattern: 1-2 digits, colon, 2 digits, optionally more colons and digits
            // These MUST be quoted to prevent YAML sexagesimal parsing (e.g., 36:00 → 2160)
            const timePattern = /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/;
            if (timePattern.test(str)) {
              // Force double quotes for time patterns to prevent sexagesimal parsing
              pair.value.type = YAML.Scalar.QUOTE_DOUBLE;
            } else if (str.includes('\n') || str.length > 60) {
              // Use block literal (|) for multiline or long strings
              pair.value.type = YAML.Scalar.BLOCK_LITERAL;
            }
            // Otherwise, leave as default (plain style when valid, quoted only when necessary)
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

    // Use default string type (plain when valid, quoted only when necessary)
    // This matches Python's yaml.dump() default behavior
    return doc.toString({ lineWidth: 120 });
  }
}

/**
 * Output channel for auto-fixer logs
 */
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('ChapterWise Auto-Fixer');
  }
  return outputChannel;
}

/**
 * Run auto-fixer on the current document
 */
export async function runAutoFixer(regenerateAllIds: boolean = false): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage('No active editor. Open a Codex file first.');
    return;
  }

  const fileName = editor.document.fileName;

  if (!isCodexLikeFile(fileName)) {
    vscode.window.showErrorMessage('Current file is not a Codex file (.codex.yaml, .codex.json, .codex, or .md)');
    return;
  }

  // Check if it's a markdown file
  const isMarkdown = isMarkdownFile(fileName);

  // Confirm if regenerating all IDs (only for full Codex files)
  if (regenerateAllIds && !isMarkdown) {
    const confirm = await vscode.window.showWarningMessage(
      'This will regenerate ALL IDs in the document, even valid ones. This may break external references. Continue?',
      { modal: true },
      'Yes, Regenerate All IDs'
    );
    if (!confirm) {
      return;
    }
  }

  // Run with progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: isMarkdown
        ? 'Auto-Fixing Codex Lite (Markdown)...'
        : regenerateAllIds
          ? 'Auto-Fixing (Regenerating IDs)...'
          : 'Auto-Fixing Codex...',
      cancellable: false,
    },
    async () => {
      const document = editor.document;
      const text = document.getText();

      const fixer = new CodexAutoFixer();
      const result = isMarkdown
        ? fixer.autoFixCodexLite(text, fileName)
        : fixer.autoFixCodex(text, regenerateAllIds);

      if (!result.success) {
        vscode.window.showErrorMessage(`Auto-fix failed: ${result.error}`);
        return;
      }

      if (result.fixesApplied.length === 0) {
        vscode.window.setStatusBarMessage('✅ No fixes needed - document is already valid!', 3000);
        return;
      }

      // Apply the changes
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );
      edit.replace(document.uri, fullRange, result.fixedText);

      const success = await vscode.workspace.applyEdit(edit);

      if (success) {
        // Log to output channel
        const channel = getOutputChannel();
        channel.appendLine(`\n${'='.repeat(60)}`);
        channel.appendLine(`Auto-Fix Results - ${new Date().toLocaleString()}`);
        channel.appendLine(`File: ${document.fileName}`);
        channel.appendLine(`Format: ${isMarkdown ? 'Codex Lite (Markdown)' : 'Full Codex'}`);
        if (!isMarkdown) {
          channel.appendLine(`Regenerate All IDs: ${regenerateAllIds}`);
        }
        channel.appendLine(`${'='.repeat(60)}`);
        result.fixesApplied.forEach((fix, i) => {
          channel.appendLine(`${i + 1}. ${fix}`);
        });
        channel.appendLine(`${'='.repeat(60)}\n`);

        // Show success message with option to view details
        const viewDetails = await vscode.window.showInformationMessage(
          `✅ Applied ${result.fixesApplied.length} fix${result.fixesApplied.length === 1 ? '' : 'es'}`,
          'Show Details',
          'Save File'
        );

        if (viewDetails === 'Show Details') {
          channel.show();
        } else if (viewDetails === 'Save File') {
          await document.save();
        }
      } else {
        vscode.window.showErrorMessage('Failed to apply auto-fix changes');
      }
    }
  );
}

/**
 * Dispose of resources
 */
export function disposeAutoFixer(): void {
  outputChannel?.dispose();
}



