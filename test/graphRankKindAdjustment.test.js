/**
 * Golf 4 (2026-11-11) summed the kind adjustments of scoreNode; before they were exclusive. A test file that is also a barrel
 * (test/fixtures/x/index.js) then got the test bonus and the barrel penalty.
 */
import { describe, it, expect } from 'vitest';
import { rankGraphNodes } from '../core/graph/index.js';

const file = (path, exports, kind) => ({ id: `file:${path}`, type: 'CodeFile', path, name: path.split('/').pop(), exports, symbols: exports, kind });

const scoreOf = (node) => rankGraphNodes({ nodes: new Map([[node.id, node]]), edges: [] }, 'parse widget tests')[0]?.score;

describe('kind adjustments in scoreNode', () => {
    it('a test barrel scores like any other test file: no barrel penalty on top of the test bonus', () => {
        const barrel = scoreOf(file('test/fixtures/widget/index.js', ['parseWidget'], 'test'));
        const plain = scoreOf(file('test/fixtures/widget/main.js', ['parseWidget'], 'test'));
        expect(barrel).toBeDefined();
        expect(barrel).toBe(plain);
    });
});
