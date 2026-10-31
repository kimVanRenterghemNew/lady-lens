import { describe, it, expect } from 'vitest';
import { extractModuleDocumentation, parseJavaScriptAst, fileNodeId, buildCodeEntity } from '../core/graph/adapters/ladybug/index.js';

describe('Ladybug JavaScript entity builder (pure)', () => {
    it('extracts module documentation and a serializable AST', () => {
        const source = '/** Demo module. */\nexport function greet() { return "hi"; }';
        const ast = parseJavaScriptAst(source);

        expect(extractModuleDocumentation(source)).toBe('Demo module.');
        expect(ast.type).toBe('Program');
        expect(ast.body[0].type).toBe('ExportNamedDeclaration');
        expect(ast.loc).toBeUndefined();
    });

    it('builds the CodeFile entity GraphSync stores: one id scheme, facts in metadata, no AST unless asked', () => {
        const source = "/**\n * Greets people.\n */\nimport { x } from './x.js';\nexport function greet() { return x; }\n";

        const entity = buildCodeEntity('core/Greeter.js', source, { now: '2026-10-03T00:00:00.000Z' });

        expect(entity.id).toBe(fileNodeId('core/Greeter.js'));
        expect(entity.id).toBe('file:core/greeter.js');
        expect(entity).toMatchObject({ type: 'CodeFile', path: 'core/Greeter.js', documentation: 'Greets people.' });
        expect(entity.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(entity.metadata).toMatchObject({ exports: ['greet'], imports: ['./x.js'] });
        expect(entity.ast).toBeUndefined();
        expect(buildCodeEntity('core/g.js', source, { includeAst: true }).ast.type).toBe('Program');
        // Non-JS files or syntax errors must never throw in Acorn and must not carry JS ast
        expect(parseJavaScriptAst('SELECT * FROM table;')).toBeNull();
        const sqlEntity = buildCodeEntity('queries/select.sql', 'SELECT * FROM users WHERE active = 1;', { includeAst: true });
        expect(sqlEntity.ast).toBeUndefined();
        expect(sqlEntity.metadata.exports).toEqual([]);
    });
});
