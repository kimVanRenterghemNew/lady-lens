import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { yamlInstall, yamlUninstall, yamlRepo } from '../core/mcp/yamlInstall.js';

describe('yaml install', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-yaml-'));
    const entry = { command: 'node', args: ['lens.mjs', 'mcp', '--stdio', '--repo', '/r'], env: { LENS_MCP_VERSION: '1' } };

    it('installs, keeps comments, is idempotent, reads the repo back and removes', () => {
        const target = { file: path.join(dir, 'config.yaml'), key: 'mcp_servers' };
        fs.writeFileSync(target.file, '# mine\nmodel: x\n');
        expect(yamlInstall(target, entry, true).status).toBe('installed');
        expect(fs.readFileSync(target.file, 'utf8')).not.toMatch(/lady-lens/);
        expect(yamlInstall(target, entry, false).status).toBe('installed');
        expect(fs.readFileSync(target.file, 'utf8')).toMatch(/# mine/);
        expect(yamlInstall(target, entry, false).status).toBe('unchanged');
        expect(yamlInstall(target, { ...entry, env: undefined }, false).status).toBe('updated');
        expect(yamlRepo(target)).toBe('/r');
        expect(yamlUninstall(target, false).status).toBe('removed');
        expect(yamlUninstall(target, false).status).toBe('absent');
        expect(yamlRepo(target)).toBeNull();
    });

    it('refuses a file that is not valid YAML and leaves it alone', () => {
        const target = { file: path.join(dir, 'bad.yaml'), key: 'mcp_servers' };
        fs.writeFileSync(target.file, 'a: [unclosed\n');
        expect(yamlInstall(target, entry, false).status).toBe('error');
        expect(fs.readFileSync(target.file, 'utf8')).toBe('a: [unclosed\n');
        expect(yamlRepo(target)).toBeNull();
        expect(yamlRepo({ file: path.join(dir, 'none.yaml'), key: 'mcp_servers' })).toBeNull();
    });
});
