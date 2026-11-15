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

    // found 2026-11-15 (Kura): a title line was the whole purpose, so a question about the behaviour missed the description
    it('MUST include the paragraph after a title line, which says what the file does', () => {
        const source = '/**\n * Mode Classifier (Fase 17, Story 17.1)\n *\n * Classifies incoming input into one of discuss | plan | execute.\n *\n * @module core/modeClassifier\n */\n';
        expect(analyzeSource(source).purpose).toBe('Mode Classifier (Fase 17, Story 17.1): Classifies incoming input into one of discuss | plan | execute.');
    });

    // found 2026-11-15 (Kura): "Persona matching (2026-10-03)." ends with a period, so the rule above missed it
    it('MUST treat a name with an aside at its end as a title, also when it ends with a period', () => {
        const source = '/**\n * Persona matching (2026-10-03).\n *\n * Picks the personas whose expertise fits the question.\n */\n';
        expect(analyzeSource(source).purpose).toBe('Persona matching (2026-10-03): Picks the personas whose expertise fits the question.');
        expect(analyzeSource('/**\n * Ranks (fast) hits.\n *\n * Details nobody asked for.\n */\n').purpose).toBe('Ranks (fast) hits.');
    });

    it('MUST drop the asides between brackets of a header too long to keep, not its description at the end', () => {
        const source = `/**\n * Story 27.51 (the owner, 2026-11-08: "${'a quoted decision '.repeat(12)}"): a task left with changes asks what to do with them.\n */\n`;
        expect(analyzeSource(source).purpose).toBe('Story 27.51: a task left with changes asks what to do with them.');
        expect(analyzeSource('/**\n * Ranks (fast) hits.\n */\n').purpose).toBe('Ranks (fast) hits.');
    });

    it('keeps a first paragraph that is a sentence on its own, and never adds the @module tags', () => {
        expect(analyzeSource('/**\n * Ranks the hits.\n *\n * Details nobody asked for.\n */\n').purpose).toBe('Ranks the hits.');
        expect(analyzeSource('/**\n * Ranker\n *\n * @module core/rank\n */\n').purpose).toBe('Ranker');
    });
});
