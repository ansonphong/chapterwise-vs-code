# Search System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a powerful QuickPick-based search system to ChapterWise Codex that searches titles, metadata, and content with fuzzy matching, filters, and BM25 ranking.

**Architecture:** Tiered search (titles → metadata → content) with background indexing, persistent JSON cache, and incremental file watching. Uses VS Code's native QuickPick for UI with 150ms debounce.

**Tech Stack:** TypeScript, VS Code Extension API (QuickPick, FileSystemWatcher), BM25 scoring algorithm, Levenshtein distance for fuzzy matching.

**Design Reference:** See `dev/2026-02-05-search-system-design.md` for full architecture details.

---

## Phase 1: Core Foundation

### Task 1: Create Search Module Structure

**Files:**
- Create: `src/search/index.ts`
- Create: `src/search/searchIndex.ts`

**Step 1: Create the search directory and index.ts**

```bash
mkdir -p src/search
```

**Step 2: Create searchIndex.ts with type definitions**

Create `src/search/searchIndex.ts`:

```typescript
/**
 * Search Index Types
 * Defines the structure for the search index used by ChapterWise Codex
 */

/**
 * Complete search index structure
 */
export interface SearchIndex {
  version: string;
  created: number;
  contextFolder: string;
  fileHashes: Record<string, string>;
  titles: TitleEntry[];
  metadata: MetadataEntry[];
  content: ContentEntry[];
  termIndex: Record<string, PostingList>;
  avgDocLength: number;
  totalDocs: number;
}

/**
 * Title index entry - for instant name/ID searches
 */
export interface TitleEntry {
  id: string;
  name: string;
  type: string;
  path: string;
  nodePath?: string[];
  boost: number;
}

/**
 * Metadata index entry - for tag/attribute searches
 */
export interface MetadataEntry {
  id: string;
  tags: string[];
  attributes: Record<string, string>;
  type: string;
  path: string;
  nodePath?: string[];
}

/**
 * Content index entry - for full-text prose searches
 */
export interface ContentEntry {
  id: string;
  field: string;
  text: string;
  tokens: string[];
  length: number;
  path: string;
  nodePath?: string[];
}

/**
 * Inverted index posting list
 */
export interface PostingList {
  term: string;
  docs: PostingEntry[];
}

/**
 * Single posting entry in the inverted index
 */
export interface PostingEntry {
  id: string;
  tier: 1 | 2 | 3;
  positions: number[];
  score: number;
}

/**
 * Search result returned to UI
 */
export interface SearchResult {
  id: string;
  name: string;
  type: string;
  path: string;
  nodePath?: string[];
  field?: string;
  snippet?: string;
  score: number;
  tier: 1 | 2 | 3;
  matchType: 'title' | 'tag' | 'attribute' | 'content';
}

/**
 * Create an empty search index
 */
export function createEmptyIndex(contextFolder: string): SearchIndex {
  return {
    version: '1.0',
    created: Date.now(),
    contextFolder,
    fileHashes: {},
    titles: [],
    metadata: [],
    content: [],
    termIndex: {},
    avgDocLength: 100,
    totalDocs: 0
  };
}
```

**Step 3: Create index.ts barrel export**

Create `src/search/index.ts`:

```typescript
/**
 * Search Module - Main exports
 */

// Types
export {
  SearchIndex,
  TitleEntry,
  MetadataEntry,
  ContentEntry,
  PostingList,
  PostingEntry,
  SearchResult,
  createEmptyIndex
} from './searchIndex';
```

**Step 4: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors related to search module

**Step 5: Commit**

```bash
git add src/search/
git commit -m "feat(search): add search index type definitions"
```

---

### Task 2: Implement Tokenizer

**Files:**
- Create: `src/search/tokenizer.ts`
- Modify: `src/search/index.ts`

**Step 1: Create tokenizer.ts**

Create `src/search/tokenizer.ts`:

```typescript
/**
 * Tokenizer - Text processing for search indexing
 */

/**
 * Tokenize text into searchable terms
 */
export function tokenize(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2);
}

/**
 * Calculate Levenshtein edit distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if search term fuzzy-matches a target string
 * Uses length-based edit distance thresholds
 */
export function fuzzyMatch(term: string, target: string): boolean {
  const termLower = term.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact substring match always passes
  if (targetLower.includes(termLower)) {
    return true;
  }

  // Determine max edit distance based on term length
  let maxDistance: number;
  if (term.length <= 3) {
    maxDistance = 0; // Exact only for short terms
  } else if (term.length <= 6) {
    maxDistance = 1; // 1 typo for medium terms
  } else {
    maxDistance = 2; // 2 typos for long terms
  }

  if (maxDistance === 0) {
    return false;
  }

  // Check each word in target
  const targetWords = targetLower.split(/\s+/);
  for (const word of targetWords) {
    if (levenshteinDistance(termLower, word) <= maxDistance) {
      return true;
    }
  }

  return false;
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Step 2: Add tokenizer exports to index.ts**

Modify `src/search/index.ts` - add at end:

```typescript

// Tokenizer
export {
  tokenize,
  levenshteinDistance,
  fuzzyMatch,
  escapeRegex
} from './tokenizer';
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

```bash
git add src/search/
git commit -m "feat(search): add tokenizer with fuzzy matching"
```

---

### Task 3: Implement Query Parser

**Files:**
- Create: `src/search/queryParser.ts`
- Modify: `src/search/index.ts`

**Step 1: Create queryParser.ts**

Create `src/search/queryParser.ts`:

