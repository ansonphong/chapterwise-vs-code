import { describe, it, expect } from 'vitest';
import { parseQuery, isEmptyQuery } from './queryParser';
import type { ParsedQuery } from './queryParser';

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------
describe('parseQuery', () => {
  it('parses basic search terms', () => {
    const q = parseQuery('aragorn sword');
    expect(q.terms).toEqual(['aragorn', 'sword']);
    expect(q.phrases).toEqual([]);
    expect(q.filters.types).toEqual([]);
  });

  it('lowercases all terms', () => {
    const q = parseQuery('Dragon KING');
    expect(q.terms).toEqual(['dragon', 'king']);
  });

  it('extracts quoted phrases', () => {
    const q = parseQuery('"king of gondor" quest');
    expect(q.phrases).toEqual(['king of gondor']);
    expect(q.terms).toEqual(['quest']);
  });

  it('extracts multiple quoted phrases', () => {
    const q = parseQuery('"dark lord" "white city"');
    expect(q.phrases).toEqual(['dark lord', 'white city']);
    expect(q.terms).toEqual([]);
  });

  it('parses type filters', () => {
    const q = parseQuery('type:character aragorn');
    expect(q.filters.types).toEqual(['character']);
    expect(q.terms).toEqual(['aragorn']);
  });

  it('parses excluded types', () => {
    const q = parseQuery('-type:location sword');
    expect(q.filters.exclude.types).toEqual(['location']);
    expect(q.terms).toEqual(['sword']);
  });

  it('parses excluded terms', () => {
    const q = parseQuery('dragon -evil');
    expect(q.filters.exclude.terms).toEqual(['evil']);
    expect(q.terms).toEqual(['dragon']);
  });

  it('parses field filters (body, summary, tags, etc.)', () => {
    const q = parseQuery('body:dragon summary:quest');
    expect(q.filters.fields).toEqual([
      { field: 'body', value: 'dragon' },
      { field: 'summary', value: 'quest' },
    ]);
    expect(q.terms).toEqual([]);
  });

  it('parses description field filter', () => {
    const q = parseQuery('description:ancient');
    expect(q.filters.fields).toEqual([
      { field: 'description', value: 'ancient' },
    ]);
  });

  it('parses attributes field filter', () => {
    const q = parseQuery('attributes:magic');
    expect(q.filters.fields).toEqual([
      { field: 'attributes', value: 'magic' },
    ]);
  });

  it('parses tags field filter', () => {
    const q = parseQuery('tags:fantasy');
    expect(q.filters.fields).toEqual([
      { field: 'tags', value: 'fantasy' },
    ]);
  });

  it('handles complex mixed query', () => {
    const q = parseQuery('"ring of power" type:artifact -type:location body:ancient -destroyed');
    expect(q.phrases).toEqual(['ring of power']);
    expect(q.filters.types).toEqual(['artifact']);
    expect(q.filters.exclude.types).toEqual(['location']);
    expect(q.filters.fields).toEqual([{ field: 'body', value: 'ancient' }]);
    expect(q.filters.exclude.terms).toEqual(['destroyed']);
    expect(q.terms).toEqual([]);
  });

  it('filters out single-character tokens', () => {
    const q = parseQuery('a b dragon');
    expect(q.terms).toEqual(['dragon']);
  });

  it('returns empty result for empty input', () => {
    const q = parseQuery('');
    expect(q.terms).toEqual([]);
    expect(q.phrases).toEqual([]);
    expect(q.filters.types).toEqual([]);
    expect(q.filters.fields).toEqual([]);
    expect(q.filters.exclude.types).toEqual([]);
    expect(q.filters.exclude.terms).toEqual([]);
  });

  it('returns empty result for null/undefined', () => {
    const q1 = parseQuery(null as unknown as string);
    expect(q1.terms).toEqual([]);
    const q2 = parseQuery(undefined as unknown as string);
    expect(q2.terms).toEqual([]);
  });

  it('ignores type: filter with empty value', () => {
    const q = parseQuery('type: dragon');
    expect(q.filters.types).toEqual([]);
    expect(q.terms).toEqual(['dragon']);
  });

  it('does not extract empty quoted phrase (regex requires content)', () => {
    const q = parseQuery('"" dragon');
    // The regex /"([^"]+)"/g won't match "" (needs 1+ chars inside quotes)
    // so "" remains as a raw token and dragon is a normal term
    expect(q.phrases).toEqual([]);
    expect(q.terms).toEqual(['""', 'dragon']);
  });
});

// ---------------------------------------------------------------------------
// isEmptyQuery
// ---------------------------------------------------------------------------
describe('isEmptyQuery', () => {
  it('returns true for completely empty query', () => {
    const q = parseQuery('');
    expect(isEmptyQuery(q)).toBe(true);
  });

  it('returns false when terms are present', () => {
    const q = parseQuery('dragon');
    expect(isEmptyQuery(q)).toBe(false);
  });

  it('returns false when phrases are present', () => {
    const q = parseQuery('"dark lord"');
    expect(isEmptyQuery(q)).toBe(false);
  });

  it('returns false when type filter is present', () => {
    const q = parseQuery('type:character');
    expect(isEmptyQuery(q)).toBe(false);
  });

  it('returns false when field filter is present', () => {
    const q = parseQuery('body:dragon');
    expect(isEmptyQuery(q)).toBe(false);
  });

  it('returns true when only exclusions are present', () => {
    // exclusions alone don't count as a non-empty query
    const q = parseQuery('-evil -type:location');
    expect(isEmptyQuery(q)).toBe(true);
  });
});
