import { describe, it, expect } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from '../core/configuration/index.js';

describe('Frontmatter Module (BDD)', () => {
    describe('Given: a markdown file with CRLF frontmatter', () => {
        it('When: parsed, Then: fields are extracted correctly (CRLF regression)', () => {
            const content = '---\r\nid: DEC-001\r\ntitle: Use Ollama\r\nstatus: approved\r\n---\r\n\r\nBody text';
            const result = parseFrontmatter(content);
            expect(result.id).toBe('DEC-001');
            expect(result.title).toBe('Use Ollama');
            expect(result.status).toBe('approved');
        });
    });

    describe('Given: a markdown file without frontmatter', () => {
        it('When: parsed, Then: an empty object is returned', () => {
            const result = parseFrontmatter('Just plain content');
            expect(result).toEqual({});
        });
    });

    describe('Given: an object of key/value pairs', () => {
        it('When: stringified, Then: it round-trips back to the same fields', () => {
            const obj = { id: 'DEC-001', title: 'Use Ollama', status: 'approved' };
            const content = stringifyFrontmatter(obj, 'Body text');
            const parsed = parseFrontmatter(content);
            expect(parsed).toEqual(obj);
            expect(content).toContain('Body text');
        });
    });

  it('REGRESSION 2026-10-03: nested objects and empty arrays round-trip (task files showed "[object Object]")', () => {
    const data = {
      title: 'Retrieve session state: from core/memory/sessionState.js',
      groundingStatus: 'grounded',
      ungroundedPaths: [],
      classificationCounts: { existing_grounded: 1, new_in_known_dir: 2 },
      suggestedPaths: { 'core/session.js': 'core/memory/sessionState.js' },
      paths: [{ path: 'core/memory/sessionState.js', classification: 'existing_grounded' }],
      links: [{ target: 'features/EPIC-001-STORY-1', relation: 'implements', direction: 'outgoing' }]
    };

    const text = stringifyFrontmatter(data, 'Body');

    expect(text).not.toContain('[object Object]');
    expect(parseFrontmatter(text)).toEqual(data);
  });
});
