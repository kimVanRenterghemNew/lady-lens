/** Import-graph helpers shared by moduleApi.test.js, testModuleApi.test.js and composition.test.js. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
export const IMPORT = /^\s*(?:import|export)\s+[^;'"`]*?\s+from\s+['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gm;

export function resolveImport(fromRel, specifier) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
    for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) {
        const full = path.join(ROOT, candidate);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return candidate;
    }
    return null;
}

/** `from -> to` for every import that reaches into another folder without its index.js. */
export function moduleBypasses(files, read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8'), resolve = resolveImport) {
    const found = new Set();
    for (const rel of files) {
        for (const match of strip(read(rel)).matchAll(IMPORT)) {
            const target = resolve(rel, match[1] || match[2] || match[3]);
            if (!target) continue;
            if (path.posix.dirname(target) === path.posix.dirname(rel)) continue;
            if (path.posix.basename(target) === 'index.js') {
                const adapterMatch = target.match(/^core\/([^/]+)\/adapters\//);
                if (!adapterMatch || rel.startsWith(`core/${adapterMatch[1]}/`)) continue;
            }
            found.add(`${rel} -> ${target}`);
        }
    }
    return [...found].sort();
}