```typescript
/**
 * Query Parser - Parse search input into structured query
 */

/**
 * Parsed query structure
 */
export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  filters: {
    types: string[];
    fields: FieldFilter[];
    exclude: {
      types: string[];
      terms: string[];
    };
  };
  scope: 'titles' | 'metadata' | 'all';
}

/**
 * Field-specific filter
 */
export interface FieldFilter {
  field: string;
  value: string;
}

/**
 * Parse user search input into structured query
 *
 * Syntax:
 * - Basic: aragorn sword (fuzzy AND)
 * - Exact: "king of gondor"
 * - Type: type:character
 * - Field: body:dragon
 * - Exclude: -type:location -unwanted
 */
export function parseQuery(input: string): ParsedQuery {
  const result: ParsedQuery = {
    terms: [],
    phrases: [],
    filters: {
      types: [],
      fields: [],
      exclude: { types: [], terms: [] }
    },
    scope: 'all'
  };

  if (!input || typeof input !== 'string') {
    return result;
  }

  // 1. Extract quoted phrases: "exact phrase"
  const phraseRegex = /"([^"]+)"/g;
  let match;
  while ((match = phraseRegex.exec(input)) !== null) {
    const phrase = match[1].trim().toLowerCase();
    if (phrase) {
      result.phrases.push(phrase);
    }
  }
  const withoutPhrases = input.replace(phraseRegex, ' ');

  // 2. Tokenize remaining input
  const tokens = withoutPhrases.split(/\s+/).filter(Boolean);

  // 3. Classify each token
  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower.startsWith('type:')) {
      const value = lower.slice(5);
      if (value) {
        result.filters.types.push(value);
      }
    } else if (lower.startsWith('-type:')) {
      const value = lower.slice(6);
      if (value) {
        result.filters.exclude.types.push(value);
      }
    } else if (lower.match(/^(body|summary|description|attributes|tags):/)) {
      const colonIdx = lower.indexOf(':');
      const field = lower.slice(0, colonIdx);
      const value = lower.slice(colonIdx + 1);
      if (value) {
        result.filters.fields.push({ field, value });
      }
    } else if (lower.startsWith('-') && lower.length > 1) {
      result.filters.exclude.terms.push(lower.slice(1));
    } else if (lower.length >= 2) {
      result.terms.push(lower);
    }
  }

  return result;
}

/**
 * Check if a query is empty (no search terms)
 */
export function isEmptyQuery(query: ParsedQuery): boolean {
  return (
    query.terms.length === 0 &&
    query.phrases.length === 0 &&
    query.filters.types.length === 0 &&
    query.filters.fields.length === 0
  );
}
```

**Step 2: Add queryParser exports to index.ts**

Modify `src/search/index.ts` - add at end:

```typescript

// Query Parser
export {
  ParsedQuery,
  FieldFilter,
  parseQuery,
  isEmptyQuery
} from './queryParser';
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

```bash
git add src/search/
git commit -m "feat(search): add query parser with filter support"
```

---

### Task 4: Implement BM25 Scoring

**Files:**
- Create: `src/search/scoring.ts`
- Modify: `src/search/index.ts`

**Step 1: Create scoring.ts**

Create `src/search/scoring.ts`:

```typescript
/**
 * BM25 Scoring - Relevance ranking for search results
 */

import { SearchIndex, PostingEntry } from './searchIndex';

// BM25 parameters (empirically tuned defaults)
const K1 = 1.2;  // Term frequency saturation
const B = 0.75;  // Document length normalization

/**
 * Calculate BM25 score for a single term in a document
 */
export function calculateBM25(
  termFreq: number,
  docLength: number,
  avgDocLength: number,
  docFreq: number,
  totalDocs: number
): number {
  // Handle edge cases
  if (totalDocs === 0 || docFreq === 0) {
    return 0;
  }

  // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
  const idf = Math.log(
    (totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1
  );

  // TF component with length normalization
  const avgLen = avgDocLength || 100;
  const tfNorm = (termFreq * (K1 + 1)) / (
    termFreq + K1 * (1 - B + B * (docLength / avgLen))
  );

  return idf * tfNorm;
}

/**
 * Score a document against multiple query terms
 */
export function scoreDocument(
  docId: string,
  queryTerms: string[],
  index: SearchIndex,
  docLength: number
): number {
  let score = 0;

  for (const term of queryTerms) {
    const posting = index.termIndex[term];
    if (!posting) continue;

    const docPosting = posting.docs.find(d => d.id === docId);
    if (!docPosting) continue;

    score += calculateBM25(
      docPosting.positions.length,
      docLength,
      index.avgDocLength,
      posting.docs.length,
      index.totalDocs
    );
  }

  return score;
}

/**
 * Boost factors for different match types
 */
export const BOOST_FACTORS = {
  titleMatch: 3.0,
  rootNode: 1.5,
  nestedShallow: 1.0,  // depth 1-2
  nestedDeep: 0.8,     // depth 3+
  tagMatch: 1.3,
  exactPhrase: 2.0,
  summaryField: 1.2,
  bodyField: 1.0,
  recentFile: 1.1
} as const;

/**
 * Calculate boost based on node depth
 */
export function getDepthBoost(nodePath?: string[]): number {
  if (!nodePath || nodePath.length === 0) {
    return BOOST_FACTORS.rootNode;
  }
  if (nodePath.length <= 2) {
    return BOOST_FACTORS.nestedShallow;
  }
  return BOOST_FACTORS.nestedDeep;
}

/**
 * Calculate boost based on field type
 */
export function getFieldBoost(field: string): number {
  if (field === 'summary') {
    return BOOST_FACTORS.summaryField;
  }
  return BOOST_FACTORS.bodyField;
}
```

**Step 2: Add scoring exports to index.ts**

Modify `src/search/index.ts` - add at end:

```typescript

// Scoring
export {
  calculateBM25,
  scoreDocument,
  BOOST_FACTORS,
  getDepthBoost,
  getFieldBoost
} from './scoring';
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

```bash
git add src/search/
git commit -m "feat(search): add BM25 scoring algorithm"
```

---

### Task 5: Implement Search Engine

**Files:**
- Create: `src/search/searchEngine.ts`
- Modify: `src/search/index.ts`

**Step 1: Create searchEngine.ts**

Create `src/search/searchEngine.ts`:

```typescript
/**
 * Search Engine - Execute searches across the index
 */

import {
  SearchIndex,
  SearchResult,
  TitleEntry,
  MetadataEntry,
  ContentEntry
} from './searchIndex';
import { ParsedQuery } from './queryParser';
import { fuzzyMatch } from './tokenizer';
import { scoreDocument, BOOST_FACTORS, getDepthBoost, getFieldBoost } from './scoring';

/**
 * Search options
 */
export interface SearchOptions {
  limit: number;
  timeout: number;
}

/**
 * Execute search across all tiers
 */
export async function executeSearch(
  query: ParsedQuery,
  index: SearchIndex,
  options: SearchOptions = { limit: 50, timeout: 2000 }
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const startTime = Date.now();

  // TIER 1: Titles (instant)
  const titleResults = searchTitles(query, index);
  for (const r of titleResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      results.push(r);
    }
  }

  // Early return for simple queries with enough results
  if (results.length >= options.limit && query.terms.length <= 2 && query.phrases.length === 0) {
    return rankResults(results).slice(0, options.limit);
  }

  // TIER 2: Metadata
  const metaResults = searchMetadata(query, index);
  for (const r of metaResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      results.push(r);
    }
  }

  // Check timeout
  if (Date.now() - startTime > options.timeout) {
    return rankResults(results).slice(0, options.limit);
  }

  // TIER 3: Content
  if (query.scope === 'all' || query.filters.fields.length > 0) {
    const contentResults = searchContent(query, index);
    for (const r of contentResults) {
      const key = `${r.id}:${r.field || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(r);
      }
    }
  }

  return rankResults(results).slice(0, options.limit);
}

