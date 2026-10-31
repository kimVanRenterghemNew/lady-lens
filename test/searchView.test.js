import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { searchView } from '../core/search/index.js';

describe('Story 23.12: Code search view (searchView)', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-searchview-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('finds definition, calls, test, and document matches with correct classifications', () => {
        // 1. Definition file (code)
        const defFile = path.join(tempDir, 'src', 'handler.js');
        fs.mkdirSync(path.dirname(defFile), { recursive: true });
        fs.writeFileSync(defFile, `
export function processOrder(order) {
    validate(order);
    return true;
}
`, 'utf8');

        // 2. Caller file (code with 2 calls)
        const callerFile = path.join(tempDir, 'src', 'controller.js');
        fs.writeFileSync(callerFile, `
import { processOrder } from './handler.js';

export function handleRequest(req) {
    processOrder(req.first);
    processOrder(req.second);
}
`, 'utf8');

        // 3. Test file
        const testFile = path.join(tempDir, 'test', 'handler.test.js');
        fs.mkdirSync(path.dirname(testFile), { recursive: true });
        fs.writeFileSync(testFile, `
import { processOrder } from '../src/handler.js';

describe('processOrder', () => {
    it('processes order', () => {
        expect(processOrder({})).toBe(true);
    });
});
`, 'utf8');

        // 4. Document file
        const docFile = path.join(tempDir, 'docs', 'orders.md');
        fs.mkdirSync(path.dirname(docFile), { recursive: true });
        fs.writeFileSync(docFile, `
# Order Handling
The \`processOrder\` workflow handles order validation.
`, 'utf8');

        // Execute searchView for 'processOrder'
        const result = searchView({ query: 'processOrder' }, { root: tempDir });

        expect(result.error).toBeUndefined();
        expect(result.filesCount).toBe(4);
        expect(result.totalMatches).toBeGreaterThanOrEqual(5);

        // Check classifications
        const defMatch = result.files.find(f => f.file.includes('handler.js')).matches.find(m => m.kind === 'definition');
        expect(defMatch).toBeDefined();
        expect(defMatch.line).toBe(2);
        expect(defMatch.symbol).toBe('processOrder');

        const callerMatches = result.files.find(f => f.file.includes('controller.js')).matches.filter(m => m.kind === 'call');
        expect(callerMatches.length).toBe(2);

        const testMatches = result.files.find(f => f.file.includes('handler.test.js')).matches;
        expect(testMatches.every(m => m.kind === 'test')).toBe(true);

        const docMatches = result.files.find(f => f.file.includes('orders.md')).matches;
        expect(docMatches.every(m => m.kind === 'doc')).toBe(true);
    });

    it('respects caseSensitive, wholeWord, kind, and include options', () => {
        const fileA = path.join(tempDir, 'src', 'A.cs');
        fs.mkdirSync(path.dirname(fileA), { recursive: true });
        fs.writeFileSync(fileA, `
class OrderManager {
    public void ChangeOver() { }
    public void changeOverExtra() { }
}
`, 'utf8');

        const fileB = path.join(tempDir, 'docs', 'readme.md');
        fs.mkdirSync(path.dirname(fileB), { recursive: true });
        fs.writeFileSync(fileB, `Mentions ChangeOver in doc.`, 'utf8');

        // 1. Case-sensitive
        const caseRes = searchView({ query: 'ChangeOver', caseSensitive: true }, { root: tempDir });
        const allTexts = caseRes.files.flatMap(f => f.matches.map(m => m.text));
        expect(allTexts.some(t => t.includes('changeOverExtra'))).toBe(false);

        // 2. Whole word
        const wholeRes = searchView({ query: 'ChangeOver', wholeWord: true }, { root: tempDir });
        const wholeTexts = wholeRes.files.flatMap(f => f.matches.map(m => m.text));
        expect(wholeTexts.some(t => t.includes('changeOverExtra'))).toBe(false);

        // 3. Kind filter (only code)
        const codeOnly = searchView({ query: 'ChangeOver', kind: 'code' }, { root: tempDir });
        expect(codeOnly.files.some(f => f.kind === 'doc')).toBe(false);

        // 4. Include glob filter
        const includeOnly = searchView({ query: 'ChangeOver', include: 'docs/**' }, { root: tempDir });
        expect(includeOnly.files.every(f => f.file.startsWith('docs/'))).toBe(true);
    });

    it('returns error when query is empty or invalid regex', () => {
        expect(searchView({}, { root: tempDir }).error).toContain('query is required');
        expect(searchView({ query: '[invalid', isRegex: true }, { root: tempDir }).error).toContain('invalid pattern');
    });
});
