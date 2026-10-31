/**
 * Live 2026-10-10 (V02, plan-from-story-file): /plan crashed with "function is not iterable" in graphRank.tokenize: the NL->EN
 * lexicon is a plain object, so the word "constructor" found Object.prototype.constructor (a function) and was iterated. Any text or
 * graph node with such a word broke graph_query and the whole plan. Words that are Object.prototype names must be ordinary words.
 */
import { describe, it, expect } from 'vitest';
import { tokenizeQuery, rankGraphNodes } from '../core/graph/index.js';

const graph = (texts) => ({ nodes: new Map(texts.map((text, i) => [`n${i}`, { id: `n${i}`, type: 'CodeFile', path: `core/f${i}.js`, name: `f${i}`, summary: text }])), edges: [] });

describe('words that are names on Object.prototype', () => {
    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'])('tokenize("%s ...") never throws', (word) => {
        expect(() => tokenizeQuery(`the ${word} of the class and the queue`)).not.toThrow();
        expect(tokenizeQuery(`the ${word} of the class`)).toContain(word.toLowerCase());
    });
    it('a query and a node that say "constructor" rank normally', () => {
        expect(() => rankGraphNodes(graph(['the queue constructor', 'status command']), 'fix the constructor of the queue')).not.toThrow();
    });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadLexicon, withTranslations } from '../core/language/index.js';

describe('the lexicon itself has no prototype members', () => {
    it('withTranslations(["constructor"]) is just the word', () => {
        expect(withTranslations(['constructor', 'valueof'])).toEqual(['constructor', 'valueof']);
    });
    it('a generated lexicon with the key "constructor" loads and translates it', () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lex-')), 'lexicon.generated.json');
        fs.writeFileSync(file, JSON.stringify({ entries: { constructor: ['builder'] } }));
        const lexicon = loadLexicon({ file });
        expect(lexicon.constructor).toEqual(['builder']);
        expect(lexicon.tostring).toBeUndefined();
    });
});