/**
 * Search titles (Tier 1)
 */
function searchTitles(query: ParsedQuery, index: SearchIndex): SearchResult[] {
  const results: SearchResult[] = [];

  for (const entry of index.titles) {
    // Check type filter
    if (query.filters.types.length > 0) {
      if (!query.filters.types.includes(entry.type.toLowerCase())) {
        continue;
      }
    }

    // Check type exclusion
    if (query.filters.exclude.types.includes(entry.type.toLowerCase())) {
      continue;
    }

    // Check term matches
    let matches = false;
    let score = 0;

    for (const term of query.terms) {
      if (fuzzyMatch(term, entry.name) || fuzzyMatch(term, entry.id)) {
        matches = true;
        score += BOOST_FACTORS.titleMatch;
      }
    }

    // Check phrase matches
    for (const phrase of query.phrases) {
      if (entry.name.toLowerCase().includes(phrase)) {
        matches = true;
        score += BOOST_FACTORS.titleMatch * BOOST_FACTORS.exactPhrase;
      }
    }

    // If no search terms, match all (filtered results)
    if (query.terms.length === 0 && query.phrases.length === 0) {
      matches = query.filters.types.length > 0;
      score = 1;
    }

    if (matches) {
      score *= entry.boost;
      results.push({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        path: entry.path,
        nodePath: entry.nodePath,
        score,
        tier: 1,
        matchType: 'title'
      });
    }
  }

  return results;
}

/**
 * Search metadata (Tier 2)
 */
function searchMetadata(query: ParsedQuery, index: SearchIndex): SearchResult[] {
  const results: SearchResult[] = [];

  for (const entry of index.metadata) {
    // Check type filter
    if (query.filters.types.length > 0) {
      if (!query.filters.types.includes(entry.type.toLowerCase())) {
        continue;
      }
    }

    // Check type exclusion
    if (query.filters.exclude.types.includes(entry.type.toLowerCase())) {
      continue;
    }

    let matches = false;
    let score = 0;
    let matchType: 'tag' | 'attribute' = 'tag';

    // Search tags
    for (const term of query.terms) {
      for (const tag of entry.tags) {
        if (fuzzyMatch(term, tag)) {
          matches = true;
          score += BOOST_FACTORS.tagMatch;
          matchType = 'tag';
        }
      }
    }

    // Search attributes
    for (const term of query.terms) {
      for (const [key, value] of Object.entries(entry.attributes)) {
        if (fuzzyMatch(term, key) || fuzzyMatch(term, String(value))) {
          matches = true;
          score += 1.0;
          matchType = 'attribute';
        }
      }
    }

    if (matches) {
      // Get title entry for display name
      const titleEntry = index.titles.find(t => t.id === entry.id);
      results.push({
        id: entry.id,
        name: titleEntry?.name || entry.id,
        type: entry.type,
        path: entry.path,
        nodePath: entry.nodePath,
        score,
        tier: 2,
        matchType
      });
    }
  }

  return results;
}

/**
 * Search content (Tier 3)
 */
function searchContent(query: ParsedQuery, index: SearchIndex): SearchResult[] {
  const results: SearchResult[] = [];

  // Check if we have field-specific filters
  const fieldFilters = query.filters.fields;
  const hasFieldFilters = fieldFilters.length > 0;

  for (const entry of index.content) {
    // Check field filter
    if (hasFieldFilters) {
      const matchesField = fieldFilters.some(f => f.field === entry.field);
      if (!matchesField) continue;
    }

    let matches = false;
    let score = 0;

    // Check terms in tokens
    for (const term of query.terms) {
      // Check exclusions first
      if (query.filters.exclude.terms.includes(term)) {
        continue;
      }

      for (const token of entry.tokens) {
        if (fuzzyMatch(term, token)) {
          matches = true;
          score = scoreDocument(entry.id, [term], index, entry.length);
          break;
        }
      }
    }

    // Check field filter values
    for (const filter of fieldFilters) {
      if (filter.field === entry.field) {
        if (entry.text.toLowerCase().includes(filter.value.toLowerCase())) {
          matches = true;
          score += 2.0;
        }
      }
    }

    // Check phrases
    for (const phrase of query.phrases) {
      if (entry.text.toLowerCase().includes(phrase)) {
        matches = true;
        score += BOOST_FACTORS.exactPhrase;
      }
    }

    if (matches) {
      score *= getFieldBoost(entry.field);

      // Get title entry for display name
      const titleEntry = index.titles.find(t => t.id === entry.id);

      // Create snippet
      const snippet = createSnippet(entry.text, query.terms, query.phrases);

      results.push({
        id: entry.id,
        name: titleEntry?.name || entry.id,
        type: titleEntry?.type || 'unknown',
        path: entry.path,
        nodePath: entry.nodePath,
        field: entry.field,
        snippet,
        score,
        tier: 3,
        matchType: 'content'
      });
    }
  }

  return results;
}

/**
 * Create a snippet showing context around matched terms
 */
function createSnippet(text: string, terms: string[], phrases: string[]): string {
  const maxLength = 100;
  const textLower = text.toLowerCase();

  // Find first match position
  let matchPos = -1;
  for (const term of terms) {
    const pos = textLower.indexOf(term);
    if (pos !== -1 && (matchPos === -1 || pos < matchPos)) {
      matchPos = pos;
    }
  }
  for (const phrase of phrases) {
    const pos = textLower.indexOf(phrase);
    if (pos !== -1 && (matchPos === -1 || pos < matchPos)) {
      matchPos = pos;
    }
  }

  if (matchPos === -1) {
    return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
  }

  // Extract context around match
  const start = Math.max(0, matchPos - 20);
  const end = Math.min(text.length, matchPos + maxLength - 20);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet.replace(/\n/g, ' ').trim();
}

/**
 * Rank results by score descending, then tier ascending
 */
function rankResults(results: SearchResult[]): SearchResult[] {
  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tier - b.tier;
  });
}
```

**Step 2: Add searchEngine exports to index.ts**

Modify `src/search/index.ts` - add at end:

```typescript

// Search Engine
export {
  SearchOptions,
  executeSearch
} from './searchEngine';
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

```bash
git add src/search/
git commit -m "feat(search): add search engine with tiered execution"
```

