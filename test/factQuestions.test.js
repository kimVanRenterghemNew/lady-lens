/**
 * exports-of scored 0/6 and not-exists 3/6 because the model had no tool
 * for them (it called `imports` for an exports question and answered "unknown"). The same evidence injection as for imports.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, exportsOf, fileLookup, recognizeImportQuestion } from '../core/graph/index.js';

const graph = () => {
    const g = createGraph('t');
    g.addNode('file:core/domain/planning/askForParsed.js', 'CodeFile', { path: 'core/domain/planning/askForParsed.js', exports: ['askForParsed', 'askForParsed'] });
    g.addNode('file:core/a.js', 'CodeFile', { path: 'core/a.js', exports: ['zeta', 'alpha', 7] });
    g.addNode('file:core/empty.js', 'CodeFile', { path: 'core/empty.js' });
    return g;
};

describe('recognize', () => {
    it.each([
        ['Welke functies en waarden exporteert `core/repository/repoFileIndex.js`? Antwoord met alleen de namen.', { relation: 'exports', file: 'core/repository/repoFileIndex.js' }],
        ['What does core/a.js export?', { relation: 'exports', file: 'core/a.js' }],
        ['Staat er een module in core/services/askForParsed.js? Antwoord met ja of nee en, als je weet waar het wel staat, het pad.', { relation: 'exists', file: 'core/services/askForParsed.js' }],
        ['Is there a file core/x/y.js?', { relation: 'exists', file: 'core/x/y.js' }]
    ])('%s', (prompt, wanted) => { expect(recognizeImportQuestion(prompt)).toEqual(wanted); });
    it('import questions are unchanged, and statements are not questions', () => {
        expect(recognizeImportQuestion('Welke bestanden importeren `core/cli/index.js`?')).toEqual({ relation: 'importedBy', file: 'core/cli/index.js' });
        expect(recognizeImportQuestion('Geef alle interne imports van core/a.js.')).toEqual({ relation: 'imports', file: 'core/a.js' });
        expect(recognizeImportQuestion('Refactor core/a.js so that it exports less')).toBeNull();
    });
});

describe('exportsOf', () => {
    it('lists the names once, sorted, strings only', () => {
        expect(exportsOf(graph(), 'core/a.js')).toMatchObject({ found: true, file: 'core/a.js', names: ['alpha', 'zeta'] });
    });
    it('a file with no exports says so; an unknown file is not found', () => {
        expect(exportsOf(graph(), 'core/empty.js')).toMatchObject({ found: true, names: [] });
        expect(exportsOf(graph(), 'core/nope.js').found).toBe(false);
    });
});

describe('fileLookup', () => {
    it('the asked path does not exist but the same file name does elsewhere: says so and names where', () => {
        expect(fileLookup(graph(), 'core/services/askForParsed.js')).toEqual({ file: 'core/services/askForParsed.js', exists: false, similar: ['core/domain/planning/askForParsed.js'] });
    });
    it('an existing path exists; nothing similar is listed', () => {
        expect(fileLookup(graph(), 'core/a.js')).toEqual({ file: 'core/a.js', exists: true, similar: [] });
    });
    it('no file of that name anywhere: not exists, no similar', () => {
        expect(fileLookup(graph(), 'core/helpers/index.js')).toMatchObject({ exists: false, similar: [] });
    });
});
