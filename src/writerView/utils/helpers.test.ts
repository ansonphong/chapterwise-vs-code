import { describe, it, expect } from 'vitest';
import { escapeHtml, isPathWithinWorkspace, getNonce } from './helpers';

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes as &#039;', () => {
    expect(escapeHtml("it's")).toBe('it&#039;s');
  });

  it('escapes all special characters together', () => {
    expect(escapeHtml(`<div class="x" data-val='a&b'>`)).toBe(
      '&lt;div class=&quot;x&quot; data-val=&#039;a&amp;b&#039;&gt;'
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles multiple consecutive special chars', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
  });
});

describe('isPathWithinWorkspace', () => {
  const root = '/workspace/project';

  it('accepts a simple relative path', () => {
    expect(isPathWithinWorkspace('chapter1.md', root)).toBe(true);
  });

  it('accepts a nested relative path', () => {
    expect(isPathWithinWorkspace('src/deep/file.ts', root)).toBe(true);
  });

  it('rejects path traversal with ../', () => {
    expect(isPathWithinWorkspace('../outside.md', root)).toBe(false);
  });

  it('rejects deeply nested path traversal', () => {
    expect(isPathWithinWorkspace('a/b/../../../../../../etc/passwd', root)).toBe(false);
  });

  it('rejects path traversal hidden in the middle', () => {
    expect(isPathWithinWorkspace('subdir/../../outside', root)).toBe(false);
  });

  it('accepts path that stays within workspace after ..', () => {
    expect(isPathWithinWorkspace('a/b/../c/file.md', root)).toBe(true);
  });

  it('returns false when workspaceRoot is empty string', () => {
    expect(isPathWithinWorkspace('file.md', '')).toBe(false);
  });

  it('accepts absolute path within workspace', () => {
    expect(isPathWithinWorkspace('/workspace/project/file.md', root)).toBe(true);
  });

  it('treats absolute-looking paths as relative after leading slash strip', () => {
    // The function strips leading '/' so '/etc/passwd' becomes 'etc/passwd'
    // which resolves to /workspace/project/etc/passwd (inside workspace)
    expect(isPathWithinWorkspace('/etc/passwd', root)).toBe(true);
  });

  it('handles leading slash stripping for relative paths', () => {
    // The function strips leading slash before resolve, so /subdir becomes subdir
    expect(isPathWithinWorkspace('/subdir/file.md', root)).toBe(true);
  });
});

describe('getNonce', () => {
  it('returns a string', () => {
    expect(typeof getNonce()).toBe('string');
  });

  it('returns a 32-character hex string (16 bytes)', () => {
    const nonce = getNonce();
    expect(nonce).toHaveLength(32);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns different values on subsequent calls', () => {
    const a = getNonce();
    const b = getNonce();
    expect(a).not.toBe(b);
  });
});