---

## Phase 2: Basic UI

### Task 6: Implement Search UI (QuickPick)

**Files:**
- Create: `src/search/searchUI.ts`
- Modify: `src/search/index.ts`

**Step 1: Create searchUI.ts**

Create `src/search/searchUI.ts`:

```typescript
/**
 * Search UI - QuickPick interface for search
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SearchIndex, SearchResult } from './searchIndex';
import { parseQuery, isEmptyQuery } from './queryParser';
import { executeSearch } from './searchEngine';
import { escapeRegex } from './tokenizer';

/**
 * Extended QuickPickItem with search result data
 */
interface SearchResultItem extends vscode.QuickPickItem {
  resultData?: SearchResult;
  isRecent?: boolean;
  recentQuery?: string;
}

// Recent searches storage
const MAX_RECENT_SEARCHES = 10;
let recentSearches: string[] = [];

// Status bar item
let statusBarItem: vscode.StatusBarItem | null = null;

/**
 * Initialize the status bar item
 */
export function initializeStatusBar(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'chapterwiseCodex.search';
  context.subscriptions.push(statusBarItem);
  updateStatusBar('idle');
}

/**
 * Update status bar state
 */
export function updateStatusBar(
  state: 'idle' | 'building' | 'ready',
  progress?: number
): void {
  if (!statusBarItem) return;

  switch (state) {
    case 'idle':
      statusBarItem.text = '$(search) Search';
      statusBarItem.tooltip = 'Set a context folder to enable search';
      statusBarItem.backgroundColor = undefined;
      statusBarItem.hide();
      break;

    case 'building':
      statusBarItem.text = `$(sync~spin) Indexing ${progress || 0}%`;
      statusBarItem.tooltip = 'Building search index...';
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      statusBarItem.show();
      break;

    case 'ready':
      statusBarItem.text = '$(search) Search';
      statusBarItem.tooltip = 'Search nodes (Cmd+Shift+F)';
      statusBarItem.backgroundColor = undefined;
      statusBarItem.show();
      break;
  }
}

/**
 * Open the search UI
 */
export async function openSearchUI(
  index: SearchIndex,
  onNavigate: (result: SearchResult) => Promise<void>
): Promise<void> {
  const quickPick = vscode.window.createQuickPick<SearchResultItem>();

  // Configuration
  quickPick.placeholder = 'Search nodes... (use type: field: "exact" for filters)';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.keepScrollPosition = true;

  // Show recent searches initially
  quickPick.items = getRecentSearchItems();

  // Debounced search
  let debounceTimer: NodeJS.Timeout | undefined;

  quickPick.onDidChangeValue(value => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    if (!value.trim()) {
      quickPick.items = getRecentSearchItems();
      return;
    }

    debounceTimer = setTimeout(async () => {
      quickPick.busy = true;

      try {
        const query = parseQuery(value);
        const results = await executeSearch(query, index, {
          limit: 50,
          timeout: 2000
        });
        quickPick.items = formatResults(results, value);
      } catch (error) {
        console.error('[Search] Error:', error);
        quickPick.items = [{
          label: '$(error) Search error',
          description: String(error)
        }];
      } finally {
        quickPick.busy = false;
      }
    }, 150);
  });

  // Handle selection
  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected) return;

    // Handle recent search selection
    if (selected.isRecent && selected.recentQuery) {
      quickPick.value = selected.recentQuery;
      return;
    }

    // Handle result selection
    if (selected.resultData) {
      saveRecentSearch(quickPick.value);
      quickPick.hide();
      await onNavigate(selected.resultData);
    }
  });

  quickPick.onDidHide(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    quickPick.dispose();
  });

  quickPick.show();
}

/**
 * Get recent searches as QuickPick items
 */
function getRecentSearchItems(): SearchResultItem[] {
  if (recentSearches.length === 0) {
    return [{
      label: '$(info) Start typing to search...',
      description: 'Use type: field: "exact" for filters'
    }];
  }

  const items: SearchResultItem[] = [{
    label: 'Recent Searches',
    kind: vscode.QuickPickItemKind.Separator
  }];

  for (const query of recentSearches) {
    items.push({
      label: `$(history) ${query}`,
      description: 'Recent search',
      isRecent: true,
      recentQuery: query
    });
  }

  return items;
}

/**
 * Save a search to recent history
 */
function saveRecentSearch(query: string): void {
  if (!query.trim()) return;

  recentSearches = recentSearches.filter(s => s !== query);
  recentSearches.unshift(query);

  if (recentSearches.length > MAX_RECENT_SEARCHES) {
    recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);
  }
}

/**
 * Format search results for QuickPick
 */
function formatResults(results: SearchResult[], query: string): SearchResultItem[] {
  const items: SearchResultItem[] = [];

  const titleResults = results.filter(r => r.tier === 1);
  const metaResults = results.filter(r => r.tier === 2);
  const contentResults = results.filter(r => r.tier === 3);

  // Titles
  if (titleResults.length > 0) {
    items.push({
      label: 'Titles',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...titleResults.map(r => formatResultItem(r, query)));
  }

  // Metadata
  if (metaResults.length > 0) {
    items.push({
      label: 'Tags & Attributes',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...metaResults.map(r => formatResultItem(r, query)));
  }

  // Content
  if (contentResults.length > 0) {
    items.push({
      label: 'Content',
      kind: vscode.QuickPickItemKind.Separator
    });
    items.push(...contentResults.map(r => formatResultItem(r, query)));
  }

  // No results
  if (items.length === 0) {
    items.push({
      label: '$(info) No results found',
      description: 'Try different keywords or remove filters'
    });
  }

  return items;
}

/**
 * Format a single result item
 */
function formatResultItem(result: SearchResult, query: string): SearchResultItem {
  const icon = getTypeIcon(result.type);
  const highlightedName = highlightMatches(result.name, query);

  const breadcrumb = result.nodePath
    ? result.nodePath.join(' › ')
    : path.basename(result.path, path.extname(result.path));

  let detail = breadcrumb;
  if (result.snippet) {
    detail += ` · ${result.snippet}`;
  }

  return {
    label: `${icon} ${highlightedName}`,
    description: result.type,
    detail,
    resultData: result
  };
}

/**
 * Get VS Code icon for node type
 */
function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    character: '$(person)',
    chapter: '$(file-text)',
    location: '$(globe)',
    scene: '$(symbol-event)',
    folder: '$(folder)',
    book: '$(book)',
    item: '$(package)',
    note: '$(note)',
    faction: '$(organization)',
    concept: '$(lightbulb)',
    event: '$(calendar)',
    timeline: '$(timeline-open)',
    module: '$(symbol-module)'
  };
  return icons[type.toLowerCase()] || '$(symbol-misc)';
}

/**
 * Highlight matching terms in text
 */
function highlightMatches(text: string, query: string): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2 && !t.includes(':') && !t.startsWith('-') && !t.startsWith('"'));

  let result = text;
  for (const term of terms) {
    try {
      const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
      result = result.replace(regex, '**$1**');
    } catch {
      // Invalid regex, skip
    }
  }

  return result;
}
```

