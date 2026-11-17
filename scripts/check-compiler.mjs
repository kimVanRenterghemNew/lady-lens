#!/usr/bin/env node
/**
 * Compiler and module integrity guard for lady-lens.
 * Verifies syntax compilation, validates import/export resolution across modules,
 * and detects unused exports / dead code paths.
 * @module scripts/check-compiler
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'acorn';

const IGNORE_DIRS = new Set(['node_modules', 'dist', 'outputs', 'coverage', '.git', '.lady-lens']);

function stepCollectEntry(dir, entry, files) {
    if (IGNORE_DIRS.has(entry.name)) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
        collectJsFiles(full, files);
        return;
    }
    if (/\.[cm]?js$/.test(entry.name)) files.push(full.replace(/\\/g, '/'));
}

export function collectJsFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        stepCollectEntry(dir, entry, files);
    }
    return files;
}

function resolvePathVariants(base) {
    if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
    if (fs.existsSync(`${base}.js`)) return `${base}.js`;
    const index = path.join(base, 'index.js');
    if (fs.existsSync(index)) return index;
    return null;
}

export function resolveModulePath(fromFile, sourceValue) {
    if (!sourceValue?.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), sourceValue);
    const resolved = resolvePathVariants(base);
    return resolved ? resolved.replace(/\\/g, '/') : null;
}

function addVarDeclarators(declarations, exports) {
    if (!declarations) return;
    for (const d of declarations) {
        if (d.id) exports.add(d.id.name);
    }
}

function addDeclExports(declaration, exports) {
    if (!declaration) return;
    if (declaration.id) exports.add(declaration.id.name);
    addVarDeclarators(declaration.declarations, exports);
}

function addSpecExports(specifiers, exports) {
    for (const s of specifiers || []) {
        if (s.exported?.name) exports.add(s.exported.name);
    }
}

function addExportName(node, exports) {
    addDeclExports(node.declaration, exports);
    addSpecExports(node.specifiers, exports);
}

function mergeReexports(file, node, astMap, exportCache, exports) {
    if (node.type !== 'ExportAllDeclaration' || !node.source?.value) return;
    const target = resolveModulePath(file, node.source.value);
    if (!target) return;
    const sub = collectFileExports(target, astMap, exportCache);
    sub.forEach(name => exports.add(name));
}

function processExportNode(file, node, astMap, exportCache, exports) {
    if (node.type === 'ExportNamedDeclaration') addExportName(node, exports);
    mergeReexports(file, node, astMap, exportCache, exports);
}

export function collectFileExports(file, astMap, exportCache = new Map()) {
    if (exportCache.has(file)) return exportCache.get(file);
    const exports = new Set();
    exportCache.set(file, exports);
    const ast = astMap.get(file);
    if (!ast) return exports;
    for (const node of ast.body) processExportNode(file, node, astMap, exportCache, exports);
    return exports;
}

function checkImportSpecifiers(specifiers, targetExports, targetFile, fromFile, errors) {
    for (const spec of specifiers || []) {
        if (spec.type !== 'ImportSpecifier') continue;
        const name = spec.imported.name;
        if (!targetExports.has(name)) {
            errors.push(`${fromFile}: imports '${name}' which is not exported by ${targetFile}`);
        }
    }
}

function recordUsedSpecifiers(target, specifiers, usedExports) {
    for (const s of specifiers || []) {
        if (s.type === 'ImportSpecifier') usedExports.add(`${target}#${s.imported.name}`);
    }
}

function isLocalImport(node) {
    if (node.type !== 'ImportDeclaration') return false;
    const val = node.source ? node.source.value : '';
    return typeof val === 'string' && val.startsWith('.');
}

function verifyImportNode(node, file, astMap, exportCache, errors, usedExports) {
    if (!isLocalImport(node)) return;
    const target = resolveModulePath(file, node.source.value);
    if (!target) {
        errors.push(`${file}: broken import '${node.source.value}'`);
        return;
    }
    const targetExports = collectFileExports(target, astMap, exportCache);
    checkImportSpecifiers(node.specifiers, targetExports, target, file, errors);
    recordUsedSpecifiers(target, node.specifiers, usedExports);
}

function parseFile(file, astMap, errors) {
    const code = fs.readFileSync(file, 'utf8');
    try {
        const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
        astMap.set(file, ast);
    } catch (err) {
        errors.push(`${file}: syntax error: ${err.message}`);
    }
}

function collectUnusedForFile(file, exports, usedExports, unused) {
    if (file.includes('/test/') || file.endsWith('index.js')) return;
    for (const name of exports) {
        if (!usedExports.has(`${file}#${name}`)) unused.push({ file, name });
    }
}

function findUnusedExports(exportCache, usedExports) {
    const unused = [];
    for (const [file, exports] of exportCache) {
        collectUnusedForFile(file, exports, usedExports, unused);
    }
    return unused;
}

export function runCompilerCheck(rootDir = process.cwd()) {
    const rootFiles = ['index.js'].map(f => path.resolve(rootDir, f).replace(/\\/g, '/')).filter(f => fs.existsSync(f));
    const dirFiles = ['core', 'bin', 'ui', 'scripts', 'evals'].flatMap(d => collectJsFiles(path.resolve(rootDir, d)));
    const files = [...rootFiles, ...dirFiles];
    const testFiles = collectJsFiles(path.resolve(rootDir, 'test'));
    const allFiles = [...files, ...testFiles];
    const astMap = new Map();
    const errors = [];
    allFiles.forEach(f => parseFile(f, astMap, errors));
    if (errors.length) return { ok: false, errors, unused: [], fileCount: allFiles.length };

    const exportCache = new Map();
    const usedExports = new Set();
    files.forEach(f => collectFileExports(f, astMap, exportCache));
    allFiles.forEach(f => {
        const ast = astMap.get(f);
        if (ast) ast.body.forEach(node => verifyImportNode(node, f, astMap, exportCache, errors, usedExports));
    });
    const unused = findUnusedExports(exportCache, usedExports);
    return { ok: errors.length === 0, errors, unused, fileCount: allFiles.length, importCount: usedExports.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    const res = runCompilerCheck();
    if (!res.ok) {
        console.error(`❌ Compiler check failed with ${res.errors.length} error(s):`);
        res.errors.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
    }
    console.log(`✓ Compiler & module check passed (${res.fileCount} files, ${res.importCount} bound imports verified)`);
    if (res.unused.length) {
        console.log(`ℹ Detected ${res.unused.length} unreferenced internal export(s) (potential dead code paths)`);
    }
}
