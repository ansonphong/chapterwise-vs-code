import { describe, it, expect } from 'vitest';
import { tokenize, levenshteinDistance, fuzzyMatch, escapeRegex } from './tokenizer';

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------
describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips punctuation and keeps words >= 2 chars', () => {
    expect(tokenize('It\'s a fine day!')).toEqual(['it', 'fine', 'day']);
  });

  it('filters out single-character tokens', () => {
    expect(tokenize('I am a hero')).toEqual(['am', 'hero']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('returns empty array for null/undefined', () => {
    expect(tokenize(null as unknown as string)).toEqual([]);
    expect(tokenize(undefined as unknown as string)).toEqual([]);
  });

  it('returns empty array for non-string input', () => {
    expect(tokenize(42 as unknown as string)).toEqual([]);
  });

  it('handles multiple spaces and tabs', () => {
    expect(tokenize('  dragon   sword  ')).toEqual(['dragon', 'sword']);
  });

  it('preserves unicode letters', () => {
    const result = tokenize('caf\u00e9 na\u00efve');
    expect(result).toEqual(['caf\u00e9', 'na\u00efve']);
  });

  it('treats numbers as valid tokens', () => {
    expect(tokenize('chapter 12 scene 3')).toEqual(['chapter', '12', 'scene']);
  });
});

// ---------------------------------------------------------------------------
// levenshteinDistance
// ---------------------------------------------------------------------------
describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns length of b when a is empty', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5);
  });

  it('returns length of a when b is empty', () => {
    expect(levenshteinDistance('hello', '')).toBe(5);
  });

  it('counts single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('counts single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('counts single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('handles completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });

  it('is symmetric', () => {
    const d1 = levenshteinDistance('kitten', 'sitting');
    const d2 = levenshteinDistance('sitting', 'kitten');
    expect(d1).toBe(d2);
  });

  it('computes known distance for kitten/sitting', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// fuzzyMatch
// ---------------------------------------------------------------------------
describe('fuzzyMatch', () => {
  it('returns true for exact substring match (case-insensitive)', () => {
    expect(fuzzyMatch('dragon', 'The Dragon Queen')).toBe(true);
  });

  it('returns true for exact word match', () => {
    expect(fuzzyMatch('sword', 'sword')).toBe(true);
  });

  it('returns false for short term with no substring match', () => {
    // term length <= 3 => maxDistance = 0
    expect(fuzzyMatch('cat', 'dog')).toBe(false);
  });

  it('returns true for medium term with 1 typo (edit distance 1)', () => {
    // "dragin" vs "dragon" — edit distance 1, term length 6 => maxDistance 1
    expect(fuzzyMatch('dragin', 'dragon')).toBe(true);
  });

  it('returns false for medium term with 2 typos', () => {
    // "dragxx" vs "dragon" — edit distance 2, term length 6 => maxDistance 1
    expect(fuzzyMatch('dragxx', 'dragon')).toBe(false);
  });

  it('returns true for long term with 2 typos (edit distance 2)', () => {
    // "charactee" vs "character" — edit distance 1, but let's use 2 edits
    // "charakter" vs "character" — edit distance 2, term length 9 => maxDistance 2
    expect(fuzzyMatch('charekter', 'character')).toBe(true);
  });

  it('returns false for long term with 3 typos', () => {
    // "chxxxxxxx" vs "character" — way off
    expect(fuzzyMatch('chxxxxxxx', 'character')).toBe(false);
  });

  it('matches against individual words in the target', () => {
    // "swerd" vs word "sword" — edit distance 1, term length 5 => maxDistance 1
    expect(fuzzyMatch('swerd', 'the magic sword')).toBe(true);
  });

  it('returns false when no word is close enough', () => {
    expect(fuzzyMatch('zzzzz', 'the magic sword')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// escapeRegex
// ---------------------------------------------------------------------------
describe('escapeRegex', () => {
  it('escapes all special regex characters', () => {
    const input = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(input);
    // Each special char should be preceded by backslash
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('leaves normal characters untouched', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
  });

  it('handles mixed content', () => {
    expect(escapeRegex('price: $10.00')).toBe('price: \\$10\\.00');
  });

  it('returns empty string for empty input', () => {
    expect(escapeRegex('')).toBe('');
  });
});
