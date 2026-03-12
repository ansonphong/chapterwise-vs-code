import { describe, it, expect } from 'vitest';
import {
  calculateBM25,
  scoreDocument,
  BOOST_FACTORS,
  getDepthBoost,
  getFieldBoost,
} from './scoring';
import type { SearchIndex } from './searchIndex';
import { createEmptyIndex } from './searchIndex';

// ---------------------------------------------------------------------------
// calculateBM25
// ---------------------------------------------------------------------------
describe('calculateBM25', () => {
  it('returns 0 when totalDocs is 0', () => {
    expect(calculateBM25(1, 100, 100, 1, 0)).toBe(0);
  });

  it('returns 0 when docFreq is 0', () => {
    expect(calculateBM25(1, 100, 100, 0, 10)).toBe(0);
  });

  it('returns positive score for valid inputs', () => {
    const score = calculateBM25(3, 100, 100, 5, 50);
    expect(score).toBeGreaterThan(0);
  });

  it('increases with higher term frequency (diminishing returns)', () => {
    const score1 = calculateBM25(1, 100, 100, 5, 50);
    const score2 = calculateBM25(5, 100, 100, 5, 50);
    expect(score2).toBeGreaterThan(score1);
  });

  it('shows saturation: tf=100 is not much more than tf=10', () => {
    const score10 = calculateBM25(10, 100, 100, 5, 50);
    const score100 = calculateBM25(100, 100, 100, 5, 50);
    // Ratio should be < 2 due to BM25 saturation
    expect(score100 / score10).toBeLessThan(2);
  });

  it('scores higher when term is rare (low docFreq)', () => {
    const scoreCommon = calculateBM25(2, 100, 100, 40, 50);
    const scoreRare = calculateBM25(2, 100, 100, 2, 50);
    expect(scoreRare).toBeGreaterThan(scoreCommon);
  });

  it('scores lower for longer documents (length normalization)', () => {
    const scoreShort = calculateBM25(2, 50, 100, 5, 50);
    const scoreLong = calculateBM25(2, 500, 100, 5, 50);
    expect(scoreShort).toBeGreaterThan(scoreLong);
  });

  it('uses fallback avgDocLength of 100 when avgDocLength is 0', () => {
    // Should not throw or return NaN
    const score = calculateBM25(2, 100, 0, 5, 50);
    expect(score).toBeGreaterThan(0);
    expect(Number.isFinite(score)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreDocument
// ---------------------------------------------------------------------------
describe('scoreDocument', () => {
  function makeIndex(overrides: Partial<SearchIndex> = {}): SearchIndex {
    return {
      ...createEmptyIndex('/test'),
      totalDocs: 10,
      avgDocLength: 100,
      ...overrides,
    };
  }

  it('returns 0 when no query terms match the index', () => {
    const index = makeIndex();
    const score = scoreDocument('doc1', ['missing'], index, 100);
    expect(score).toBe(0);
  });

  it('returns 0 when term exists but document is not in posting list', () => {
    const index = makeIndex({
      termIndex: {
        dragon: {
          term: 'dragon',
          docs: [{ id: 'doc2', tier: 1, positions: [0, 5], score: 0 }],
        },
      },
    });
    const score = scoreDocument('doc1', ['dragon'], index, 100);
    expect(score).toBe(0);
  });

  it('returns positive score when document matches a term', () => {
    const index = makeIndex({
      termIndex: {
        dragon: {
          term: 'dragon',
          docs: [{ id: 'doc1', tier: 1, positions: [0, 5, 12], score: 0 }],
        },
      },
    });
    const score = scoreDocument('doc1', ['dragon'], index, 100);
    expect(score).toBeGreaterThan(0);
  });

  it('accumulates scores across multiple matching terms', () => {
    const index = makeIndex({
      termIndex: {
        dragon: {
          term: 'dragon',
          docs: [{ id: 'doc1', tier: 1, positions: [0], score: 0 }],
        },
        sword: {
          term: 'sword',
          docs: [{ id: 'doc1', tier: 2, positions: [10], score: 0 }],
        },
      },
    });
    const scoreSingle = scoreDocument('doc1', ['dragon'], index, 100);
    const scoreBoth = scoreDocument('doc1', ['dragon', 'sword'], index, 100);
    expect(scoreBoth).toBeGreaterThan(scoreSingle);
  });
});

// ---------------------------------------------------------------------------
// BOOST_FACTORS
// ---------------------------------------------------------------------------
describe('BOOST_FACTORS', () => {
  it('has expected keys with numeric values', () => {
    expect(typeof BOOST_FACTORS.titleMatch).toBe('number');
    expect(typeof BOOST_FACTORS.rootNode).toBe('number');
    expect(typeof BOOST_FACTORS.nestedShallow).toBe('number');
    expect(typeof BOOST_FACTORS.nestedDeep).toBe('number');
    expect(typeof BOOST_FACTORS.tagMatch).toBe('number');
    expect(typeof BOOST_FACTORS.exactPhrase).toBe('number');
    expect(typeof BOOST_FACTORS.summaryField).toBe('number');
    expect(typeof BOOST_FACTORS.bodyField).toBe('number');
    expect(typeof BOOST_FACTORS.recentFile).toBe('number');
  });

  it('titleMatch is the highest boost', () => {
    expect(BOOST_FACTORS.titleMatch).toBeGreaterThan(BOOST_FACTORS.exactPhrase);
    expect(BOOST_FACTORS.titleMatch).toBeGreaterThan(BOOST_FACTORS.rootNode);
  });

  it('nestedDeep is less than nestedShallow', () => {
    expect(BOOST_FACTORS.nestedDeep).toBeLessThan(BOOST_FACTORS.nestedShallow);
  });
});

// ---------------------------------------------------------------------------
// getDepthBoost
// ---------------------------------------------------------------------------
describe('getDepthBoost', () => {
  it('returns rootNode boost for undefined path', () => {
    expect(getDepthBoost(undefined)).toBe(BOOST_FACTORS.rootNode);
  });

  it('returns rootNode boost for empty path', () => {
    expect(getDepthBoost([])).toBe(BOOST_FACTORS.rootNode);
  });

  it('returns nestedShallow for path length 1', () => {
    expect(getDepthBoost(['children'])).toBe(BOOST_FACTORS.nestedShallow);
  });

  it('returns nestedShallow for path length 2', () => {
    expect(getDepthBoost(['children', 'sub'])).toBe(BOOST_FACTORS.nestedShallow);
  });

  it('returns nestedDeep for path length 3+', () => {
    expect(getDepthBoost(['a', 'b', 'c'])).toBe(BOOST_FACTORS.nestedDeep);
    expect(getDepthBoost(['a', 'b', 'c', 'd'])).toBe(BOOST_FACTORS.nestedDeep);
  });
});

// ---------------------------------------------------------------------------
// getFieldBoost
// ---------------------------------------------------------------------------
describe('getFieldBoost', () => {
  it('returns summaryField boost for "summary"', () => {
    expect(getFieldBoost('summary')).toBe(BOOST_FACTORS.summaryField);
  });

  it('returns bodyField boost for "body"', () => {
    expect(getFieldBoost('body')).toBe(BOOST_FACTORS.bodyField);
  });

  it('returns bodyField boost for any unknown field', () => {
    expect(getFieldBoost('description')).toBe(BOOST_FACTORS.bodyField);
    expect(getFieldBoost('notes')).toBe(BOOST_FACTORS.bodyField);
  });
});
