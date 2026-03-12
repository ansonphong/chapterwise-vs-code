/**
 * Search Index Types
 * Defines the structure for the search index used by ChapterWise
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
