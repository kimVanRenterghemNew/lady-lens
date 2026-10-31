/**
 * A host sets its lexicon file with configureLensEnv AFTER lady-lens is imported (an ESM import runs first). The lexicon
 * was read once at import, so the host's file was never used: a Dutch question lost its English translations
 * ("herstel" -> recover, measured: the host's cross-language recall fell from 100% to 93%).
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { configureLensEnv, rankGraphNodes, createGraph } from '../core/graph/index.js';
import { NL_EN, withTranslations } from '../core/language/index.js';

const file = path.join(os.tmpdir(), `lens-lexicon-${process.pid}.json`);
afterEach(() => { configureLensEnv({ LEXICON_FILE: 'LENS_LEXICON_FILE' }, { LEXICON_FILE: '' }); fs.rmSync(file, { force: true }); });

describe('the lexicon a host configures after import is used', () => {
    it('MUST translate with the host lexicon set after import, in ranking and in withTranslations', () => {
        fs.writeFileSync(file, JSON.stringify({ entries: { zzherstel: ['frobnicate'] } }));
        // Like a host: its own variable name (unset here) and its file as the default.
        configureLensEnv({ LEXICON_FILE: 'HOST_LEXICON_FILE_UNSET' }, { LEXICON_FILE: file });
        expect(withTranslations(['zzherstel'])).toEqual(['zzherstel', 'frobnicate']);
        expect(Object.hasOwn(NL_EN, 'zzherstel')).toBe(true);
        const graph = createGraph('t');
        graph.addNode('file:core/frob.js', 'CodeFile', { path: 'core/frob.js', exports: ['frobnicate'] });
        graph.addNode('file:core/other.js', 'CodeFile', { path: 'core/other.js', exports: ['other'] });
        expect(rankGraphNodes(graph, 'zzherstel', { limit: 1 })[0]?.node.path).toBe('core/frob.js');
    });
});
