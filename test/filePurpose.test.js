/**
 * A file's purpose is its header: the comment at the top. Found 2026-10-30: a file with a `//` header got the doc comment
 * of a function further down as its purpose ("Without Ollama: the model ..." for a startup file), because a `/** *\/`
 * anywhere won over a `//` header.
 */
import { describe, it, expect } from 'vitest';
import { analyzeSource } from '../core/graph/index.js';

describe('the purpose of a file', () => {
    it('MUST be the // header at the top, not the doc comment of a function below it', () => {
        const source = "// Startup and model initialisation for the CLI\n\nimport x from './x.js';\n\n/** Without Ollama: the configured model. */\nfunction configured() {}\n";
        expect(analyzeSource(source).purpose).toBe('Startup and model initialisation for the CLI');
    });

    it('MUST read a // header with Windows line endings (CRLF): every such file had an empty purpose', () => {
        expect(analyzeSource('// IoC type "tools": one registration per tool.\r\n// More.\r\n\r\nimport x from \'./x.js\';\r\n').purpose).toBe('IoC type "tools": one registration per tool. More.');
    });

    it('is the /** */ header at the top', () => {
        expect(analyzeSource('/**\n * Ranks the hits.\n */\nexport const rank = () => 1;\n').purpose).toBe('Ranks the hits.');
    });

    it('without a header at the top, still the first doc comment (a module doc after the imports)', () => {
        expect(analyzeSource("import x from './x.js';\n/**\n * The module doc.\n */\nexport const a = 1;\n").purpose).toBe('The module doc.');
    });
});
