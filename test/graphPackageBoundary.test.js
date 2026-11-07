/**
 * core/graph must be liftable into its own package (lady-lens). It may use the small base modules
 * (configuration, repository, observability, language, git); the model and everything above it are injected.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ALLOWED = new Set(['configuration', 'repository', 'observability', 'language', 'git']);

function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
}

describe('core/graph package boundary', () => {
    it('imports nothing but the base modules (configuration, repository, observability, language, git)', () => {
        const outside = [];
        for (const file of files('core/graph')) {
            for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
                const target = path.normalize(path.join(path.dirname(file), match[1])).replace(/\\/g, '/');
                if (target.startsWith('core/graph/')) continue;
                const module = target.split('/')[1];
                if (!ALLOWED.has(module)) outside.push(`${file.replace(/\\/g, '/')} -> ${target}`);
            }
        }
        expect(outside).toEqual([]);
    });
});
