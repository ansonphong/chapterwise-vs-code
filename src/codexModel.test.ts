import { describe, it, expect } from 'vitest';
import {
  isCodexFile,
  isMarkdownFile,
  isCodexLikeFile,
  parseCodex,
  parseMarkdownAsCodex,
  validateCodex,
  createMinimalCodex,
  generateUuid,
  setMarkdownNodeProse,
  setMarkdownFrontmatterField,
  PROSE_FIELDS,
} from './codexModel';

// ---------------------------------------------------------------------------
// isCodexFile
// ---------------------------------------------------------------------------
describe('isCodexFile', () => {
  it('returns true for .codex.yaml', () => {
    expect(isCodexFile('world.codex.yaml')).toBe(true);
  });

  it('returns true for .codex.json', () => {
    expect(isCodexFile('world.codex.json')).toBe(true);
  });

  it('returns true for .codex', () => {
    expect(isCodexFile('world.codex')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCodexFile('World.CODEX.YAML')).toBe(true);
    expect(isCodexFile('World.Codex.Json')).toBe(true);
  });

  it('returns false for .md', () => {
    expect(isCodexFile('readme.md')).toBe(false);
  });

  it('returns false for .yaml that is not .codex.yaml', () => {
    expect(isCodexFile('config.yaml')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCodexFile('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isMarkdownFile
// ---------------------------------------------------------------------------
describe('isMarkdownFile', () => {
  it('returns true for .md', () => {
    expect(isMarkdownFile('chapter1.md')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMarkdownFile('README.MD')).toBe(true);
  });

  it('returns false for .codex.yaml', () => {
    expect(isMarkdownFile('world.codex.yaml')).toBe(false);
  });

  it('returns false for .txt', () => {
    expect(isMarkdownFile('notes.txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCodexLikeFile
// ---------------------------------------------------------------------------
describe('isCodexLikeFile', () => {
  it('returns true for .codex.yaml', () => {
    expect(isCodexLikeFile('world.codex.yaml')).toBe(true);
  });

  it('returns true for .codex.json', () => {
    expect(isCodexLikeFile('world.codex.json')).toBe(true);
  });

  it('returns true for .md', () => {
    expect(isCodexLikeFile('chapter.md')).toBe(true);
  });

  it('returns false for .txt', () => {
    expect(isCodexLikeFile('notes.txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseCodex — YAML
// ---------------------------------------------------------------------------
describe('parseCodex', () => {
  const minimalYaml = `
metadata:
  formatVersion: "1.1"
id: "550e8400-e29b-41d4-a716-446655440000"
type: book
name: "My Book"
body: "Hello world"
children: []
`;

  it('parses a minimal YAML document', () => {
    const doc = parseCodex(minimalYaml);
    expect(doc).not.toBeNull();
    expect(doc!.isJson).toBe(false);
    expect(doc!.isMarkdown).toBe(false);
    expect(doc!.metadata.formatVersion).toBe('1.1');
    expect(doc!.rootNode).not.toBeNull();
    expect(doc!.rootNode!.name).toBe('My Book');
    expect(doc!.rootNode!.type).toBe('book');
    expect(doc!.rootNode!.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(doc!.rootNode!.proseValue).toBe('Hello world');
    expect(doc!.rootNode!.proseField).toBe('body');
  });

  it('populates allNodes with the root and its children', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "550e8400-e29b-41d4-a716-446655440000"
type: book
name: "My Book"
body: "Root body"
children:
  - id: "child-1"
    type: chapter
    name: "Chapter 1"
    body: "Ch1 body"
    children: []
  - id: "child-2"
    type: chapter
    name: "Chapter 2"
    body: "Ch2 body"
    children: []
`;
    const doc = parseCodex(yaml);
    expect(doc).not.toBeNull();
    expect(doc!.allNodes).toHaveLength(3);
    expect(doc!.rootNode!.children).toHaveLength(2);
    expect(doc!.rootNode!.children[0].name).toBe('Chapter 1');
    expect(doc!.rootNode!.children[1].name).toBe('Chapter 2');
  });

  it('collects unique types', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "550e8400-e29b-41d4-a716-446655440000"
type: book
name: "My Book"
children:
  - id: "ch1"
    type: chapter
    name: "Ch1"
    children: []
  - id: "ch2"
    type: chapter
    name: "Ch2"
    children: []
`;
    const doc = parseCodex(yaml);
    expect(doc).not.toBeNull();
    expect(doc!.types.has('book')).toBe(true);
    expect(doc!.types.has('chapter')).toBe(true);
    expect(doc!.types.size).toBe(2);
  });

  it('returns null for invalid YAML', () => {
    expect(parseCodex('{{{')).toBeNull();
  });

  it('returns null for legacy format with data wrapper', () => {
    const legacy = `
data:
  chapters: []
`;
    expect(parseCodex(legacy)).toBeNull();
  });

  it('keeps rawText on the returned document', () => {
    const doc = parseCodex(minimalYaml);
    expect(doc!.rawText).toBe(minimalYaml);
  });

  it('sets rawDoc for YAML', () => {
    const doc = parseCodex(minimalYaml);
    expect(doc!.rawDoc).not.toBeNull();
  });

  it('parses nodes with summary prose field', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: book
name: "Book"
summary: "A quick summary"
children: []
`;
    const doc = parseCodex(yaml);
    expect(doc).not.toBeNull();
    expect(doc!.rootNode!.proseField).toBe('summary');
    expect(doc!.rootNode!.proseValue).toBe('A quick summary');
    expect(doc!.rootNode!.availableFields).toContain('summary');
  });

  it('resolves prose fields in priority order (body first)', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: book
name: "Book"
body: "The body text"
summary: "The summary"
children: []
`;
    const doc = parseCodex(yaml);
    expect(doc!.rootNode!.proseField).toBe('body');
    expect(doc!.rootNode!.proseValue).toBe('The body text');
    expect(doc!.rootNode!.availableFields).toContain('body');
    expect(doc!.rootNode!.availableFields).toContain('summary');
  });

  it('parses attributes on a node', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: character
name: "Alice"
body: ""
attributes:
  - key: age
    value: 30
  - key: color
    value: "#FF0000"
children: []
`;
    const doc = parseCodex(yaml);
    expect(doc!.rootNode!.hasAttributes).toBe(true);
    expect(doc!.rootNode!.attributes).toHaveLength(2);
    expect(doc!.rootNode!.attributes![0].key).toBe('age');
    expect(doc!.rootNode!.attributes![0].value).toBe(30);
    expect(doc!.rootNode!.attributes![1].key).toBe('color');
  });

  it('parses tags on a node', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: chapter
name: "Ch"
tags:
  - draft
  - important
children: []
`;
    const doc = parseCodex(yaml);
    expect(doc!.rootNode!.tags).toEqual(['draft', 'important']);
  });

  it('parses relations on a node', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: character
name: "Alice"
relations:
  - targetId: "def"
    type: ally
children: []
`;
    const doc = parseCodex(yaml);
    expect(doc!.rootNode!.relations).toHaveLength(1);
    expect(doc!.rootNode!.relations![0].targetId).toBe('def');
    expect(doc!.rootNode!.relations![0].type).toBe('ally');
  });

  it('parses images on a node', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: chapter
name: "Ch"
images:
  - url: "portrait.png"
    caption: "A portrait"
children: []
`;
    const doc = parseCodex(yaml);
    expect(doc!.rootNode!.hasImages).toBe(true);
    expect(doc!.rootNode!.images).toHaveLength(1);
    expect(doc!.rootNode!.images![0].url).toBe('portrait.png');
    expect(doc!.rootNode!.images![0].caption).toBe('A portrait');
  });

  it('parses content sections on a node', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: chapter
name: "Ch"
content:
  - key: notes
    name: "Notes"
    value: "Some notes"
children: []
`;
    const doc = parseCodex(yaml);
    expect(doc!.rootNode!.hasContentSections).toBe(true);
    expect(doc!.rootNode!.contentSections).toHaveLength(1);
    expect(doc!.rootNode!.contentSections![0].key).toBe('notes');
    expect(doc!.rootNode!.contentSections![0].value).toBe('Some notes');
  });

  it('detects include directives', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: book
name: "Book"
children:
  - include: "chapters/ch1.codex.yaml"
`;
    const doc = parseCodex(yaml);
    expect(doc!.rootNode!.children).toHaveLength(1);
    const inc = doc!.rootNode!.children[0];
    expect(inc.isInclude).toBe(true);
    expect(inc.includePath).toBe('chapters/ch1.codex.yaml');
    expect(inc.type).toBe('include');
    expect(inc.name).toBe('ch1');
  });

  it('sets parent references on children', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "root-id"
type: book
name: "Book"
children:
  - id: "ch1"
    type: chapter
    name: "Ch1"
    children: []
`;
    const doc = parseCodex(yaml);
    const child = doc!.rootNode!.children[0];
    expect(child.parent).toBe(doc!.rootNode);
  });

  // JSON format
  it('parses a JSON codex document', () => {
    const json = JSON.stringify({
      metadata: { formatVersion: '1.1' },
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'book',
      name: 'JSON Book',
      body: 'Content here',
      children: [],
    });
    const doc = parseCodex(json);
    expect(doc).not.toBeNull();
    expect(doc!.isJson).toBe(true);
    expect(doc!.rootNode!.name).toBe('JSON Book');
    expect(doc!.rawDoc).toBeNull(); // No rawDoc for JSON
  });

  it('returns null for empty string', () => {
    expect(parseCodex('')).toBeNull();
  });

  it('returns null for null/undefined-like content parsed as YAML', () => {
    // YAML.parse of "null" returns null
    expect(parseCodex('null')).toBeNull();
  });

  it('falls back to title when name is missing', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "abc"
type: chapter
title: "My Title"
children: []
`;
    const doc = parseCodex(yaml);
    expect(doc!.rootNode!.name).toBe('My Title');
  });
});

// ---------------------------------------------------------------------------
// parseMarkdownAsCodex
// ---------------------------------------------------------------------------
describe('parseMarkdownAsCodex', () => {
  it('parses markdown with frontmatter', () => {
    const md = `---
title: "My Document"
author: "Jane"
tags:
  - draft
  - review
---

# My Document

This is the body.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc).not.toBeNull();
    expect(doc!.isMarkdown).toBe(true);
    expect(doc!.isJson).toBe(false);
    expect(doc!.metadata.formatVersion).toBe('lite');
    expect(doc!.metadata.author).toBe('Jane');
    expect(doc!.rootNode!.name).toBe('My Document');
    expect(doc!.rootNode!.type).toBe('document');
    expect(doc!.rootNode!.tags).toEqual(['draft', 'review']);
  });

  it('uses H1 heading for name when no frontmatter title/name', () => {
    const md = `---
author: "Bob"
---

# The Great Chapter

Body text.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.name).toBe('The Great Chapter');
  });

  it('uses fileName as fallback name', () => {
    const md = 'Just plain text.';
    const doc = parseMarkdownAsCodex(md, 'my-chapter.md');
    expect(doc!.rootNode!.name).toBe('my-chapter');
  });

  it('uses "Untitled" when no name source available', () => {
    const md = 'Just plain text with no heading.';
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.name).toBe('Untitled');
  });

  it('has body as the prose value', () => {
    const md = `---
title: "Test"
---

The body content here.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.proseValue).toBe('The body content here.');
  });

  it('includes summary in availableFields when present in frontmatter', () => {
    const md = `---
title: "Test"
summary: "A short summary"
---

Body text.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.availableFields).toContain('body');
    expect(doc!.rootNode!.availableFields).toContain('summary');
    // When summary is available, proseField should be 'summary'
    expect(doc!.rootNode!.proseField).toBe('summary');
  });

  it('body is the default proseField when no summary', () => {
    const md = `---
title: "Test"
---

Body text.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.proseField).toBe('body');
  });

  it('parses tags from comma-delimited string', () => {
    const md = `---
title: "Test"
tags: "draft, review, final"
---

Body.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.tags).toEqual(['draft', 'review', 'final']);
  });

  it('stores original frontmatter on the document', () => {
    const md = `---
title: "Test"
custom_field: 42
---

Body.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.frontmatter).toBeDefined();
    expect(doc!.frontmatter!.title).toBe('Test');
    expect(doc!.frontmatter!.custom_field).toBe(42);
  });

  it('handles markdown without frontmatter', () => {
    const md = `# My Heading

Some text here.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc).not.toBeNull();
    expect(doc!.rootNode!.name).toBe('My Heading');
    expect(doc!.frontmatter).toBeUndefined();
  });

  it('rawDoc is null for markdown', () => {
    const md = `---
title: "Test"
---

Body.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rawDoc).toBeNull();
  });

  it('allNodes contains exactly one root node', () => {
    const md = `---
title: "Test"
---

Body.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.allNodes).toHaveLength(1);
    expect(doc!.allNodes[0]).toBe(doc!.rootNode);
  });

  it('respects frontmatter type override', () => {
    const md = `---
title: "Character Sheet"
type: character
---

Bio.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.type).toBe('character');
    expect(doc!.types.has('character')).toBe(true);
  });

  it('uses frontmatter id when provided', () => {
    const md = `---
title: "Test"
id: "my-custom-id"
---

Body.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.id).toBe('my-custom-id');
  });

  it('generates a UUID when id is not in frontmatter', () => {
    const md = `---
title: "Test"
---

Body.`;
    const doc = parseMarkdownAsCodex(md);
    // Should have some id (auto-generated UUID)
    expect(doc!.rootNode!.id).toBeTruthy();
    expect(doc!.rootNode!.id.length).toBeGreaterThan(0);
  });

  it('parses metadata fields from frontmatter', () => {
    const md = `---
title: "Test"
author: "Alice"
created: "2025-01-01"
updated: "2025-06-15"
license: "CC-BY-4.0"
---

Body.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.metadata.author).toBe('Alice');
    expect(doc!.metadata.created).toBe('2025-01-01');
    expect(doc!.metadata.updated).toBe('2025-06-15');
    expect(doc!.metadata.license).toBe('CC-BY-4.0');
  });

  it('extracts image from frontmatter', () => {
    const md = `---
title: "Test"
image: "cover.png"
---

Body.`;
    const doc = parseMarkdownAsCodex(md);
    expect(doc!.rootNode!.image).toBe('cover.png');
  });
});

// ---------------------------------------------------------------------------
// validateCodex
// ---------------------------------------------------------------------------
describe('validateCodex', () => {
  it('returns no issues for a valid document', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "550e8400-e29b-41d4-a716-446655440000"
type: book
name: "My Book"
body: "Content"
children:
  - id: "660e8400-e29b-41d4-a716-446655440001"
    type: chapter
    name: "Ch1"
    body: "Chapter content"
    children: []
`;
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues).toHaveLength(0);
  });

  it('reports error when doc is null (invalid syntax)', () => {
    const text = '{{{invalid';
    const issues = validateCodex(null, text);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('error');
  });

  it('reports error for legacy data wrapper format', () => {
    const text = `data:\n  chapters: []`;
    const issues = validateCodex(null, text);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.message.includes('Legacy format'))).toBe(true);
  });

  it('reports error for missing metadata section', () => {
    const text = `type: book\nname: Test\n`;
    const issues = validateCodex(null, text);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.message.includes('metadata'))).toBe(true);
  });

  it('reports error for missing formatVersion', () => {
    const yaml = `
metadata: {}
id: "550e8400-e29b-41d4-a716-446655440000"
type: book
name: "Book"
children: []
`;
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues.some(i => i.message.includes('formatVersion'))).toBe(true);
  });

  it('warns about nodes with missing IDs', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "550e8400-e29b-41d4-a716-446655440000"
type: book
name: "Book"
children:
  - type: chapter
    name: "No ID Chapter"
    children: []
`;
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues.some(i => i.message.includes("missing an 'id'"))).toBe(true);
  });

  it('warns about duplicate IDs', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "550e8400-e29b-41d4-a716-446655440000"
type: book
name: "Book"
children:
  - id: "550e8400-e29b-41d4-a716-446655440000"
    type: chapter
    name: "Dup"
    children: []
`;
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues.some(i => i.message.includes('Duplicate ID'))).toBe(true);
  });

  it('warns about invalid UUID format', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
id: "not-a-valid-uuid"
type: book
name: "Book"
children: []
`;
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues.some(i => i.message.includes('invalid UUID'))).toBe(true);
  });

  it('info for empty codex document', () => {
    const yaml = `
metadata:
  formatVersion: "1.1"
children: []
`;
    const doc = parseCodex(yaml);
    const issues = validateCodex(doc, yaml);
    expect(issues.some(i => i.severity === 'info' && i.message.includes('empty'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createMinimalCodex
// ---------------------------------------------------------------------------
describe('createMinimalCodex', () => {
  it('creates valid YAML that parseCodex can parse', () => {
    const text = createMinimalCodex('book', 'My Novel');
    const doc = parseCodex(text);
    expect(doc).not.toBeNull();
    expect(doc!.metadata.formatVersion).toBe('1.1');
    expect(doc!.rootNode!.type).toBe('book');
    expect(doc!.rootNode!.name).toBe('My Novel');
  });

  it('includes a valid UUID v4', () => {
    const text = createMinimalCodex();
    const doc = parseCodex(text);
    expect(doc).not.toBeNull();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidPattern.test(doc!.rootNode!.id)).toBe(true);
  });

  it('uses default type "book" and name "Untitled"', () => {
    const text = createMinimalCodex();
    const doc = parseCodex(text);
    expect(doc!.rootNode!.type).toBe('book');
    expect(doc!.rootNode!.name).toBe('Untitled');
  });

  it('sets documentVersion to "1.0.0"', () => {
    const text = createMinimalCodex();
    const doc = parseCodex(text);
    expect(doc!.metadata.documentVersion).toBe('1.0.0');
  });

  it('includes a created timestamp', () => {
    const text = createMinimalCodex();
    const doc = parseCodex(text);
    expect(doc!.metadata.created).toBeTruthy();
  });

  it('includes a summary prose field', () => {
    const text = createMinimalCodex();
    const doc = parseCodex(text);
    expect(doc!.rootNode!.availableFields).toContain('summary');
  });

  it('has empty children array', () => {
    const text = createMinimalCodex();
    const doc = parseCodex(text);
    expect(doc!.rootNode!.children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateUuid
// ---------------------------------------------------------------------------
describe('generateUuid', () => {
  it('returns a valid UUID v4 string', () => {
    const uuid = generateUuid();
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(pattern.test(uuid)).toBe(true);
  });

  it('generates unique values on each call', () => {
    const a = generateUuid();
    const b = generateUuid();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// setMarkdownNodeProse
// ---------------------------------------------------------------------------
describe('setMarkdownNodeProse', () => {
  it('replaces the body while preserving frontmatter', () => {
    const original = `---
title: "My Doc"
---

Old body text.`;
    const result = setMarkdownNodeProse(original, 'New body text.');
    expect(result).toContain('title:');
    expect(result).toContain('My Doc');
    expect(result).toContain('New body text.');
    expect(result).not.toContain('Old body text.');
  });

  it('returns just the body when there is no frontmatter', () => {
    const original = 'Plain markdown without frontmatter.';
    const result = setMarkdownNodeProse(original, 'New body.');
    expect(result).toBe('New body.');
  });

  it('uses updatedFrontmatter when provided', () => {
    const original = `---
title: "Old Title"
---

Body.`;
    const result = setMarkdownNodeProse(original, 'New body.', { title: 'New Title', status: 'draft' });
    expect(result).toContain('title: New Title');
    expect(result).toContain('status: draft');
    expect(result).toContain('New body.');
  });

  it('rebuilds frontmatter delimiters correctly', () => {
    const original = `---
title: "Test"
---

Body.`;
    const result = setMarkdownNodeProse(original, 'Updated.');
    expect(result.startsWith('---\n')).toBe(true);
    expect(result).toContain('\n---\n');
  });
});

// ---------------------------------------------------------------------------
// setMarkdownFrontmatterField
// ---------------------------------------------------------------------------
describe('setMarkdownFrontmatterField', () => {
  it('adds a new field to existing frontmatter', () => {
    const original = `---
title: "Test"
---

Body.`;
    const result = setMarkdownFrontmatterField(original, 'status', 'published');
    expect(result).toContain('status: published');
    expect(result).toContain('title:');
    expect(result).toContain('Test');
    expect(result).toContain('Body.');
  });

  it('updates an existing field', () => {
    const original = `---
title: "Old"
status: draft
---

Body.`;
    const result = setMarkdownFrontmatterField(original, 'status', 'published');
    expect(result).toContain('status: published');
    expect(result).not.toContain('status: draft');
  });

  it('creates frontmatter when none exists', () => {
    const original = 'Just body text.';
    const result = setMarkdownFrontmatterField(original, 'title', 'New Title');
    expect(result).toContain('---');
    expect(result).toContain('title: New Title');
    expect(result).toContain('Just body text.');
  });

  it('preserves the body content', () => {
    const original = `---
title: "Test"
---

Important body content here.`;
    const result = setMarkdownFrontmatterField(original, 'author', 'Alice');
    expect(result).toContain('Important body content here.');
  });

  it('handles numeric values', () => {
    const original = `---
title: "Test"
---

Body.`;
    const result = setMarkdownFrontmatterField(original, 'wordCount', 5000);
    expect(result).toContain('wordCount: 5000');
  });

  it('handles boolean values', () => {
    const original = `---
title: "Test"
---

Body.`;
    const result = setMarkdownFrontmatterField(original, 'published', true);
    expect(result).toContain('published: true');
  });
});

// ---------------------------------------------------------------------------
// PROSE_FIELDS constant
// ---------------------------------------------------------------------------
describe('PROSE_FIELDS', () => {
  it('contains the expected fields in priority order', () => {
    expect(PROSE_FIELDS).toEqual(['body', 'summary', 'description', 'content', 'text']);
  });
});