**Step 2: Add searchUI exports to index.ts**

Modify `src/search/index.ts` - add at end:

```typescript

// Search UI
export {
  initializeStatusBar,
  updateStatusBar,
  openSearchUI
} from './searchUI';
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

```bash
git add src/search/
git commit -m "feat(search): add QuickPick search UI"
```

---

### Task 7: Register Search Command

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

**Step 1: Read current extension.ts to find activation function**

Run: `grep -n "export function activate" /Users/phong/Projects/chapterwise-codex/src/extension.ts | head -5`

**Step 2: Add search imports and command registration to extension.ts**

Add near the top of `src/extension.ts` (after other imports):

```typescript
import {
  initializeStatusBar,
  updateStatusBar,
  openSearchUI,
  SearchResult,
  createEmptyIndex
} from './search';
```

Add inside the `activate` function (after other command registrations):

```typescript
  // Initialize search status bar
  initializeStatusBar(context);

  // Search command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.search', async () => {
      const treeProvider = getTreeProvider();
      const contextFolder = treeProvider?.getContextFolder();
      const workspaceRoot = treeProvider?.getWorkspaceRoot();

      if (!contextFolder || !workspaceRoot) {
        vscode.window.showWarningMessage(
          'Set a context folder first (right-click a folder → Set as Codex Context)'
        );
        return;
      }

      // For now, use empty index - will be populated by IndexManager in Phase 3
      const index = createEmptyIndex(contextFolder);

      await openSearchUI(index, async (result: SearchResult) => {
        // Navigate to result
        const isStructural = ['folder', 'book', 'index'].includes(result.type.toLowerCase());

        if (isStructural) {
          // Reveal in tree
          vscode.window.showInformationMessage(`Would reveal: ${result.name}`);
        } else {
          // Open in Writer View
          const fullPath = path.join(workspaceRoot, result.path);
          await vscode.commands.executeCommand(
            'chapterwiseCodex.openWriterView',
            { filePath: fullPath, nodePath: result.nodePath }
          );
        }
      });
    })
  );
```

**Step 3: Add search command to package.json**

Find the `"commands"` array in `package.json` and add:

```json
      {
        "command": "chapterwiseCodex.search",
        "title": "ChapterWise Codex: Search",
        "icon": "$(search)"
      },
```

Find the `"keybindings"` array (or create it) and add:

```json
    "keybindings": [
      {
        "command": "chapterwiseCodex.search",
        "key": "cmd+shift+f",
        "mac": "cmd+shift+f",
        "win": "ctrl+shift+f",
        "linux": "ctrl+shift+f",
        "when": "view.chapterwiseCodexNavigator.visible"
      }
    ],
```

Find the `"view/title"` menu section and add (in navigation group):

```json
          {
            "command": "chapterwiseCodex.search",
            "when": "view == chapterwiseCodexNavigator",
            "group": "navigation@1"
          },
```

**Step 4: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -30`

Expected: No errors

**Step 5: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(search): register search command with keybinding"
```

---

## Phase 3: Index Manager

### Task 8: Implement Index Manager (Part 1 - Core)

**Files:**
- Create: `src/search/indexManager.ts`
- Modify: `src/search/index.ts`

**Step 1: Create indexManager.ts (Part 1 - Core structure)**

Create `src/search/indexManager.ts`:

```typescript
/**
 * Index Manager - Build, cache, and maintain the search index
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  SearchIndex,
  TitleEntry,
  MetadataEntry,
  ContentEntry,
  createEmptyIndex
} from './searchIndex';
import { tokenize } from './tokenizer';
import { getDepthBoost } from './scoring';

/**
 * Manages search index lifecycle
 */
export class SearchIndexManager {
  private index: SearchIndex | null = null;
  private indexPath: string | null = null;
  private buildProgress: number = 0;
  private isBuilding: boolean = false;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private pendingUpdates: Set<string> = new Set();
  private updateDebounceTimer: NodeJS.Timeout | null = null;
  private buildMutex: Promise<void> = Promise.resolve();
  private workspaceRoot: string | null = null;
  private contextFolder: string | null = null;

  private _onIndexReady = new vscode.EventEmitter<SearchIndex>();
  private _onBuildProgress = new vscode.EventEmitter<number>();
  readonly onIndexReady = this._onIndexReady.event;
  readonly onBuildProgress = this._onBuildProgress.event;

  /**
   * Initialize index for a context folder
   */
  async initializeForContext(
    contextFolder: string,
    workspaceRoot: string
  ): Promise<void> {
    this.contextFolder = contextFolder;
    this.workspaceRoot = workspaceRoot;

    const cacheFile = path.join(workspaceRoot, contextFolder, '.index-search.json');
    this.indexPath = cacheFile;

    // Try loading from cache
    const cached = await this.loadFromCache(cacheFile);

    if (cached && await this.validateCache(cached, workspaceRoot)) {
      this.index = cached;
      this._onIndexReady.fire(this.index);
      // Background refresh for stale entries
      this.refreshStaleEntries();
    } else {
      await this.buildIndexAsync();
    }

    this.setupFileWatcher();
  }

  /**
   * Get current index
   */
  getIndex(): SearchIndex | null {
    return this.index;
  }

  /**
   * Check if index is ready
   */
  isReady(): boolean {
    return this.index !== null && !this.isBuilding;
  }

  /**
   * Get build progress (0-100)
   */
  getBuildProgress(): number {
    return this.buildProgress;
  }

