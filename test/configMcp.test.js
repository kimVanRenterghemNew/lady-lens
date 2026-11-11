import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpToolSchemas, configGrep, configReferences, configUpdate } from '../core/mcp/index.js';
import { configureLensRoot } from '../core/configuration/index.js';

let root;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lady-lens-config-mcp-'));
    fs.writeFileSync(path.join(root, 'App.csproj'), '<Project><PackageReference Include="Serilog" Version="3.1.1" /></Project>');
    fs.writeFileSync(path.join(root, 'referenceManager.xml'), '<functionalblock><name>PUREQU_OP</name><version>2.0.0</version></functionalblock>');
    fs.writeFileSync(path.join(root, 'packages.reference'), '<functionalblock><name>PUREQU_OP</name><version>2.0.0</version></functionalblock>');
    fs.writeFileSync(path.join(root, 'notes.txt'), '<PackageReference Include="NotAConfig" />');
    configureLensRoot(root);
});

afterEach(() => {
    configureLensRoot(path.resolve('.'));
    fs.rmSync(root, { recursive: true, force: true });
});

describe('MCP config tools', () => {
    it('declares config_grep and config_update', () => {
        const names = buildMcpToolSchemas().map(schema => schema.name);
        expect(names).toEqual(expect.arrayContaining(['config_grep', 'config_references', 'config_update']));
    });

    it('finds config files that reference a functional block', () => {
        const result = configReferences({ reference: 'PUREQU_OP' });
        expect(result.totalCount).toBe(2);
        expect(result.matches).toEqual(expect.arrayContaining([
            expect.objectContaining({ file: 'referenceManager.xml', referenceType: 'functionalblock', version: '2.0.0' }),
            expect.objectContaining({ file: 'packages.reference', referenceType: 'functionalblock', version: '2.0.0' })
        ]));
        expect(configReferences({ package: 'PUREQU_OP' }).totalCount).toBe(2);
    });

    it('greps config files only', () => {
        const result = configGrep({ pattern: 'PackageReference' });
        expect(result.totalCount).toBe(1);
        expect(result.matches[0].file).toBe('App.csproj');
    });

    // MCP smoke test (2026-11-11): config_grep "vitest" on lady-lens gave 0 matches with truncated: true. grep cut at 50
    // matches in test files first, and only then kept the config files, so package.json never made it.
    it('finds a config match behind more than a page of code matches', () => {
        fs.mkdirSync(path.join(root, 'src'));
        for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(root, 'src', `a${String(i).padStart(2, '0')}.js`), '// PackageReference\n');
        const result = configGrep({ pattern: 'PackageReference' });
        expect(result.matches.map(match => match.file)).toEqual(['App.csproj']);
        expect(result.totalCount).toBe(1);
        expect(result.truncated).toBe(false);
    });

    it('updates config and refreshes graph facts', async () => {
        const before = fs.readFileSync(path.join(root, 'App.csproj'), 'utf8');
        const result = await configUpdate({ path: 'App.csproj', content: '<Project><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /></Project>', expectedHash: await import('crypto').then(({ default: crypto }) => crypto.createHash('sha256').update(before).digest('hex')) });

        expect(result.path).toBe('App.csproj');
        expect(result.sync.wrote).toBe(true);
        expect(fs.readFileSync(path.join(root, 'App.csproj'), 'utf8')).toContain('Newtonsoft.Json');
    });

    it('rejects stale hashes and unsafe or non-config paths', async () => {
        await expect(configUpdate({ path: 'App.csproj', content: 'changed', expectedHash: 'stale' })).resolves.toMatchObject({ error: 'config changed since read' });
        await expect(configUpdate({ path: '../outside.csproj', content: 'changed' })).resolves.toMatchObject({ error: expect.stringContaining('unsafe path') });
        await expect(configUpdate({ path: 'notes.txt', content: 'changed' })).resolves.toMatchObject({ error: 'not a supported config file: notes.txt' });
    });
});
