import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { CodexNode } from '../codexModel';
import { getWriterViewScript } from './script';

function makeNode(overrides: Partial<CodexNode> = {}): CodexNode {
  return {
    id: 'test-node',
    type: 'scene',
    name: 'Test Scene',
    proseField: 'body',
    proseValue: 'Body text',
    availableFields: ['summary', 'body'],
    path: [],
    children: [],
    attributes: [{ key: 'status', name: 'Status', value: 'Draft' }],
    contentSections: [{ key: 'beat-1', name: 'Beat 1', value: 'Opening image' }],
    images: [{ url: 'images/test.png', caption: 'Reference image' }],
    hasImages: true,
    hasAttributes: true,
    hasContentSections: true,
    ...overrides,
  };
}

describe('getWriterViewScript', () => {
  it('emits JavaScript that parses without TypeScript syntax', () => {
    const source = getWriterViewScript(makeNode(), '__overview__');

    expect(() => new Script(source)).not.toThrow();
  });
});