  /**
   * Force rebuild
   */
  async forceRebuild(): Promise<void> {
    if (this.indexPath && fs.existsSync(this.indexPath)) {
      await fs.promises.unlink(this.indexPath);
    }
    await this.buildIndexAsync();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.fileWatcher?.dispose();
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }
    this._onIndexReady.dispose();
    this._onBuildProgress.dispose();
  }

  /**
   * Load index from cache
   */
  private async loadFromCache(cachePath: string): Promise<SearchIndex | null> {
    try {
      if (!fs.existsSync(cachePath)) return null;

      const content = await fs.promises.readFile(cachePath, 'utf-8');
      const cached = JSON.parse(content) as SearchIndex;

      if (cached.version !== '1.0') return null;

      // Age check (7 days)
      const age = Date.now() - cached.created;
      if (age > 7 * 24 * 60 * 60 * 1000) return null;

      return cached;
    } catch {
      return null;
    }
  }

  /**
   * Validate cache by checking file hashes
   */
  private async validateCache(
    cached: SearchIndex,
    workspaceRoot: string
  ): Promise<boolean> {
    try {
      const sampleSize = Math.min(10, Object.keys(cached.fileHashes).length);
      const files = Object.keys(cached.fileHashes).slice(0, sampleSize);

      for (const file of files) {
        const fullPath = path.join(workspaceRoot, file);
        if (!fs.existsSync(fullPath)) return false;

        const content = await fs.promises.readFile(fullPath, 'utf-8');
        const hash = this.hashContent(content);
        if (hash !== cached.fileHashes[file]) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save index to cache
   */
  private async saveToCache(): Promise<void> {
    if (!this.index || !this.indexPath) return;

    try {
      const dir = path.dirname(this.indexPath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const content = JSON.stringify(this.index, null, 2);
      await fs.promises.writeFile(this.indexPath, content, 'utf-8');
    } catch (error) {
      console.error('[Search] Failed to save cache:', error);
    }
  }

  /**
   * Hash content for change detection
   */
  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Yield to UI
   */
  private async yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  // Build methods will be added in Task 9
  private async buildIndexAsync(): Promise<void> {
    // Placeholder - implemented in Task 9
    this.index = createEmptyIndex(this.contextFolder || '');
    this._onIndexReady.fire(this.index);
  }

  private setupFileWatcher(): void {
    // Placeholder - implemented in Task 10
  }

  private async refreshStaleEntries(): Promise<void> {
    // Placeholder - implemented in Task 10
  }
}
```

**Step 2: Add indexManager exports to index.ts**

Modify `src/search/index.ts` - add at end:

```typescript

// Index Manager
export { SearchIndexManager } from './indexManager';
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

```bash
git add src/search/
git commit -m "feat(search): add IndexManager core structure"
```

---

### Task 9: Implement Index Manager (Part 2 - Building)

**Files:**
- Modify: `src/search/indexManager.ts`

**Step 1: Add file parsing imports**

Add to the top of `src/search/indexManager.ts` (after existing imports):

```typescript
import { parseCodex, isCodexFile, isMarkdownFile, parseMarkdownAsCodex } from '../codexModel';
```

**Step 2: Replace buildIndexAsync placeholder with full implementation**

Replace the `buildIndexAsync` method in `src/search/indexManager.ts`:

```typescript
  /**
   * Build index asynchronously
   */
  private async buildIndexAsync(): Promise<void> {
    this.buildMutex = this.buildMutex.then(async () => {
      if (!this.workspaceRoot || !this.contextFolder) return;

      this.isBuilding = true;
      this.buildProgress = 0;

      this.index = createEmptyIndex(this.contextFolder);
      this._onIndexReady.fire(this.index);

      try {
        // Phase 1: Scan files (0-10%)
        const files = await this.scanCodexFiles();
        this.buildProgress = 10;
        this._onBuildProgress.fire(this.buildProgress);

        if (files.length === 0) {
          this.buildProgress = 100;
          this._onBuildProgress.fire(100);
          return;
        }

        // Phase 2: Index titles (10-20%)
        for (let i = 0; i < files.length; i++) {
          await this.indexFile(files[i]);
          this.buildProgress = 10 + Math.floor((i / files.length) * 80);

          if (i % 10 === 0) {
            this._onBuildProgress.fire(this.buildProgress);
            await this.yieldToUI();
          }
        }

        // Phase 3: Build inverted index (90-95%)
        this._onBuildProgress.fire(90);
        this.buildInvertedIndex();

        // Phase 4: Compute stats (95-100%)
        this.computeCorpusStats();
        this.buildProgress = 100;
        this._onBuildProgress.fire(100);

        // Save cache
        await this.saveToCache();

      } catch (error) {
        console.error('[Search] Index build error:', error);
      } finally {
        this.isBuilding = false;
        if (this.index) {
          this._onIndexReady.fire(this.index);
        }
      }
    });

    return this.buildMutex;
  }

  /**
   * Scan for codex files
   */
  private async scanCodexFiles(): Promise<string[]> {
    if (!this.workspaceRoot || !this.contextFolder) return [];

    const folderPath = path.join(this.workspaceRoot, this.contextFolder);
    const files: string[] = [];

    const glob = new vscode.RelativePattern(
      folderPath,
      '**/*.{codex.yaml,codex.json,md}'
    );
    const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**');

    for (const uri of uris) {
      if (!uri.fsPath.includes('.index.')) {
        files.push(uri.fsPath);
      }
    }

    return files;
  }

  /**
   * Index a single file
   */
  private async indexFile(filePath: string): Promise<void> {
    if (!this.index || !this.workspaceRoot) return;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const relativePath = path.relative(this.workspaceRoot, filePath);

      // Store hash
      this.index.fileHashes[relativePath] = this.hashContent(content);

      // Parse file
      let doc;
      if (isMarkdownFile(filePath)) {
        doc = parseMarkdownAsCodex(content, filePath);
      } else if (isCodexFile(filePath)) {
        doc = parseCodex(content);
      } else {
        return;
      }

      if (!doc || !doc.rootNode) return;

      // Index all nodes recursively
      this.indexNode(doc.rootNode, relativePath, []);

    } catch (error) {
      console.error(`[Search] Error indexing ${filePath}:`, error);
    }
  }

  /**
   * Index a single node and its children
   */
  private indexNode(
    node: any,
    filePath: string,
    parentPath: string[]
  ): void {
    if (!this.index) return;

    const nodePath = node.id ? [...parentPath, node.id] : parentPath;
    const boost = getDepthBoost(nodePath);

    // Title entry
    this.index.titles.push({
      id: node.id || `${filePath}:${nodePath.join('/')}`,
      name: node.name || node.id || 'Untitled',
      type: node.type || 'unknown',
      path: filePath,
      nodePath: nodePath.length > 0 ? nodePath : undefined,
      boost
    });

    // Metadata entry
    const tags: string[] = node.tags || [];
    const attributes: Record<string, string> = {};
    if (node.attributes) {
      for (const attr of node.attributes) {
        if (attr.key && attr.value !== undefined) {
          attributes[attr.key] = String(attr.value);
        }
      }
    }

    this.index.metadata.push({
      id: node.id || `${filePath}:${nodePath.join('/')}`,
      tags,
      attributes,
      type: node.type || 'unknown',
      path: filePath,
      nodePath: nodePath.length > 0 ? nodePath : undefined
    });

    // Content entries for prose fields
    const proseFields = ['body', 'summary', 'description', 'proseValue'];
    for (const field of proseFields) {
      const text = node[field];
      if (text && typeof text === 'string' && text.trim()) {
        const tokens = tokenize(text);
        this.index.content.push({
          id: node.id || `${filePath}:${nodePath.join('/')}`,
          field: field === 'proseValue' ? (node.proseField || 'body') : field,
          text,
          tokens,
          length: tokens.length,
          path: filePath,
          nodePath: nodePath.length > 0 ? nodePath : undefined
        });
      }
    }

    // Index children
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        this.indexNode(child, filePath, nodePath);
      }
    }
  }

  /**
   * Build inverted index from indexed content
   */
  private buildInvertedIndex(): void {
    if (!this.index) return;

    this.index.termIndex = {};

    // Index titles
    for (const entry of this.index.titles) {
      const tokens = tokenize(entry.name);
      for (let pos = 0; pos < tokens.length; pos++) {
        this.addToPostingList(tokens[pos], entry.id, 1, pos, entry.boost);
      }
    }

    // Index metadata
    for (const entry of this.index.metadata) {
      for (const tag of entry.tags) {
        const tokens = tokenize(tag);
        for (let pos = 0; pos < tokens.length; pos++) {
          this.addToPostingList(tokens[pos], entry.id, 2, pos, 1.3);
        }
      }
      for (const [key, value] of Object.entries(entry.attributes)) {
        const tokens = tokenize(`${key} ${value}`);
        for (let pos = 0; pos < tokens.length; pos++) {
          this.addToPostingList(tokens[pos], entry.id, 2, pos, 1.0);
        }
      }
    }

    // Index content
    for (const entry of this.index.content) {
      const boost = entry.field === 'summary' ? 1.2 : 1.0;
      for (let pos = 0; pos < entry.tokens.length; pos++) {
        this.addToPostingList(entry.tokens[pos], entry.id, 3, pos, boost);
      }
    }
  }

  /**
   * Add term to posting list
   */
  private addToPostingList(
    term: string,
    docId: string,
    tier: 1 | 2 | 3,
    position: number,
    boost: number
  ): void {
    if (!this.index) return;

    if (!this.index.termIndex[term]) {
      this.index.termIndex[term] = { term, docs: [] };
    }

    const posting = this.index.termIndex[term];
    let docEntry = posting.docs.find(d => d.id === docId && d.tier === tier);

    if (!docEntry) {
      docEntry = { id: docId, tier, positions: [], score: boost };
      posting.docs.push(docEntry);
    }

    docEntry.positions.push(position);
  }

  /**
   * Compute corpus statistics
   */
  private computeCorpusStats(): void {
    if (!this.index) return;

    const lengths = this.index.content.map(c => c.length);
    this.index.totalDocs = this.index.titles.length || 1;
    this.index.avgDocLength = lengths.length > 0
      ? lengths.reduce((a, b) => a + b, 0) / lengths.length
      : 100;
  }
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -30`

Expected: No errors

**Step 4: Commit**

```bash
git add src/search/indexManager.ts
git commit -m "feat(search): implement index building with file parsing"
```

---

### Task 10: Implement Index Manager (Part 3 - File Watching)

**Files:**
- Modify: `src/search/indexManager.ts`

**Step 1: Replace setupFileWatcher placeholder**

Replace the `setupFileWatcher` method in `src/search/indexManager.ts`:

```typescript
  /**
   * Set up file watcher for incremental updates
   */
  private setupFileWatcher(): void {
    if (!this.workspaceRoot || !this.contextFolder) return;

    this.fileWatcher?.dispose();

    const pattern = new vscode.RelativePattern(
      path.join(this.workspaceRoot, this.contextFolder),
      '**/*.{codex.yaml,codex.json,md}'
    );

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const queueUpdate = (uri: vscode.Uri) => {
      if (uri.fsPath.includes('.index.')) return;

      this.pendingUpdates.add(uri.fsPath);

      if (this.updateDebounceTimer) {
        clearTimeout(this.updateDebounceTimer);
      }

      this.updateDebounceTimer = setTimeout(() => {
        this.processUpdates();
      }, 500);
    };

    this.fileWatcher.onDidChange(queueUpdate);
    this.fileWatcher.onDidCreate(queueUpdate);
    this.fileWatcher.onDidDelete(uri => {
      if (uri.fsPath.includes('.index.')) return;
      this.removeFromIndex(uri.fsPath);
      this.saveToCache();
    });
  }

  /**
   * Process pending updates
   */
  private async processUpdates(): Promise<void> {
    if (!this.index || this.pendingUpdates.size === 0) return;

    const files = Array.from(this.pendingUpdates);
    this.pendingUpdates.clear();

    for (const file of files) {
      this.removeFromIndex(file);
      await this.indexFile(file);
    }

    this.buildInvertedIndex();
    this.computeCorpusStats();
    await this.saveToCache();

    this._onIndexReady.fire(this.index);
  }

  /**
   * Remove entries for a file from index
   */
  private removeFromIndex(filePath: string): void {
    if (!this.index || !this.workspaceRoot) return;

    const relativePath = path.relative(this.workspaceRoot, filePath);

    this.index.titles = this.index.titles.filter(t => t.path !== relativePath);
    this.index.metadata = this.index.metadata.filter(m => m.path !== relativePath);
    this.index.content = this.index.content.filter(c => c.path !== relativePath);
    delete this.index.fileHashes[relativePath];
  }

  /**
   * Check for stale entries
   */
  private async refreshStaleEntries(): Promise<void> {
    if (!this.index || !this.workspaceRoot) return;

    const staleFiles: string[] = [];

    for (const [relativePath, storedHash] of Object.entries(this.index.fileHashes)) {
      const fullPath = path.join(this.workspaceRoot, relativePath);

      try {
        if (!fs.existsSync(fullPath)) {
          this.removeFromIndex(fullPath);
          continue;
        }

        const content = await fs.promises.readFile(fullPath, 'utf-8');
        const currentHash = this.hashContent(content);

        if (currentHash !== storedHash) {
          staleFiles.push(fullPath);
        }
      } catch {
        this.removeFromIndex(fullPath);
      }
    }

    if (staleFiles.length > 0) {
      for (const file of staleFiles) {
        this.pendingUpdates.add(file);
      }
      await this.processUpdates();
    }
  }
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors

**Step 3: Commit**

```bash
git add src/search/indexManager.ts
git commit -m "feat(search): add file watching for incremental updates"
```

---

### Task 11: Wire Up Index Manager to Extension

**Files:**
- Modify: `src/extension.ts`

**Step 1: Add IndexManager import and instance**

Update the imports in `src/extension.ts`:

```typescript
import {
  SearchIndexManager,
  initializeStatusBar,
  updateStatusBar,
  openSearchUI,
  SearchResult
} from './search';
```

**Step 2: Add global IndexManager instance**

Add near the top of `src/extension.ts` (after imports, before `activate`):

```typescript
let searchIndexManager: SearchIndexManager | null = null;
```

**Step 3: Initialize IndexManager in activate function**

Add inside `activate` function (near the beginning):

```typescript
  // Initialize search index manager
  searchIndexManager = new SearchIndexManager();

  searchIndexManager.onBuildProgress(progress => {
    updateStatusBar('building', progress);
  });

  searchIndexManager.onIndexReady(index => {
    updateStatusBar('ready');
  });

  context.subscriptions.push({
    dispose: () => searchIndexManager?.dispose()
  });
```

**Step 4: Update search command to use IndexManager**

Replace the search command registration with:

```typescript
  // Search command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.search', async () => {
      if (!searchIndexManager) {
        vscode.window.showErrorMessage('Search not initialized');
        return;
      }

      const index = searchIndexManager.getIndex();
      if (!index) {
        vscode.window.showWarningMessage(
          'Search index not ready. Set a context folder first.'
        );
        return;
      }

      const treeProvider = getTreeProvider();
      const workspaceRoot = treeProvider?.getWorkspaceRoot();

      await openSearchUI(index, async (result: SearchResult) => {
        const isStructural = ['folder', 'book', 'index'].includes(result.type.toLowerCase());

        if (isStructural) {
          vscode.window.showInformationMessage(`Reveal: ${result.name}`);
        } else if (workspaceRoot) {
          const fullPath = path.join(workspaceRoot, result.path);
          await vscode.commands.executeCommand(
            'chapterwiseCodex.openWriterView',
            { filePath: fullPath, nodePath: result.nodePath }
          );
        }
      });
    })
  );

  // Rebuild search index command
  context.subscriptions.push(
    vscode.commands.registerCommand('chapterwiseCodex.rebuildSearchIndex', async () => {
      if (!searchIndexManager) return;

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Rebuilding search index...',
        cancellable: false
      }, async () => {
        await searchIndexManager!.forceRebuild();
      });

      vscode.window.showInformationMessage('Search index rebuilt.');
    })
  );
```

**Step 5: Export getSearchIndexManager function**

Add at the end of `src/extension.ts`:

```typescript
export function getSearchIndexManager(): SearchIndexManager | null {
  return searchIndexManager;
}
```

**Step 6: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -30`

Expected: No errors

**Step 7: Commit**

```bash
git add src/extension.ts
git commit -m "feat(search): wire up IndexManager to extension"
```

---

### Task 12: Integrate with TreeProvider Context Changes

**Files:**
- Modify: `src/treeProvider.ts`

**Step 1: Add import for getSearchIndexManager**

Add to imports in `src/treeProvider.ts`:

```typescript
import { getSearchIndexManager } from './extension';
```

**Step 2: Trigger index build on context change**

Find the `setContextFolder` method in `src/treeProvider.ts` and add at the end of the method (before the final `}`):

```typescript
    // Initialize search index for new context
    if (folderPath) {
      const searchManager = getSearchIndexManager();
      if (searchManager) {
        searchManager.initializeForContext(folderPath, workspaceRoot);
      }
    }
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile 2>&1 | head -20`

Expected: No errors

**Step 4: Commit**

```bash
git add src/treeProvider.ts
git commit -m "feat(search): trigger indexing on context folder change"
```

---

### Task 13: Add Rebuild Command to Package.json

**Files:**
- Modify: `package.json`

**Step 1: Add rebuild command definition**

Add to the `"commands"` array in `package.json`:

```json
      {
        "command": "chapterwiseCodex.rebuildSearchIndex",
        "title": "ChapterWise Codex: Rebuild Search Index",
        "icon": "$(sync)"
      },
```

**Step 2: Add to command palette**

Find or create `"commandPalette"` in menus and add:

```json
        {
          "command": "chapterwiseCodex.rebuildSearchIndex",
          "when": "chapterwiseCodex.hasContext"
        }
```

**Step 3: Verify JSON is valid**

Run: `cd /Users/phong/Projects/chapterwise-codex && node -e "JSON.parse(require('fs').readFileSync('package.json'))" && echo "Valid JSON"`

Expected: `Valid JSON`

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat(search): add rebuild search index command"
```

---

## Phase 4: Testing & Polish

### Task 14: Manual Testing Checklist

**Step 1: Build the extension**

Run: `cd /Users/phong/Projects/chapterwise-codex && npm run compile`

**Step 2: Launch Extension Development Host**

Press `F5` in VS Code to launch the extension development host.

**Step 3: Test search functionality**

- [ ] Set a context folder (right-click folder → Set as Codex Context)
- [ ] Verify status bar shows "Indexing X%"
- [ ] Verify status bar shows "Search" when complete
- [ ] Press `Cmd+Shift+F` to open search
- [ ] Type a search term - verify results appear
- [ ] Verify results are grouped by tier
- [ ] Click a result - verify it opens in Writer View
- [ ] Type `type:character` - verify type filter works
- [ ] Type `"exact phrase"` - verify exact matching works
- [ ] Modify a codex file - verify index updates
- [ ] Run "Rebuild Search Index" command - verify it works

**Step 4: Document any issues**

Create issues for any bugs found during testing.

**Step 5: Commit test results**

```bash
git add -A
git commit -m "test(search): complete manual testing"
```

---

## Summary

**Total Tasks:** 14
**Estimated Time:** 2-4 hours
**Files Created:** 7 new files in `src/search/`
**Files Modified:** `extension.ts`, `treeProvider.ts`, `package.json`

**Implementation Order:**
1. Types & Tokenizer (Tasks 1-2)
2. Query Parser & Scoring (Tasks 3-4)
3. Search Engine (Task 5)
4. Search UI (Tasks 6-7)
5. Index Manager (Tasks 8-10)
6. Integration (Tasks 11-13)
7. Testing (Task 14)

---

**Plan complete and saved to `docs/plans/2026-02-05-search-system-implementation.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
